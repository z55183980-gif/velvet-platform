import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizCode, BizException } from './biz.exception';

/** 发布前统一校验；创作者提交和管理员审核必须共用。 */
@Injectable()
export class ContentReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertDramaReady(dramaId: bigint) {
    const drama = await this.prisma.drama.findUnique({
      where: { id: dramaId },
      include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
    });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    if (!drama.episodes.length) {
      throw new BizException(BizCode.BAD_REQUEST, '作品至少需要一集才能提交审核');
    }
    if (drama.sourceType === 'ONLINE' && drama.takedownAt) {
      throw new BizException(BizCode.CONFLICT, '该内容已进入下架/投诉处理状态');
    }

    for (let i = 0; i < drama.episodes.length; i++) {
      const ep = drama.episodes[i];
      const expected = i + 1;
      if (ep.episodeNumber !== expected) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          `剧集编号必须从 1 连续排列，当前缺少第 ${expected} 集`,
        );
      }
      if (!ep.hlsUrl && !ep.originalUrl) {
        throw new BizException(BizCode.BAD_REQUEST, `第 ${expected} 集尚未添加片源`);
      }
      const raw = ep.hlsUrl || ep.originalUrl || '';
      const isHttp = /^https?:\/\//i.test(raw);
      // Our CDN URLs are hosting products of local transcode — still require COMPLETED.
      const isOurCdn =
        /cdn\.velvetmovie\.space|\.r2\.dev|r2\.cloudflarestorage/i.test(raw);
      const externalOnline = isHttp && !isOurCdn;
      if (!externalOnline && ep.transcodeStatus !== 'COMPLETED') {
        throw new BizException(
          BizCode.BAD_REQUEST,
          `第 ${expected} 集转码尚未完成（${ep.transcodeStatus}）`,
        );
      }
      if (isHttp) {
        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          throw new BizException(BizCode.BAD_REQUEST, `第 ${expected} 集在线片源地址无效`);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new BizException(BizCode.BAD_REQUEST, `第 ${expected} 集仅支持 http/https 在线片源`);
        }
      }
      if (ep.isFree && (ep.priceCredits > 0n || ep.priceVnd > 0n)) {
        throw new BizException(BizCode.BAD_REQUEST, `第 ${expected} 集为免费集，价格必须为 0`);
      }
    }

    return drama;
  }
}
