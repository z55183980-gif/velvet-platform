import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  status?: 'DRAFT' | 'LIVE';
  maxEpisodes?: number;
  formatPreference?: YtdlpFormatPreference;
};

export type YtdlpTransferOptions = YtdlpImportOptions & {
  /** local = keep HLS on disk; r2 = push HLS to R2 after transcode */
  target: 'local' | 'r2';
};

@Injectable()
export class YtdlpImportService {
  private readonly logger = new Logger(YtdlpImportService.name);

  constructor(
    private readonly provider: YtdlpProvider,
    private readonly admin: AdminService,
    private readonly episodes: AdminEpisodesService,
    private readonly upload: UploadService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
    const errors: Array<{ episodeNumber: number; url: string; error: string }> = [];

    for (const ep of selected) {
      try {
        const playUrl = await this.provider.resolvePlayUrl(
          ep.webpageUrl,
          preference,
          ep.playlistIndex,
        );
        episodes.push({
          episodeNumber: ep.index,
          title: ep.title || `第 ${ep.index} 集`,
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
   * Download episodes via yt-dlp → local uploads → enqueue HLS transcode.
   * target=local keeps HLS on disk; target=r2 pushes to R2 after ffmpeg (requires credentials).
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

    const preference = opts.formatPreference || 'best';
    const limit =
      opts.maxEpisodes && opts.maxEpisodes > 0
        ? Math.min(opts.maxEpisodes, probe.episodes.length)
        : probe.episodes.length;
    const selected = probe.episodes.slice(0, limit);

    const titleZh = (opts.titleZh || probe.title || '').trim();
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
      },
      actorId,
    );

    await this.prisma.drama.update({
      where: { id: BigInt(drama.id) },
      data: {
        externalRef,
        tags: ['ytdlp', 'transfer', target, probe.extractor, `ytdlp:${probe.id}`],
      } as any,
    });

    const preferR2 = target === 'r2';
    const uploadDir = this.upload.getUploadDir();
    const jobs: Array<{
      episodeId: string;
      episodeNumber: number;
      jobId: string;
      filename: string;
      size: number;
    }> = [];
    const errors: Array<{ episodeNumber: number; url: string; error: string }> = [];

    for (const ep of selected) {
      try {
        const downloaded = await this.provider.downloadToFile(
          ep.webpageUrl,
          uploadDir,
          preference,
          ep.playlistIndex,
        );
        const relativePath = `uploads/${path.basename(downloaded.absPath)}`;
        // Ensure file lives under uploads/ even if yt-dlp wrote to a sibling path
        const absInUploads = this.upload.resolveAbs(relativePath);
        if (path.resolve(downloaded.absPath) !== path.resolve(absInUploads)) {
          fs.copyFileSync(downloaded.absPath, absInUploads);
          try {
            fs.unlinkSync(downloaded.absPath);
          } catch {
            /* ignore */
          }
        }

        const created = await this.episodes.create(
          drama.id,
          {
            title: ep.title || `第 ${ep.index} 集`,
            episodeNumber: ep.index,
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
            ...(ep.durationSec != null ? { durationSec: ep.durationSec } : {}),
          },
        });

        const job = await this.upload.enqueueTranscode(relativePath, created.id, { preferR2 });
        jobs.push({
          episodeId: created.id,
          episodeNumber: ep.index,
          jobId: job.id,
          filename: path.basename(absInUploads),
          size: downloaded.size,
        });
      } catch (e: any) {
        this.logger.warn(`transfer ep ${ep.index} failed: ${e?.message || e}`);
        errors.push({
          episodeNumber: ep.index,
          url: ep.webpageUrl,
          error: e?.message || 'download failed',
        });
      }
    }

    if (!jobs.length) {
      await this.prisma.drama.delete({ where: { id: BigInt(drama.id) } }).catch(() => undefined);
      throw new BizException(
        BizCode.BAD_REQUEST,
        `全部分集下载失败（${errors.length}）`,
      );
    }

    const firstPreviewUrl = this.signLocalMedia(jobs[0].filename);

    return {
      id: drama.id,
      slug: drama.slug,
      status: drama.status,
      sourceType: drama.sourceType,
      target,
      preferR2,
      storageBackend: storage.storageBackend,
      r2Configured: storage.r2Configured,
      ffmpegReady: true,
      extractor: probe.extractor,
      kind: probe.kind,
      externalRef,
      totalEpisodes: jobs.length,
      transferredEpisodes: jobs.length,
      failedEpisodes: errors,
      jobs,
      previewUrl: firstPreviewUrl,
    };
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
