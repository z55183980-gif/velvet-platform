import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { BizCode, BizException } from '../common/biz.exception';
import { signMediaPath } from '../common/media-sign.util';
import { UploadService } from '../upload/upload.service';
import { AdminService } from './admin.service';
import { AdminEpisodesService } from './episodes.service';
import { inferExternalUrlExpiry } from './online-drama.util';
import {
  YtdlpFormatPreference,
  YtdlpProvider,
} from './ytdlp.provider';

export type YtdlpImportOptions = {
  url: string;
  categorySlug: string;
  titleZh?: string;
  titleEn?: string;
  /** Ignored — imports always create DRAFT. Kept for API compatibility. */
  status?: 'DRAFT';
  maxEpisodes?: number;
  formatPreference?: YtdlpFormatPreference;
};

export type YtdlpTransferOptions = YtdlpImportOptions & {
  /** local = keep HLS on disk; r2 = push HLS to R2 after transcode */
  target: 'local' | 'r2';
};

export type YtdlpEpisodeFailure = {
  episodeNumber: number;
  url: string;
  error: string;
};

export type YtdlpTransferJobEntry = {
  episodeId: string;
  episodeNumber: number;
  jobId: string;
  filename: string;
  size: number;
  webpageUrl?: string;
  sourceIndex?: number;
};

export type YtdlpTransferJobState = {
  id: string;
  dramaId: string;
  slug: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  target: 'local' | 'r2';
  preferR2: boolean;
  total: number;
  transferred: number;
  currentEpisode: number | null;
  failedEpisodes: YtdlpEpisodeFailure[];
  jobs: YtdlpTransferJobEntry[];
  previewUrl?: string;
  extractor?: string;
  kind?: 'single' | 'playlist';
  externalRef?: string;
  sourceType?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type TransferPayload = {
  preference: YtdlpFormatPreference;
  preferR2: boolean;
  dramaId: string;
  actorId?: string;
  selected: Array<{
    index: number;
    id: string;
    title?: string;
    webpageUrl: string;
    playlistIndex?: number;
    durationSec?: number | null;
  }>;
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
  payload: unknown;
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
export class YtdlpImportService implements OnModuleInit {
  private readonly logger = new Logger(YtdlpImportService.name);
  /** In-process lock so recover + concurrent poll doesn't double-run. */
  private readonly activeRuns = new Set<string>();

  constructor(
    private readonly provider: YtdlpProvider,
    private readonly admin: AdminService,
    private readonly episodes: AdminEpisodesService,
    private readonly upload: UploadService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    // Defer slightly so the HTTP server can bind first.
    setTimeout(() => {
      void this.recoverPendingTransferJobs();
    }, 1500);
  }

  status() {
    return this.provider.status();
  }

  probe(url: string) {
    return this.provider.probe(url);
  }

  resolve(
    url: string,
    formatPreference?: YtdlpFormatPreference,
    playlistIndex?: number,
  ) {
    return this.provider
      .resolvePlayUrl(url, formatPreference || 'best_hls', playlistIndex)
      .then((playUrl) => ({
        playUrl,
        originalUrl: url,
      }));
  }

  /**
   * Download one public-page item via yt-dlp into a temp file for browser attachment download.
   * Caller must delete absPath after the response finishes.
   */
  async downloadEpisodeForBrowser(opts: {
    url: string;
    formatPreference?: YtdlpFormatPreference;
    playlistIndex?: number;
    filenameHint?: string;
  }): Promise<{ absPath: string; filename: string; size: number; mime: string }> {
    const pageUrl = String(opts.url || '').trim();
    if (!pageUrl) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');

    const tmpDir = path.join(this.upload.getStorageRoot(), 'tmp', 'ytdlp-browser-dl');
    fs.mkdirSync(tmpDir, { recursive: true });

    // HLS playlists are not useful as a single browser attachment — prefer a merged MP4.
    const pref: YtdlpFormatPreference =
      opts.formatPreference === 'best_hls'
        ? 'best_mp4'
        : opts.formatPreference || 'best_mp4';

    const downloaded = await this.provider.downloadToFile(
      pageUrl,
      tmpDir,
      pref,
      opts.playlistIndex,
    );

    const ext = path.extname(downloaded.absPath) || '.mp4';
    const filename = this.safeDownloadFilename(opts.filenameHint, downloaded.filename, ext);
    const mime =
      ext.toLowerCase() === '.webm'
        ? 'video/webm'
        : ext.toLowerCase() === '.mkv'
          ? 'video/x-matroska'
          : 'video/mp4';

    return {
      absPath: downloaded.absPath,
      filename,
      size: downloaded.size,
      mime,
    };
  }

  private safeDownloadFilename(hint: string | undefined, fallback: string, ext: string) {
    const raw = String(hint || fallback || 'episode')
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    const base = raw || 'episode';
    if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
    return `${base}${ext.startsWith('.') ? ext : `.${ext}`}`;
  }

  async getTransferJob(jobId: string): Promise<YtdlpTransferJobState> {
    const job = await this.prisma.ytdlpTransferJob.findUnique({
      where: { id: String(jobId || '').trim() },
    });
    if (!job) throw new BizException(BizCode.NOT_FOUND, '转存任务不存在或已过期');
    return this.toPublicState(job as DbTransferRow);
  }

  async importDrama(opts: YtdlpImportOptions, actorId?: bigint) {
    const pageUrl = String(opts.url || '').trim();
    if (!pageUrl) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');
    const categorySlug = String(opts.categorySlug || '').trim();
    if (!categorySlug) throw new BizException(BizCode.BAD_REQUEST, '请选择分类');

    const probe = await this.provider.probe(pageUrl);
    const externalRef = this.provider.externalRefFor(
      probe.webpageUrl,
      probe.extractor,
      probe.id,
    );

    const existing = await this.prisma.drama.findFirst({
      where: { externalRef } as any,
      select: { id: true, slug: true, titleZh: true, status: true },
    });
    if (existing) {
      throw new BizException(
        BizCode.CONFLICT,
        `该公开资源已导入: id=${existing.id} slug=${existing.slug}`,
      );
    }

    if (!probe.episodes.length) {
      throw new BizException(BizCode.BAD_REQUEST, '未解析到分集，无法导入');
    }

    const preference = opts.formatPreference || 'best_hls';
    const limit =
      opts.maxEpisodes && opts.maxEpisodes > 0
        ? Math.min(opts.maxEpisodes, probe.episodes.length)
        : probe.episodes.length;
    const selected = probe.episodes.slice(0, limit);

    const episodes: Array<{
      episodeNumber: number;
      title?: string;
      sourceUrl: string;
      sourcePageUrl?: string;
      sourceProvider?: string;
      externalVideoId?: string;
      playlistIndex?: number;
      isFree?: boolean;
    }> = [];
    const errors: YtdlpEpisodeFailure[] = [];

    for (const ep of selected) {
      try {
        const playUrl = await this.provider.resolvePlayUrl(
          ep.webpageUrl,
          preference,
          ep.playlistIndex,
        );
        // Consecutive 1..n so partial resolve failures do not leave publish gaps.
        episodes.push({
          episodeNumber: episodes.length + 1,
          title: ep.title || `第 ${episodes.length + 1} 集`,
          sourceUrl: playUrl,
          sourcePageUrl: ep.webpageUrl,
          sourceProvider: probe.extractor,
          externalVideoId: ep.id,
          playlistIndex: ep.playlistIndex,
          isFree: true,
        });
      } catch (e: any) {
        this.logger.warn(`resolve ep ${ep.index} failed: ${e?.message || e}`);
        errors.push({
          episodeNumber: ep.index,
          url: ep.webpageUrl,
          error: e?.message || 'resolve failed',
        });
      }
    }

    if (!episodes.length) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `全部分集播放地址解析失败（${errors.length}）`,
      );
    }

    const titleZh = (opts.titleZh || probe.title || '').trim();
    const created = await this.admin.createOnlineDrama(
      {
        titleZh,
        titleEn: opts.titleEn?.trim() || titleZh,
        descriptionZh: probe.description || undefined,
        descriptionEn: probe.description || undefined,
        categorySlug,
        coverUrl: probe.coverUrl,
        lockMode: 'ALL_FREE',
        freeEpisodeCount: episodes.length,
        // 拉取的第三方内容必须先完成来源/可播审核，不允许直接上线。
        status: 'DRAFT',
        externalRef,
        sourceTags: ['ytdlp', probe.extractor, `ytdlp:${probe.id}`],
        relaxedPlayUrl: true,
        episodes,
      },
      actorId,
    );

    return {
      ...created,
      externalRef,
      extractor: probe.extractor,
      kind: probe.kind,
      resolvedEpisodes: episodes.length,
      failedEpisodes: errors,
    };
  }

  /** 将公开页面/播放列表解析后追加到已有草稿作品，并按外部视频 ID 去重。 */
  async appendToDrama(
    dramaId: string,
    opts: Pick<YtdlpImportOptions, 'url' | 'maxEpisodes' | 'formatPreference'>,
    actorId?: bigint,
  ) {
    const drama = await this.prisma.drama.findUnique({ where: { id: BigInt(dramaId) } });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    if (drama.sourceType !== 'ONLINE') {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '仅外链播放剧可追加公开资源；托管剧请用上传或转存',
      );
    }
    if (drama.status !== 'DRAFT' && drama.status !== 'REJECTED' && drama.status !== 'OFFLINE') {
      throw new BizException(BizCode.CONFLICT, '审核中或已上线作品不能追加公开资源');
    }
    const probe = await this.provider.probe(opts.url);
    const limit = opts.maxEpisodes && opts.maxEpisodes > 0
      ? Math.min(Math.floor(opts.maxEpisodes), probe.episodes.length)
      : probe.episodes.length;
    const selected = probe.episodes.slice(0, limit);
    const existing = await this.prisma.episode.findMany({
      where: { dramaId: drama.id, sourceProvider: probe.extractor },
      select: { externalVideoId: true },
    });
    const seen = new Set(existing.map((ep) => ep.externalVideoId).filter(Boolean));
    const added: Array<{ id: string; episodeNumber: number; title?: string }> = [];
    const skipped: Array<{ externalVideoId: string; reason: string }> = [];
    const errors: Array<{ externalVideoId: string; error: string }> = [];

    for (const source of selected) {
      if (seen.has(source.id)) {
        skipped.push({ externalVideoId: source.id, reason: 'duplicate' });
        continue;
      }
      try {
        const playUrl = await this.provider.resolvePlayUrl(
          source.webpageUrl,
          opts.formatPreference || 'best_hls',
          source.playlistIndex,
        );
        const created = await this.episodes.create(
          dramaId,
          {
            title: source.title,
            isFree: true,
            hlsUrl: playUrl,
            originalUrl: playUrl,
          },
          actorId,
        );
        await this.prisma.episode.update({
          where: { id: BigInt(created.id) },
          data: {
            sourcePageUrl: source.webpageUrl,
            sourceProvider: probe.extractor,
            externalVideoId: source.id,
            playlistIndex: source.playlistIndex,
            resolvedAt: new Date(),
            resolvedExpiresAt: inferExternalUrlExpiry(playUrl),
            transcodeStatus: 'COMPLETED',
          },
        });
        added.push({ id: created.id, episodeNumber: created.episodeNumber, title: source.title });
        seen.add(source.id);
      } catch (e: any) {
        errors.push({ externalVideoId: source.id, error: e?.message || String(e) });
      }
    }
    await this.prisma.drama.update({
      where: { id: drama.id },
      data: { status: 'DRAFT', totalEpisodes: await this.prisma.episode.count({ where: { dramaId: drama.id } }) },
    });
    return { added, skipped, errors, extractor: probe.extractor };
  }

  /**
   * Start async transfer: create drama shell immediately, download+transcode in background.
   * Poll GET /ytdlp/transfer/:jobId for progress. Job state is DB-backed (survives restart).
   */
  async transferDrama(opts: YtdlpTransferOptions, actorId?: bigint) {
    const pageUrl = String(opts.url || '').trim();
    if (!pageUrl) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');
    const categorySlug = String(opts.categorySlug || '').trim();
    if (!categorySlug) throw new BizException(BizCode.BAD_REQUEST, '请选择分类');
    const target = opts.target === 'r2' ? 'r2' : 'local';

    const storage = this.upload.storageStatus();
    if (target === 'r2' && !storage.r2Configured) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'R2 未配置凭证，无法转存到 R2（请设置 R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY）',
      );
    }
    if (!(await this.upload.detectFfmpeg())) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '未检测到 ffmpeg，无法转码。请安装 ffmpeg 或设置 FFMPEG_PATH 后重试',
      );
    }

    const probe = await this.provider.probe(pageUrl);
    const externalRef = this.provider.externalRefFor(
      probe.webpageUrl,
      probe.extractor,
      probe.id,
    );

    const existing = await this.prisma.drama.findFirst({
      where: { externalRef } as any,
      select: { id: true, slug: true, titleZh: true, status: true },
    });
    if (existing) {
      throw new BizException(
        BizCode.CONFLICT,
        `该公开资源已导入: id=${existing.id} slug=${existing.slug}`,
      );
    }

    if (!probe.episodes.length) {
      throw new BizException(BizCode.BAD_REQUEST, '未解析到分集，无法转存');
    }

    const preference =
      opts.formatPreference === 'best_hls' ? 'best' : opts.formatPreference || 'best';
    const limit =
      opts.maxEpisodes && opts.maxEpisodes > 0
        ? Math.min(opts.maxEpisodes, probe.episodes.length)
        : probe.episodes.length;
    const selected = probe.episodes.slice(0, limit);

    const titleZh = (opts.titleZh || probe.title || '').trim();
    const sourceType = target === 'r2' ? 'R2' : 'LOCAL';
    const drama = await this.admin.createLocalUploadDrama(
      {
        titleZh,
        titleEn: opts.titleEn?.trim() || titleZh,
        descriptionZh: probe.description || undefined,
        descriptionEn: probe.description || undefined,
        categorySlug,
        coverUrl: probe.coverUrl,
        lockMode: 'ALL_FREE',
        freeEpisodeCount: selected.length,
        status: 'DRAFT',
        sourceType,
        sourceTags: ['ytdlp', 'transfer', target, probe.extractor, `ytdlp:${probe.id}`],
        totalEpisodes: selected.length,
        externalRef,
      },
      actorId,
    );

    const preferR2 = target === 'r2';
    const jobId = randomUUID();
    const payload: TransferPayload = {
      preference,
      preferR2,
      dramaId: drama.id,
      actorId: actorId != null ? String(actorId) : undefined,
      selected: selected.map((ep) => ({
        index: ep.index,
        id: ep.id,
        title: ep.title,
        webpageUrl: ep.webpageUrl,
        playlistIndex: ep.playlistIndex,
        durationSec: ep.durationSec ?? null,
      })),
    };

    const row = await this.prisma.ytdlpTransferJob.create({
      data: {
        id: jobId,
        dramaId: BigInt(drama.id),
        slug: drama.slug,
        status: 'QUEUED',
        target,
        preferR2,
        total: selected.length,
        transferred: 0,
        currentEpisode: null,
        failedEpisodes: [],
        jobs: [],
        payload: payload as any,
        extractor: probe.extractor,
        kind: probe.kind,
        externalRef,
        sourceType: drama.sourceType,
      },
    });

    void this.runTransferJob(jobId);
    await this.pruneTransferJobs();

    return {
      jobId,
      id: drama.id,
      slug: drama.slug,
      status: drama.status,
      jobStatus: 'queued' as const,
      sourceType: drama.sourceType,
      target,
      preferR2,
      storageBackend: storage.storageBackend,
      r2Configured: storage.r2Configured,
      ffmpegReady: true,
      extractor: probe.extractor,
      kind: probe.kind,
      externalRef,
      totalEpisodes: selected.length,
      transferredEpisodes: 0,
      failedEpisodes: [] as YtdlpEpisodeFailure[],
      jobs: [] as YtdlpTransferJobEntry[],
      async: true as const,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async recoverPendingTransferJobs() {
    try {
      const pending = await this.prisma.ytdlpTransferJob.findMany({
        where: { status: { in: ['QUEUED', 'RUNNING'] } },
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
      this.logger.log(`recovered ${pending.length} ytdlp transfer job(s)`);
    } catch (e: any) {
      this.logger.warn(`transfer job recover skipped: ${e?.message || e}`);
    }
  }

  private async runTransferJob(jobId: string) {
    if (this.activeRuns.has(jobId)) return;
    this.activeRuns.add(jobId);

    try {
      const row = await this.prisma.ytdlpTransferJob.findUnique({ where: { id: jobId } });
      if (!row) return;
      if (row.status === 'COMPLETED' || row.status === 'FAILED') return;

      const payload = row.payload as TransferPayload;
      if (!payload?.selected?.length) {
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: '转存任务缺少分集载荷，无法恢复',
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

      const uploadDir = this.upload.getUploadDir();
      const extractor = row.extractor || 'unknown';
      const actorId = payload.actorId != null ? BigInt(payload.actorId) : undefined;
      let jobs = this.parseJobs(row.jobs);
      let failedEpisodes = this.parseFailures(row.failedEpisodes);
      const doneUrls = new Set(
        jobs.map((j) => j.webpageUrl).filter((u): u is string => !!u),
      );

      for (const ep of payload.selected) {
        if (doneUrls.has(ep.webpageUrl)) continue;

        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: { currentEpisode: ep.index },
        });

        try {
          const downloaded = await this.provider.downloadToFile(
            ep.webpageUrl,
            uploadDir,
            payload.preference,
            ep.playlistIndex,
          );
          const relativePath = `uploads/${path.basename(downloaded.absPath)}`;
          const absInUploads = this.upload.resolveAbs(relativePath);
          if (path.resolve(downloaded.absPath) !== path.resolve(absInUploads)) {
            fs.copyFileSync(downloaded.absPath, absInUploads);
            try {
              fs.unlinkSync(downloaded.absPath);
            } catch {
              /* ignore */
            }
          }

          // Consecutive episode numbers for successful transfers only.
          const episodeNumber = jobs.length + 1;
          const created = await this.episodes.create(
            payload.dramaId,
            {
              title: ep.title || `第 ${episodeNumber} 集`,
              episodeNumber,
              isFree: true,
              originalUrl: relativePath,
              hlsUrl: relativePath,
            },
            actorId,
          );

          await this.prisma.episode.update({
            where: { id: BigInt(created.id) },
            data: {
              originalUrl: relativePath,
              hlsUrl: relativePath,
              uploadStatus: 'COMPLETED',
              transcodeStatus: 'PENDING',
              sourcePageUrl: ep.webpageUrl,
              sourceProvider: extractor,
              externalVideoId: ep.id,
              playlistIndex: ep.playlistIndex ?? null,
              resolvedAt: new Date(),
              ...(ep.durationSec != null ? { durationSec: ep.durationSec } : {}),
            },
          });

          const mediaJob = await this.upload.enqueueTranscode(relativePath, created.id, {
            preferR2: payload.preferR2,
          });
          const entry: YtdlpTransferJobEntry = {
            episodeId: created.id,
            episodeNumber,
            jobId: mediaJob.id,
            filename: path.basename(absInUploads),
            size: downloaded.size,
            webpageUrl: ep.webpageUrl,
            sourceIndex: ep.index,
          };
          jobs = [...jobs, entry];
          doneUrls.add(ep.webpageUrl);
          failedEpisodes = failedEpisodes.filter((f) => f.url !== ep.webpageUrl);

          const previewUrl =
            row.previewUrl || this.signLocalMedia(path.basename(absInUploads));
          await this.prisma.ytdlpTransferJob.update({
            where: { id: jobId },
            data: {
              jobs: jobs as any,
              transferred: jobs.length,
              previewUrl,
              failedEpisodes: failedEpisodes as any,
            },
          });
          if (!row.previewUrl) {
            row.previewUrl = previewUrl;
          }
        } catch (e: any) {
          this.logger.warn(`transfer ep ${ep.index} failed: ${e?.message || e}`);
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
        await this.prisma.drama.delete({ where: { id: BigInt(payload.dramaId) } }).catch(() => undefined);
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: `全部分集下载失败（${failedEpisodes.length}）`,
            currentEpisode: null,
            finishedAt: new Date(),
            failedEpisodes: failedEpisodes as any,
            transferred: 0,
            jobs: [] as any,
          },
        });
        return;
      }

      await this.prisma.drama
        .update({
          where: { id: BigInt(payload.dramaId) },
          data: { totalEpisodes: jobs.length },
        })
        .catch(() => undefined);

      await this.prisma.ytdlpTransferJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          currentEpisode: null,
          transferred: jobs.length,
          jobs: jobs as any,
          failedEpisodes: failedEpisodes as any,
          finishedAt: new Date(),
        },
      });
    } catch (e: any) {
      this.logger.error(`transfer job ${jobId} crashed: ${e?.message || e}`);
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

  /** Drop oldest completed/failed DB jobs when table grows. */
  private async pruneTransferJobs(maxKeep = 80) {
    const doneCount = await this.prisma.ytdlpTransferJob.count({
      where: { status: { in: ['COMPLETED', 'FAILED'] } },
    });
    if (doneCount <= maxKeep) return;
    const overflow = doneCount - maxKeep;
    const old = await this.prisma.ytdlpTransferJob.findMany({
      where: { status: { in: ['COMPLETED', 'FAILED'] } },
      orderBy: { updatedAt: 'asc' },
      take: overflow,
      select: { id: true },
    });
    if (old.length) {
      await this.prisma.ytdlpTransferJob.deleteMany({
        where: { id: { in: old.map((j) => j.id) } },
      });
    }
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

  private parseJobs(raw: unknown): YtdlpTransferJobEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean) as YtdlpTransferJobEntry[];
  }

  private parseFailures(raw: unknown): YtdlpEpisodeFailure[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean) as YtdlpEpisodeFailure[];
  }

  private signLocalMedia(filename: string): string {
    const rel = `uploads/${filename}`.replace(/^\/+/, '');
    const key = this.config.get<string>('CDN_SIGN_KEY') || 'dev';
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = signMediaPath(rel, exp, key);
    const encoded = rel.split('/').map(encodeURIComponent).join('/');
    return `/api/v1/media/${encoded}?sig=${sig}&exp=${exp}`;
  }
}
