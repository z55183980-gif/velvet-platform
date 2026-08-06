import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DramasService } from '../dramas/dramas.service';
import { BizException, BizCode } from '../common/biz.exception';
import { signMediaPath } from '../common/media-sign.util';
import { LockAccessService } from '../common/lock-access.service';
import { YtdlpProvider } from '../admin/ytdlp.provider';
import { inferExternalUrlExpiry } from '../admin/online-drama.util';

@Injectable()
export class EpisodesService {
  private readonly refreshes = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dramas: DramasService,
    private readonly config: ConfigService,
    private readonly lockAccess: LockAccessService,
    private readonly ytdlp: YtdlpProvider,
  ) {}

  /** 生成 HLS/片源短时签名播放地址；未登录仅允许免费集 */
  async getPlayUrl(episodeId: bigint, userId?: bigint) {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { drama: true },
    });
    if (!episode) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    if (episode.drama?.status !== 'LIVE') {
      throw new BizException(BizCode.NOT_FOUND, 'common.notFound');
    }

    const policy = await this.lockAccess.resolveForDrama(episode.drama);
    const free = this.lockAccess.isFree(episode, policy);
    let unlocked = free;
    let previewOnly = false;
    if (!free) {
      if (userId) {
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
    }
    if (!unlocked) {
      if (episode.previewSeconds > 0) previewOnly = true;
      else if (!userId) throw new BizException(BizCode.UNAUTHORIZED, 'Chưa đăng nhập');
      else throw new BizException(BizCode.FORBIDDEN, 'Tập này cần mở khóa để xem', 402 as any);
    }

    const key = this.config.get('CDN_SIGN_KEY') || 'dev';
    const base = (this.config.get<string>('CDN_BASE_URL') || 'https://cdn.velvetmovie.space').replace(
      /\/$/,
      '',
    );
    const refreshed = await this.refreshExternalUrlIfNeeded(episode);
    const raw = refreshed || episode.hlsUrl || `${base}/v/${episodeId}/index.m3u8`;
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
        previewSeconds: previewOnly ? episode.previewSeconds : 0,
        previewOnly,
        mediaWidth: episode.mediaWidth,
        mediaHeight: episode.mediaHeight,
        mediaOrientation: episode.mediaOrientation,
      };
    }

    // 第三方在线直链：原样返回，避免追加签名参数破坏外链
    const isOwnCdn = Boolean(base) && raw.startsWith(base);
    if (!isOwnCdn || episode.drama?.sourceType === 'ONLINE') {
      return {
        playUrl: raw,
        expiresAt: new Date(exp * 1000).toISOString(),
        durationSec: episode.durationSec,
        previewSeconds: previewOnly ? episode.previewSeconds : 0,
        previewOnly,
        mediaWidth: episode.mediaWidth,
        mediaHeight: episode.mediaHeight,
        mediaOrientation: episode.mediaOrientation,
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
      previewSeconds: previewOnly ? episode.previewSeconds : 0,
      previewOnly,
      mediaWidth: episode.mediaWidth,
      mediaHeight: episode.mediaHeight,
      mediaOrientation: episode.mediaOrientation,
    };
  }

  private async refreshExternalUrlIfNeeded(episode: {
    id: bigint;
    hlsUrl: string | null;
    sourcePageUrl: string | null;
    playlistIndex: number | null;
    resolvedExpiresAt: Date | null;
  }) {
    if (!episode.sourcePageUrl) return episode.hlsUrl;
    const refreshAt = episode.resolvedExpiresAt?.getTime() ?? 0;
    if (episode.hlsUrl && refreshAt > Date.now() + 5 * 60 * 1000) return episode.hlsUrl;

    const key = episode.id.toString();
    const existing = this.refreshes.get(key);
    if (existing) return existing;
    const task = this.ytdlp
      .resolvePlayUrl(episode.sourcePageUrl, 'best_hls', episode.playlistIndex ?? undefined)
      .then(async (playUrl) => {
        await this.prisma.episode.update({
          where: { id: episode.id },
          data: {
            hlsUrl: playUrl,
            resolvedAt: new Date(),
            resolvedExpiresAt: inferExternalUrlExpiry(playUrl),
          },
        });
        return playUrl;
      })
      .finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, task);
    return task;
  }

  async reportProgress(userId: bigint, episodeId: bigint, progressSec: number) {
    const ep = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      select: { dramaId: true, durationSec: true },
    });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    const duration = Math.max(0, ep.durationSec || 0);
    const raw = Number(progressSec);
    if (!Number.isFinite(raw) || raw < 0) {
      throw new BizException(BizCode.BAD_REQUEST, 'progressSec không hợp lệ');
    }
    // 播放器 currentTime 常略超 durationSec；未知时长再放宽到 24h
    let clamped = Math.floor(raw);
    if (duration > 0) clamped = Math.min(clamped, duration);
    else if (clamped > 86400) {
      throw new BizException(BizCode.BAD_REQUEST, 'progressSec vượt quá giới hạn');
    }
    const existing = await this.prisma.watchHistory.findUnique({
      where: { userId_episodeId: { userId, episodeId } },
      select: { id: true },
    });
    await this.prisma.watchHistory.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: { userId, episodeId, dramaId: ep.dramaId, progressSec: clamped },
      update: { progressSec: clamped, watchedAt: new Date(), dramaId: ep.dramaId },
    });
    // 仅首次写入历史时计一次播放，避免进度心跳刷爆 viewCount
    if (!existing) {
      await this.prisma.episode.update({
        where: { id: episodeId },
        data: { viewCount: { increment: 1 } },
      });
    }
    return { success: true };
  }
}
