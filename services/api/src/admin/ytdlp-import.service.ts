import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizCode, BizException } from '../common/biz.exception';
import { AdminService } from './admin.service';
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

@Injectable()
export class YtdlpImportService {
  private readonly logger = new Logger(YtdlpImportService.name);

  constructor(
    private readonly provider: YtdlpProvider,
    private readonly admin: AdminService,
    private readonly prisma: PrismaService,
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
        status: opts.status === 'LIVE' ? 'LIVE' : 'DRAFT',
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
}
