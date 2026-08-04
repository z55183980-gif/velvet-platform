import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DramasService } from '../dramas/dramas.service';
import { BizException, BizCode } from '../common/biz.exception';
import { signMediaPath } from '../common/media-sign.util';
import { LockAccessService } from '../common/lock-access.service';

@Injectable()
export class EpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dramas: DramasService,
    private readonly config: ConfigService,
    private readonly lockAccess: LockAccessService,
  ) {}

  /** 生成 HLS/片源短时签名播放地址 */
  async getPlayUrl(episodeId: bigint, userId: bigint) {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { drama: true },
    });
    if (!episode) throw new BizException(BizCode.NOT_FOUND, 'Tập phim không tồn tại');

    const policy = await this.lockAccess.resolveForDrama(episode.drama);
    const free = this.lockAccess.isFree(episode, policy);
    let unlocked = free;
    if (!free) {
      const [u, user, dramaUnlock] = await Promise.all([
        this.prisma.userUnlock.findUnique({
          where: { userId_episodeId: { userId, episodeId } },
        }),
        this.prisma.user.findUnique({ where: { id: userId }, select: { vipExpireAt: true } }),
        this.prisma.userDramaUnlock.findUnique({
          where: { userId_dramaId: { userId, dramaId: episode.dramaId } },
        }),
      ]);
      const vipActive = !!(user?.vipExpireAt && user.vipExpireAt.getTime() > Date.now());
      unlocked = !!u || vipActive || !!dramaUnlock;
    }
    if (!unlocked) {
      throw new BizException(BizCode.FORBIDDEN, 'Tập này cần mở khóa để xem', 402 as any);
    }

    const key = this.config.get('CDN_SIGN_KEY') || 'dev';
    const base = (this.config.get<string>('CDN_BASE_URL') || 'https://cdn.velvetmovie.space').replace(
      /\/$/,
      '',
    );
    const raw = episode.hlsUrl || `${base}/v/${episodeId}/index.m3u8`;
    const exp = Math.floor(Date.now() / 1000) + 3600; // 1h

    // 本地样片（相对路径）→ /api/v1/media + path HMAC
    if (!/^https?:\/\//.test(raw)) {
      const rel = raw.replace(/^\/+/, '');
      const sig = signMediaPath(rel, exp, key);
      const encoded = rel.split('/').map(encodeURIComponent).join('/');
      return {
        playUrl: `/api/v1/media/${encoded}?sig=${sig}&exp=${exp}`,
        expiresAt: new Date(exp * 1000).toISOString(),
        durationSec: episode.durationSec,
      };
    }

    // 第三方在线直链：原样返回，避免追加签名参数破坏外链
    const isOwnCdn = Boolean(base) && raw.startsWith(base);
    if (!isOwnCdn || episode.drama?.sourceType === 'ONLINE') {
      return {
        playUrl: raw,
        expiresAt: new Date(exp * 1000).toISOString(),
        durationSec: episode.durationSec,
      };
    }

    // 自有 CDN（cdn.velvetmovie.space / velvet-cdn Worker）：object key path HMAC
    let playUrl = raw;
    try {
      const u = new URL(raw);
      const objectKey = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
      if (objectKey) {
        u.searchParams.set('sig', signMediaPath(objectKey, exp, key));
        u.searchParams.set('exp', String(exp));
        playUrl = u.toString();
      }
    } catch {
      /* keep raw */
    }
    return {
      playUrl,
      expiresAt: new Date(exp * 1000).toISOString(),
      durationSec: episode.durationSec,
    };
  }

  async reportProgress(userId: bigint, episodeId: bigint, progressSec: number) {
    const ep = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      select: { dramaId: true, durationSec: true },
    });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'Tập phim không tồn tại');
    const duration = Math.max(0, ep.durationSec || 0);
    const raw = Number(progressSec);
    if (!Number.isFinite(raw)) {
      throw new BizException(BizCode.BAD_REQUEST, 'progressSec không hợp lệ');
    }
    if (raw < 0 || (duration > 0 && raw > duration)) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `progressSec phải trong khoảng [0, ${duration}]`,
      );
    }
    // durationSec 未知时仍禁止负数，上限放宽到合理最大值
    if (duration === 0 && raw > 86400) {
      throw new BizException(BizCode.BAD_REQUEST, 'progressSec vượt quá giới hạn');
    }
    const clamped = Math.floor(raw);
    await this.prisma.watchHistory.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: { userId, episodeId, dramaId: ep.dramaId, progressSec: clamped },
      update: { progressSec: clamped, watchedAt: new Date(), dramaId: ep.dramaId },
    });
    await this.prisma.episode.update({
      where: { id: episodeId },
      data: { viewCount: { increment: 1 } },
    });
    return { success: true };
  }
}
