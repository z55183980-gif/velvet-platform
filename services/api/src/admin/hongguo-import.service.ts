import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizCode, BizException } from '../common/biz.exception';
import { AdminService } from './admin.service';
import { HongguoProvider } from './hongguo.provider';

export type HongguoImportOptions = {
  id: string;
  categorySlug: string;
  titleZh?: string;
  titleVi?: string;
  status?: 'DRAFT' | 'LIVE';
  /** 最多解析并导入的集数；默认全部 */
  maxEpisodes?: number;
};

@Injectable()
export class HongguoImportService {
  private readonly logger = new Logger(HongguoImportService.name);

  constructor(
    private readonly provider: HongguoProvider,
    private readonly admin: AdminService,
    private readonly prisma: PrismaService,
  ) {}

  status() {
    return this.provider.status();
  }

  search(keyword: string, page = 1) {
    return this.provider.search(keyword, page);
  }

  detail(id: string) {
    return this.provider.detail(id);
  }

  async importDrama(opts: HongguoImportOptions, actorId?: bigint) {
    const bookId = String(opts.id || '').trim();
    if (!bookId) throw new BizException(BizCode.BAD_REQUEST, '缺少红果剧集 ID');
    const categorySlug = String(opts.categorySlug || '').trim();
    if (!categorySlug) throw new BizException(BizCode.BAD_REQUEST, '请选择分类');

    const externalRef = `hongguo:${bookId}`;
    const existing = await this.prisma.drama.findFirst({
      where: { externalRef } as any,
      select: { id: true, slug: true, titleZh: true, status: true },
    });
    if (existing) {
      throw new BizException(
        BizCode.CONFLICT,
        `该红果剧集已导入: id=${existing.id} slug=${existing.slug}`,
      );
    }

    const detail = await this.provider.detail(bookId);
    if (!detail.episodes.length) {
      throw new BizException(BizCode.BAD_REQUEST, '该剧暂无分集信息，无法导入');
    }

    const limit =
      opts.maxEpisodes && opts.maxEpisodes > 0
        ? Math.min(opts.maxEpisodes, detail.episodes.length)
        : detail.episodes.length;
    const selected = detail.episodes.slice(0, limit);

    const episodes: Array<{
      episodeNumber: number;
      title?: string;
      sourceUrl: string;
      isFree?: boolean;
    }> = [];
    const errors: Array<{ episodeNumber: number; videoId: string; error: string }> = [];

    for (const ep of selected) {
      try {
        const playUrl = await this.provider.resolvePlayUrl(ep.videoId);
        episodes.push({
          episodeNumber: ep.episodeNumber,
          title: ep.title || `第 ${ep.episodeNumber} 集`,
          sourceUrl: playUrl,
          isFree: true,
        });
      } catch (e: any) {
        this.logger.warn(`resolve ep ${ep.videoId} failed: ${e?.message || e}`);
        errors.push({
          episodeNumber: ep.episodeNumber,
          videoId: ep.videoId,
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

    const titleZh = (opts.titleZh || detail.title || '').trim();
    const created = await this.admin.createOnlineDrama(
      {
        titleZh,
        titleVi: opts.titleVi?.trim() || titleZh,
        descriptionZh: detail.intro || undefined,
        descriptionVi: detail.intro || undefined,
        categorySlug,
        coverUrl: detail.coverUrl,
        lockMode: 'ALL_FREE',
        freeEpisodeCount: episodes.length,
        status: opts.status === 'DRAFT' ? 'DRAFT' : 'LIVE',
        externalRef,
        sourceTags: ['hongguo', `hongguo:${bookId}`],
        relaxedPlayUrl: true,
        episodes,
      },
      actorId,
    );

    return {
      ...created,
      externalRef,
      hongguoId: bookId,
      resolvedEpisodes: episodes.length,
      failedEpisodes: errors,
    };
  }
}
