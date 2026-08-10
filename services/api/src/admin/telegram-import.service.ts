import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { BizCode, BizException } from '../common/biz.exception';
import { AdminService } from './admin.service';
import { AdminEpisodesService } from './episodes.service';
import { UploadService } from '../upload/upload.service';
import {
  TelegramProvider,
  type TelegramProbeItem,
  type TelegramProbeMode,
} from './telegram.provider';
import type {
  YtdlpEpisodeFailure,
  YtdlpTransferJobEntry,
  YtdlpTransferJobState,
} from './ytdlp-import.service';
import { requireSecret } from '../common/security-config';
import { signMediaPath } from '../common/media-sign.util';

type TelegramTransferSelected = {
  index: number;
  id: string;
  messageId: number;
  title?: string;
  webpageUrl: string;
  durationSec?: number | null;
};

type TelegramTransferPayload = {
  kind: 'telegram';
  channel: string;
  preferR2: boolean;
  dramaId: string;
  actorId?: string;
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
  /** When set (30–600), each TG message is cut into fixed-duration episode parts. */
  segmentSeconds?: number;
  selected: TelegramTransferSelected[];
  useSourceIndexAsEpisodeNumber?: boolean;
};

type DbTransferRow = {
  id: string;
  dramaId: bigint;
  slug: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  target: string;
  preferR2: boolean;
  total: number;
  transferred: number;
  currentEpisode: number | null;
  failedEpisodes: unknown;
  jobs: unknown;
  previewUrl: string | null;
  extractor: string | null;
  kind: string | null;
  externalRef: string | null;
  sourceType: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class TelegramImportService implements OnModuleInit {
  private readonly logger = new Logger(TelegramImportService.name);
  private readonly activeRuns = new Set<string>();

  constructor(
    private readonly telegram: TelegramProvider,
    private readonly admin: AdminService,
    private readonly episodes: AdminEpisodesService,
    private readonly upload: UploadService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.recoverPendingTransferJobs();
    }, 2000);
  }

  async status() {
    const storage = this.upload.storageStatus();
    const tg = await this.telegram.status();
    return {
      ...tg,
      r2Configured: storage.r2Configured,
      ffmpegReady: await this.upload.detectFfmpeg(),
      storageBackend: storage.storageBackend,
    };
  }

  async probe(opts: {
    channel: string;
    mode?: TelegramProbeMode;
    recentN?: number;
    fromId?: number;
    toId?: number;
    mediaOnly?: boolean;
  }) {
    if (!this.telegram.isConfigured()) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Telegram sidecar 未配置（TELEGRAM_SIDECAR_URL）',
      );
    }
    const result = await this.telegram.probe(opts);
    return {
      ...result,
      extractor: 'telegram',
      kind: 'playlist' as const,
      episodes: result.items.map((item, i) => this.toEpisodeRow(item, i + 1)),
    };
  }

  async thumb(opts: { channel: string; messageId: number }) {
    if (!this.telegram.isConfigured()) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Telegram sidecar 未配置（TELEGRAM_SIDECAR_URL）',
      );
    }
    const messageId = Math.floor(Number(opts.messageId));
    if (!Number.isFinite(messageId) || messageId < 1) {
      throw new BizException(BizCode.BAD_REQUEST, '无效的 messageId');
    }
    return this.telegram.thumb({
      channel: this.normalizeChannel(opts.channel),
      messageId,
    });
  }

  private toEpisodeRow(item: TelegramProbeItem, index: number) {
    return {
      index,
      id: String(item.messageId),
      title: item.title,
      webpageUrl: item.webpageUrl,
      messageId: item.messageId,
      durationSec: item.duration != null ? Math.round(Number(item.duration)) : null,
      size: item.size ?? null,
      hasVideo: item.hasVideo,
      mediaKind: item.mediaKind,
      candidateCount: 1,
    };
  }

  async getTransferJob(jobId: string): Promise<YtdlpTransferJobState> {
    const job = await this.prisma.ytdlpTransferJob.findUnique({
      where: { id: String(jobId || '').trim() },
    });
    if (!job || job.extractor !== 'telegram') {
      throw new BizException(BizCode.NOT_FOUND, '转存任务不存在或已过期');
    }
    return this.toPublicState(job as DbTransferRow);
  }

  async transferDrama(
    opts: {
      channel: string;
      categorySlug?: string;
      titleEn?: string;
      titleZh?: string;
      coverUrl?: string;
      descriptionEn?: string;
      descriptionZh?: string;
      creatorId?: string;
      freeEpisodeCount?: number;
      lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
      buyoutCredits?: number | string | null;
      watermarkEnabled?: boolean;
      watermarkX?: number;
      watermarkY?: number;
      watermarkScale?: number;
      /** Optional fixed-duration cut in seconds (30–600). Empty/omit = 1 message → 1 episode. */
      segmentSeconds?: number | string | null;
      episodes: Array<{
        messageId: number;
        title?: string;
        webpageUrl?: string;
        episodeNumber?: number;
        durationSec?: number | null;
      }>;
    },
    actorId?: bigint,
  ) {
    if (!this.telegram.isConfigured()) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Telegram sidecar 未配置（TELEGRAM_SIDECAR_URL）',
      );
    }
    const storage = this.upload.storageStatus();
    if (!storage.r2Configured) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'R2 未配置凭证，无法转存到 R2',
      );
    }
    if (!(await this.upload.detectFfmpeg())) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '未检测到 ffmpeg，无法转码',
      );
    }

    const channel = this.normalizeChannel(opts.channel);
    const selected = this.normalizeSelected(opts.episodes, channel);
    if (!selected.length) {
      throw new BizException(BizCode.BAD_REQUEST, '请至少勾选一条带视频的 TG 帖');
    }

    const segmentSeconds = this.normalizeSegmentSeconds(opts.segmentSeconds);

    const categorySlug = await this.requireCategorySlug(opts.categorySlug);
    const titleEn =
      (opts.titleEn || '').trim() ||
      selected[0]?.title ||
      `telegram-${channel}`;
    const titleZh = (opts.titleZh || '').trim() || undefined;
    const probeId = createHash('sha1')
      .update(
        [
          ...selected.map((s) => `${channel}:${s.messageId}`),
          `seg:${segmentSeconds ?? 0}`,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 20);
    const externalRef = `telegram:${channel}:${probeId}`;

    const existing = await this.prisma.drama.findFirst({
      where: { externalRef } as any,
      select: { id: true, slug: true },
    });
    if (existing) {
      throw new BizException(
        BizCode.CONFLICT,
        `该 Telegram 选集已导入: id=${existing.id} slug=${existing.slug}`,
      );
    }

    const freeEpisodeCount =
      opts.freeEpisodeCount != null
        ? Math.max(0, Math.floor(Number(opts.freeEpisodeCount)))
        : selected.length;
    const lockMode =
      opts.lockMode === undefined
        ? 'ALL_FREE'
        : opts.lockMode === null || opts.lockMode === 'INHERIT'
          ? null
          : opts.lockMode;

    const drama = await this.admin.createLocalUploadDrama(
      {
        titleEn,
        titleZh,
        descriptionEn: opts.descriptionEn?.trim() || undefined,
        descriptionZh: opts.descriptionZh?.trim() || undefined,
        categorySlug,
        coverUrl: opts.coverUrl?.trim() || undefined,
        creatorId: opts.creatorId,
        lockMode,
        freeEpisodeCount,
        buyoutCredits: opts.buyoutCredits,
        status: 'DRAFT',
        sourceType: 'R2',
        sourceTags: [
          'telegram',
          'transfer',
          'r2',
          `tg:${channel}`,
          ...(segmentSeconds ? [`seg:${segmentSeconds}`] : []),
        ],
        totalEpisodes: selected.length,
        externalRef,
      },
      actorId,
    );

    const jobId = randomUUID();
    const payload: TelegramTransferPayload = {
      kind: 'telegram',
      channel,
      preferR2: true,
      dramaId: drama.id,
      actorId: actorId != null ? String(actorId) : undefined,
      watermarkEnabled: !!opts.watermarkEnabled,
      watermarkX: opts.watermarkX,
      watermarkY: opts.watermarkY,
      watermarkScale: opts.watermarkScale,
      segmentSeconds,
      selected,
      useSourceIndexAsEpisodeNumber: true,
    };

    const row = await this.prisma.ytdlpTransferJob.create({
      data: {
        id: jobId,
        dramaId: BigInt(drama.id),
        slug: drama.slug,
        status: 'QUEUED',
        target: 'r2',
        preferR2: true,
        total: selected.length,
        transferred: 0,
        currentEpisode: null,
        failedEpisodes: [],
        jobs: [],
        payload: payload as any,
        extractor: 'telegram',
        kind: selected.length > 1 ? 'playlist' : 'single',
        externalRef,
        sourceType: drama.sourceType,
      },
    });

    void this.runTransferJob(jobId);

    return {
      jobId: row.id,
      id: drama.id,
      slug: drama.slug,
      status: drama.status,
      jobStatus: 'queued' as const,
      sourceType: drama.sourceType,
      target: 'r2' as const,
      preferR2: true,
      extractor: 'telegram',
      kind: selected.length > 1 ? ('playlist' as const) : ('single' as const),
      externalRef,
      totalEpisodes: selected.length,
      transferredEpisodes: 0,
      async: true as const,
      channel,
    };
  }

  private normalizeChannel(raw: string): string {
    const text = String(raw || '').trim();
    const m = text.match(
      /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)/i,
    );
    if (m) return m[1];
    if (/^[A-Za-z0-9_]+$/.test(text)) return text;
    throw new BizException(BizCode.BAD_REQUEST, `无效 Telegram 频道: ${text}`);
  }

  /** Empty / unset = no split. Otherwise clamp to 30–600. */
  private normalizeSegmentSeconds(
    raw: number | string | null | undefined,
  ): number | undefined {
    if (raw == null || raw === '') return undefined;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n <= 0) return undefined;
    if (n < 30 || n > 600) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '每集秒数需在 30–600 之间（留空则整帖一集）',
      );
    }
    return n;
  }

  private normalizeSelected(
    episodes: Array<{
      messageId: number;
      title?: string;
      webpageUrl?: string;
      episodeNumber?: number;
      durationSec?: number | null;
    }>,
    channel: string,
  ): TelegramTransferSelected[] {
    const out: TelegramTransferSelected[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < (episodes || []).length; i++) {
      const ep = episodes[i];
      const messageId = Math.floor(Number(ep.messageId));
      if (!Number.isFinite(messageId) || messageId < 1) continue;
      if (seen.has(messageId)) continue;
      seen.add(messageId);
      const n = Number(ep.episodeNumber);
      const index = Number.isFinite(n) && n > 0 ? n : out.length + 1;
      out.push({
        index,
        id: String(messageId),
        messageId,
        title: (ep.title || '').trim() || undefined,
        webpageUrl:
          String(ep.webpageUrl || '').trim() ||
          `https://t.me/${channel}/${messageId}`,
        durationSec: ep.durationSec ?? null,
      });
    }
    out.sort((a, b) => a.messageId - b.messageId);
    // Re-index consecutive for display; use message order as episode order
    return out.map((ep, i) => ({ ...ep, index: i + 1 }));
  }

  private async requireCategorySlug(slug?: string) {
    const categorySlug = String(slug || '').trim();
    if (!categorySlug) {
      throw new BizException(BizCode.BAD_REQUEST, '请选择分类 categorySlug');
    }
    const cat = await this.prisma.category.findFirst({
      where: { slug: categorySlug },
      select: { slug: true },
    });
    if (!cat) throw new BizException(BizCode.BAD_REQUEST, `分类不存在: ${categorySlug}`);
    return cat.slug;
  }

  private async recoverPendingTransferJobs() {
    try {
      const pending = await this.prisma.ytdlpTransferJob.findMany({
        where: {
          status: { in: ['QUEUED', 'RUNNING'] },
          extractor: 'telegram',
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      if (!pending.length) return;
      for (const job of pending) {
        if (job.status === 'RUNNING') {
          await this.prisma.ytdlpTransferJob.update({
            where: { id: job.id },
            data: { status: 'QUEUED', currentEpisode: null },
          });
        }
        void this.runTransferJob(job.id);
      }
      this.logger.log(`recovered ${pending.length} telegram transfer job(s)`);
    } catch (e: any) {
      this.logger.warn(`telegram transfer recover skipped: ${e?.message || e}`);
    }
  }

  private async runTransferJob(jobId: string) {
    if (this.activeRuns.has(jobId)) return;
    this.activeRuns.add(jobId);
    try {
      const row = await this.prisma.ytdlpTransferJob.findUnique({ where: { id: jobId } });
      if (!row || row.extractor !== 'telegram') return;
      if (row.status === 'COMPLETED' || row.status === 'FAILED') return;

      const payload = row.payload as TelegramTransferPayload;
      if (!payload?.selected?.length || payload.kind !== 'telegram') {
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: 'Telegram 转存任务缺少分集载荷',
            finishedAt: new Date(),
          },
        });
        return;
      }

      await this.prisma.ytdlpTransferJob.update({
        where: { id: jobId },
        data: {
          status: 'RUNNING',
          startedAt: row.startedAt ?? new Date(),
          attempts: { increment: 1 },
        },
      });

      const actorId = payload.actorId != null ? BigInt(payload.actorId) : undefined;
      let jobs = this.parseJobs(row.jobs);
      let failedEpisodes = this.parseFailures(row.failedEpisodes);
      const segmentSeconds = this.normalizeSegmentSeconds(payload.segmentSeconds);
      const doneExtIds = new Set(
        (
          await this.prisma.episode.findMany({
            where: {
              dramaId: BigInt(payload.dramaId),
              sourceProvider: 'telegram',
              externalVideoId: { not: null },
            },
            select: { externalVideoId: true },
          })
        )
          .map((e) => e.externalVideoId)
          .filter(Boolean) as string[],
      );

      const maxEp = await this.prisma.episode.aggregate({
        where: { dramaId: BigInt(payload.dramaId) },
        _max: { episodeNumber: true },
      });
      let nextEpisodeNumber = Math.max(0, Number(maxEp._max.episodeNumber || 0)) + 1;

      for (const ep of payload.selected) {
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: { currentEpisode: nextEpisodeNumber },
        });

        try {
          const downloaded = await this.telegram.download({
            channel: payload.channel,
            messageId: ep.messageId,
          });

          const relativePath = downloaded.relativePath.replace(/^\/+/, '');
          if (!relativePath.startsWith('uploads/')) {
            throw new Error(`unexpected download path: ${relativePath}`);
          }
          const absInUploads = this.upload.resolveAbs(relativePath);
          if (!fs.existsSync(absInUploads) && downloaded.absolutePath) {
            if (fs.existsSync(downloaded.absolutePath)) {
              fs.copyFileSync(downloaded.absolutePath, absInUploads);
            }
          }
          if (!fs.existsSync(absInUploads)) {
            throw new Error(`downloaded file missing: ${relativePath}`);
          }

          const parts = segmentSeconds
            ? await this.upload.splitFixedDuration(relativePath, segmentSeconds, {
                outDirRel: `uploads/tg-split/${jobId}/${ep.messageId}`,
                /** Next episode starts 1s early so cuts don't clip dialogue. */
                overlapSeconds: 1,
              })
            : [
                {
                  relativePath,
                  durationSec:
                    ep.durationSec != null
                      ? Math.round(Number(ep.durationSec))
                      : downloaded.duration != null
                        ? Math.round(Number(downloaded.duration))
                        : null,
                },
              ];

          for (let partIdx = 0; partIdx < parts.length; partIdx++) {
            const part = parts[partIdx];
            const externalVideoId = segmentSeconds
              ? `${ep.messageId}:${partIdx + 1}`
              : String(ep.messageId);
            if (doneExtIds.has(externalVideoId)) {
              continue;
            }

            // Skip already-used episode numbers on this drama.
            while (true) {
              const occupied = await this.prisma.episode.findUnique({
                where: {
                  dramaId_episodeNumber: {
                    dramaId: BigInt(payload.dramaId),
                    episodeNumber: nextEpisodeNumber,
                  },
                },
                select: { id: true },
              });
              if (!occupied) break;
              nextEpisodeNumber += 1;
            }

            const episodeNumber = nextEpisodeNumber;
            nextEpisodeNumber += 1;

            // Split parts: plain “第 N 集”. Web localizes Episode / Épisode from episodeNumber
            // when title matches this generic pattern.
            const title = segmentSeconds
              ? `第 ${episodeNumber} 集`
              : ep.title || downloaded.title || `TG ${ep.messageId}`;

            const created = await this.episodes.create(
              payload.dramaId,
              {
                title,
                episodeNumber,
                isFree: true,
                originalUrl: part.relativePath,
                hlsUrl: part.relativePath,
              },
              actorId,
            );

            const thumbnailUrl = await this.autoEpisodeThumbnailFromVideo(
              part.relativePath,
              `tg-ep-${created.id}`,
            );

            await this.prisma.episode.update({
              where: { id: BigInt(created.id) },
              data: {
                originalUrl: part.relativePath,
                hlsUrl: part.relativePath,
                uploadStatus: 'COMPLETED',
                transcodeStatus: 'PENDING',
                sourcePageUrl: ep.webpageUrl,
                sourceProvider: 'telegram',
                externalVideoId,
                resolvedAt: new Date(),
                resolvedExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
                ...(part.durationSec != null
                  ? { durationSec: Math.round(Number(part.durationSec)) }
                  : {}),
                ...(thumbnailUrl ? { thumbnailUrl } : {}),
              },
            });

            const mediaJob = await this.upload.enqueueTranscode(
              part.relativePath,
              created.id,
              {
                preferR2: true,
                watermarkEnabled: !!payload.watermarkEnabled,
                watermarkX: payload.watermarkX,
                watermarkY: payload.watermarkY,
                watermarkScale: payload.watermarkScale,
              },
            );

            const entry: YtdlpTransferJobEntry = {
              episodeId: created.id,
              episodeNumber,
              jobId: mediaJob.id,
              filename: path.basename(part.relativePath),
              size: fs.existsSync(this.upload.resolveAbs(part.relativePath))
                ? fs.statSync(this.upload.resolveAbs(part.relativePath)).size
                : downloaded.size,
              webpageUrl: ep.webpageUrl,
              downloadUrl: part.relativePath,
              sourceIndex: segmentSeconds
                ? ep.messageId * 10000 + (partIdx + 1)
                : ep.messageId,
            };
            jobs = [...jobs, entry];
            doneExtIds.add(externalVideoId);
            failedEpisodes = failedEpisodes.filter((f) => f.url !== ep.webpageUrl);

            const previewUrl =
              row.previewUrl ||
              this.signLocalMedia(path.basename(part.relativePath));
            await this.prisma.ytdlpTransferJob.update({
              where: { id: jobId },
              data: {
                jobs: jobs as any,
                transferred: jobs.length,
                total: Math.max(row.total || 0, jobs.length),
                previewUrl,
                failedEpisodes: failedEpisodes as any,
                currentEpisode: episodeNumber,
              },
            });
            if (!row.previewUrl) row.previewUrl = previewUrl;
          }
        } catch (e: any) {
          this.logger.warn(
            `telegram transfer ep ${ep.messageId} failed: ${e?.message || e}`,
          );
          failedEpisodes = [
            ...failedEpisodes,
            {
              episodeNumber: ep.index,
              url: ep.webpageUrl,
              error: e?.message || 'download failed',
            },
          ];
          await this.prisma.ytdlpTransferJob.update({
            where: { id: jobId },
            data: { failedEpisodes: failedEpisodes as any },
          });
        }
      }

      if (!jobs.length) {
        await this.prisma.drama
          .delete({ where: { id: BigInt(payload.dramaId) } })
          .catch(() => undefined);
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: `Telegram 分集全部失败（${failedEpisodes.length}）`,
            currentEpisode: null,
            finishedAt: new Date(),
            failedEpisodes: failedEpisodes as any,
            transferred: 0,
            jobs: [] as any,
          },
        });
        return;
      }

      const totalEpisodes = await this.prisma.episode.count({
        where: { dramaId: BigInt(payload.dramaId) },
      });
      await this.prisma.drama
        .update({
          where: { id: BigInt(payload.dramaId) },
          data: { totalEpisodes },
        })
        .catch(() => undefined);

      await this.prisma.ytdlpTransferJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          currentEpisode: null,
          total: Math.max(totalEpisodes, jobs.length),
          transferred: jobs.length,
          jobs: jobs as any,
          failedEpisodes: failedEpisodes as any,
          finishedAt: new Date(),
        },
      });
    } catch (e: any) {
      this.logger.error(`telegram transfer job ${jobId} crashed: ${e?.message || e}`);
      await this.prisma.ytdlpTransferJob
        .update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: e?.message || 'transfer crashed',
            currentEpisode: null,
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    } finally {
      this.activeRuns.delete(jobId);
    }
  }

  private parseJobs(raw: unknown): YtdlpTransferJobEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean) as YtdlpTransferJobEntry[];
  }

  private parseFailures(raw: unknown): YtdlpEpisodeFailure[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean) as YtdlpEpisodeFailure[];
  }

  private toPublicState(row: DbTransferRow): YtdlpTransferJobState {
    const statusMap = {
      QUEUED: 'queued',
      RUNNING: 'running',
      COMPLETED: 'completed',
      FAILED: 'failed',
    } as const;
    return {
      id: row.id,
      dramaId: row.dramaId.toString(),
      slug: row.slug,
      status: statusMap[row.status],
      target: row.target === 'r2' ? 'r2' : 'local',
      preferR2: row.preferR2,
      total: row.total,
      transferred: row.transferred,
      currentEpisode: row.currentEpisode,
      failedEpisodes: this.parseFailures(row.failedEpisodes),
      jobs: this.parseJobs(row.jobs),
      previewUrl: row.previewUrl || undefined,
      extractor: row.extractor || undefined,
      kind: row.kind === 'playlist' || row.kind === 'single' ? row.kind : undefined,
      externalRef: row.externalRef || undefined,
      sourceType: row.sourceType || undefined,
      error: row.error || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async autoEpisodeThumbnailFromVideo(
    inputRel: string,
    label: string,
  ): Promise<string | null> {
    try {
      const frame = await this.upload.extractFirstFrame(inputRel);
      const frameAbs = this.upload.resolveAbs(frame.relativePath);
      if (!fs.existsSync(frameAbs)) return null;
      const buffer = fs.readFileSync(frameAbs);
      const saved = await this.upload.saveImage(
        {
          fieldname: 'file',
          originalname: `${label}.jpg`,
          encoding: '7bit',
          mimetype: 'image/jpeg',
          size: buffer.length,
          buffer,
          destination: '',
          filename: '',
          path: '',
          stream: undefined as any,
        } as Express.Multer.File,
        'thumbnail',
      );
      try {
        fs.unlinkSync(frameAbs);
      } catch {
        /* ignore */
      }
      return saved.url;
    } catch (e: any) {
      this.logger.warn(`tg episode thumbnail failed (${label}): ${e?.message || e}`);
      return null;
    }
  }

  private signLocalMedia(filename: string): string {
    const rel = `uploads/${filename}`.replace(/^\/+/, '');
    const key = requireSecret(
      'CDN_SIGN_KEY',
      this.config.get<string>('CDN_SIGN_KEY'),
      'dev',
    );
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = signMediaPath(rel, exp, key);
    const encoded = rel.split('/').map(encodeURIComponent).join('/');
    return `/api/v1/media/${encoded}?sig=${sig}&exp=${exp}`;
  }
}
