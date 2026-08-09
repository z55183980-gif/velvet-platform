import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { DramasService } from '../dramas/dramas.service';
import { BizException, BizCode } from '../common/biz.exception';
import { signMediaPath, signPlaylistUri } from '../common/media-sign.util';
import { requireSecret } from '../common/security-config';
import { LockAccessService } from '../common/lock-access.service';
import { YtdlpProvider } from '../admin/ytdlp.provider';
import { inferExternalUrlExpiry } from '../admin/online-drama.util';
import { R2StorageService } from '../storage/r2.storage.service';
import {
  estimatePreviewMaxBytes,
  isMasterM3u8,
  pickMasterVariantUri,
  resolvePlaylistChildUri,
  signEpisodePreview,
  truncateM3u8ByDuration,
  verifyEpisodePreviewSig,
} from './preview-media.util';

@Injectable()
export class EpisodesService {
  private readonly refreshes = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dramas: DramasService,
    private readonly config: ConfigService,
    private readonly lockAccess: LockAccessService,
    private readonly ytdlp: YtdlpProvider,
    private readonly r2: R2StorageService,
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

    if (userId) {
      const account = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, vipExpireAt: true },
      });
      if (!account || account.status === 'BANNED' || account.status === 'SUSPENDED') {
        throw new BizException(BizCode.FORBIDDEN, 'user.accountRestricted');
      }
    }

    const policy = await this.lockAccess.resolveForDrama(episode.drama);
    const free = this.lockAccess.isFree(episode, policy);
    let unlocked = free;
    if (!free && userId) {
      const [u, user, dramaUnlock] = await Promise.all([
        this.prisma.userUnlock.findUnique({
          where: { userId_episodeId: { userId, episodeId } },
          select: { orderId: true },
        }),
        this.prisma.user.findUnique({ where: { id: userId }, select: { vipExpireAt: true } }),
        this.prisma.userDramaUnlock.findUnique({
          where: { userId_dramaId: { userId, dramaId: episode.dramaId } },
        }),
      ]);
      const vipActive = !!(user?.vipExpireAt && user.vipExpireAt.getTime() > Date.now());
      // Only paid UserUnlock (orderId set) is permanent; soft/VIP/free rows do not survive.
      const paidUnlock = !!(u && u.orderId != null);
      unlocked = paidUnlock || vipActive || !!dramaUnlock;
    }

    // 未解锁：绝不下发完整片源 URL；仅签发 API 预览网关（按时长裁剪）
    if (!unlocked) {
      if (episode.previewSeconds > 0) {
        const key = requireSecret('CDN_SIGN_KEY', this.config.get('CDN_SIGN_KEY'), 'dev');
        const exp = Math.floor(Date.now() / 1000) + 600; // preview tokens: 10m
        const sig = signEpisodePreview(episodeId, episode.previewSeconds, exp, key);
        return {
          playUrl: `/api/v1/episodes/${episodeId}/preview?sig=${sig}&exp=${exp}`,
          expiresAt: new Date(exp * 1000).toISOString(),
          durationSec: episode.durationSec,
          previewSeconds: episode.previewSeconds,
          previewOnly: true,
          mediaWidth: episode.mediaWidth,
          mediaHeight: episode.mediaHeight,
          mediaOrientation: episode.mediaOrientation,
        };
      }
      if (!userId) throw new BizException(BizCode.UNAUTHORIZED, 'Chưa đăng nhập');
      throw new BizException(BizCode.FORBIDDEN, 'Tập này cần mở khóa để xem', 402 as any);
    }

    const key = requireSecret('CDN_SIGN_KEY', this.config.get('CDN_SIGN_KEY'), 'dev');
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
        previewSeconds: 0,
        previewOnly: false,
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
        previewSeconds: 0,
        previewOnly: false,
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
      previewSeconds: 0,
      previewOnly: false,
      mediaWidth: episode.mediaWidth,
      mediaHeight: episode.mediaHeight,
      mediaOrientation: episode.mediaOrientation,
    };
  }

  /**
   * 付费预览流：服务端按时长截断 HLS，或按字节上限代理渐进式视频。
   * 客户端永远拿不到完整片源签名 URL。
   */
  async streamPreview(
    episodeId: bigint,
    sig: string | undefined,
    exp: string | undefined,
    req: Request,
    res: Response,
  ) {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { drama: true },
    });
    if (!episode || episode.drama?.status !== 'LIVE') {
      throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    }
    if (episode.previewSeconds <= 0) {
      throw new BizException(BizCode.FORBIDDEN, 'preview.unavailable');
    }

    const key = requireSecret('CDN_SIGN_KEY', this.config.get('CDN_SIGN_KEY'), 'dev');
    if (!verifyEpisodePreviewSig(episodeId, episode.previewSeconds, exp, sig, key)) {
      throw new BizException(BizCode.FORBIDDEN, 'preview.invalidSig');
    }

    const refreshed = await this.refreshExternalUrlIfNeeded(episode);
    const base = (this.config.get<string>('CDN_BASE_URL') || 'https://cdn.velvetmovie.space').replace(
      /\/$/,
      '',
    );
    const raw = refreshed || episode.hlsUrl || `${base}/v/${episodeId}/index.m3u8`;
    const expN = typeof exp === 'string' ? parseInt(exp, 10) : Number(exp);

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Preview-Only', '1');
    res.setHeader('X-Preview-Seconds', String(episode.previewSeconds));

    if (/\.m3u8(\?|$)/i.test(raw) || (!/^https?:\/\//.test(raw) && raw.endsWith('.m3u8'))) {
      // Never return a master playlist: variant URIs would get full media signatures and
      // bypass duration truncation. Resolve to one media playlist, then truncate segments.
      const prepared = await this.preparePreviewMediaPlaylist(raw, base);
      const truncated = truncateM3u8ByDuration(prepared.body, episode.previewSeconds);
      if (isMasterM3u8(truncated)) {
        throw new BizException(BizCode.FORBIDDEN, 'preview.masterUnsupported');
      }

      let body = truncated;
      if (prepared.segmentBase) {
        body = this.toAbsoluteSignedPlaylist(
          truncated,
          prepared.playlistRel,
          expN,
          key,
          prepared.segmentBase,
        );
      }
      // Defense: signed body must not expose child .m3u8 variant lines
      if (isMasterM3u8(body) || /#EXT-X-STREAM-INF:/i.test(body)) {
        throw new BizException(BizCode.FORBIDDEN, 'preview.masterUnsupported');
      }
      const buf = Buffer.from(body, 'utf8');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Accept-Ranges', 'none');
      res.status(200).end(buf);
      return;
    }

    // Progressive container: byte-capped proxy — never 302 to full object
    let fileSize: number | null = null;
    if (!/^https?:\/\//.test(raw)) {
      const abs = this.resolveLocalFile(raw);
      if (!abs) throw new BizException(BizCode.NOT_FOUND, 'preview.sourceMissing');
      fileSize = fs.statSync(abs).size;
      const maxBytes = estimatePreviewMaxBytes(episode.previewSeconds, episode.durationSec, fileSize);
      const end = Math.min(fileSize - 1, maxBytes - 1);
      res.status(206);
      res.setHeader('Content-Type', this.guessMime(abs));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Range', `bytes 0-${end}/${fileSize}`);
      res.setHeader('Content-Length', end + 1);
      fs.createReadStream(abs, { start: 0, end }).pipe(res);
      return;
    }

    if (base && raw.startsWith(base) && this.r2.hasCredentials()) {
      try {
        const u = new URL(raw);
        const objectKey = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        const head = await this.r2.headMediaObject(objectKey);
        fileSize = head?.size ?? null;
        const maxBytes = estimatePreviewMaxBytes(
          episode.previewSeconds,
          episode.durationSec,
          fileSize,
        );
        const end = Math.max(0, maxBytes - 1);
        const ranged = await this.r2.getMediaObject(objectKey, {
          range: `bytes=0-${end}`,
        });
        res.status(206);
        res.setHeader('Content-Type', ranged.contentType || this.guessMime(objectKey));
        res.setHeader('Accept-Ranges', 'bytes');
        if (fileSize != null) {
          const actualEnd = Math.min(end, fileSize - 1);
          res.setHeader('Content-Range', `bytes 0-${actualEnd}/${fileSize}`);
        }
        if (ranged.contentLength != null) res.setHeader('Content-Length', ranged.contentLength);
        ranged.body.pipe(res);
        return;
      } catch {
        /* fall through to fetch proxy */
      }
    }

    const maxBytes = estimatePreviewMaxBytes(episode.previewSeconds, episode.durationSec, null);
    const upstream = await fetch(raw, {
      headers: { Range: `bytes=0-${maxBytes - 1}`, 'User-Agent': 'VelvetPreview/1.0' },
    });
    if (!(upstream.ok || upstream.status === 206)) {
      throw new BizException(BizCode.NOT_FOUND, 'preview.sourceUnavailable');
    }
    res.status(upstream.status === 206 ? 206 : 200);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    else res.setHeader('Content-Type', this.guessMime(raw));
    res.setHeader('Accept-Ranges', 'bytes');
    const cr = upstream.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    if (!upstream.body) {
      res.end();
      return;
    }
    const nodeStream = Readable.fromWeb(upstream.body as any);
    let sent = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        if (sent >= maxBytes) {
          cb();
          return;
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remain = maxBytes - sent;
        const slice = buf.length > remain ? buf.subarray(0, remain) : buf;
        sent += slice.length;
        cb(null, slice);
        if (sent >= maxBytes) {
          this.push(null);
          nodeStream.destroy();
        }
      },
    });
    nodeStream.pipe(limiter).pipe(res);
    req.on('close', () => {
      nodeStream.destroy();
      limiter.destroy();
    });
  }

  /**
   * Load HLS source for preview. Master playlists are never returned: we pick the
   * lowest-bandwidth media variant and load that instead. Nested masters are refused.
   */
  private async preparePreviewMediaPlaylist(
    raw: string,
    cdnBase: string,
  ): Promise<{ body: string; playlistRel: string; segmentBase: string }> {
    let source = raw;
    let body = await this.loadTextSource(source, cdnBase);
    let meta = this.playlistSegmentMeta(source, cdnBase);

    if (isMasterM3u8(body)) {
      const variantUri = pickMasterVariantUri(body);
      if (!variantUri) {
        throw new BizException(BizCode.FORBIDDEN, 'preview.masterUnsupported');
      }
      const resolved = resolvePlaylistChildUri(meta.playlistRel, variantUri);
      if (!resolved) {
        throw new BizException(BizCode.FORBIDDEN, 'preview.masterUnsupported');
      }
      if ('absoluteUrl' in resolved) {
        source = resolved.absoluteUrl;
      } else if (/^https?:\/\//.test(source) && cdnBase && source.startsWith(cdnBase)) {
        source = `${cdnBase.replace(/\/$/, '')}/${resolved.relativePath}`;
      } else if (!/^https?:\/\//.test(source)) {
        source = resolved.relativePath;
      } else {
        // External absolute master with relative child — resolve against master URL
        try {
          source = new URL(variantUri, source).toString();
        } catch {
          throw new BizException(BizCode.FORBIDDEN, 'preview.masterUnsupported');
        }
      }
      body = await this.loadTextSource(source, cdnBase);
      meta = this.playlistSegmentMeta(source, cdnBase);
      if (isMasterM3u8(body)) {
        throw new BizException(BizCode.FORBIDDEN, 'preview.masterUnsupported');
      }
    }

    return { body, playlistRel: meta.playlistRel, segmentBase: meta.segmentBase };
  }

  private playlistSegmentMeta(
    raw: string,
    cdnBase: string,
  ): { playlistRel: string; segmentBase: string } {
    let playlistRel = raw.replace(/^\/+/, '').replace(/\\/g, '/');
    let segmentBase = '';
    if (/^https?:\/\//.test(raw) && cdnBase && raw.startsWith(cdnBase)) {
      try {
        const u = new URL(raw);
        playlistRel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        segmentBase = cdnBase;
      } catch {
        playlistRel = 'index.m3u8';
      }
    } else if (!/^https?:\/\//.test(raw)) {
      segmentBase = '/api/v1/media';
    }
    return { playlistRel, segmentBase };
  }

  private toAbsoluteSignedPlaylist(
    body: string,
    playlistRelPath: string,
    exp: number,
    key: string,
    absoluteBase: string,
  ): string {
    const base = absoluteBase.replace(/\/$/, '');
    const endsWithNl = /\r?\n$/.test(body);
    const mapUri = (uri: string) => {
      if (!uri || /^https?:\/\//i.test(uri) || /^data:/i.test(uri)) return uri;
      const signedRel = signPlaylistUri(playlistRelPath, uri, exp, key);
      const qIdx = signedRel.indexOf('?');
      const pathOnly = (qIdx >= 0 ? signedRel.slice(0, qIdx) : signedRel).replace(/^\/+/, '');
      const query = qIdx >= 0 ? signedRel.slice(qIdx) : '';
      // /api/v1/media paths need encoded segments; CDN paths stay raw path
      if (base.startsWith('/')) {
        const encoded = pathOnly.split('/').map(encodeURIComponent).join('/');
        return `${base}/${encoded}${query}`;
      }
      return `${base}/${pathOnly}${query}`;
    };
    const lines = body.split(/\r?\n/);
    const out = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_m, uri: string) => `URI="${mapUri(uri)}"`);
      }
      return mapUri(trimmed);
    });
    const joined = out.join('\n');
    return endsWithNl ? `${joined}\n` : joined;
  }

  private async loadTextSource(raw: string, cdnBase: string): Promise<string> {
    if (!/^https?:\/\//.test(raw)) {
      const abs = this.resolveLocalFile(raw);
      if (!abs) throw new BizException(BizCode.NOT_FOUND, 'preview.sourceMissing');
      return fs.readFileSync(abs, 'utf8');
    }
    if (cdnBase && raw.startsWith(cdnBase) && this.r2.hasCredentials()) {
      try {
        const u = new URL(raw);
        const objectKey = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        const obj = await this.r2.getMediaObject(objectKey);
        const chunks: Buffer[] = [];
        for await (const c of obj.body) {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        }
        return Buffer.concat(chunks).toString('utf8');
      } catch {
        /* fetch fallback */
      }
    }
    const res = await fetch(raw, { headers: { 'User-Agent': 'VelvetPreview/1.0' } });
    if (!res.ok) throw new BizException(BizCode.NOT_FOUND, 'preview.sourceUnavailable');
    return await res.text();
  }

  private resolveLocalFile(raw: string): string | null {
    const normalized = path.normalize(raw.replace(/^\/+/, '')).replace(/^(\.\.(\/|\\|$))+/, '');
    const roots: string[] = [];
    const storage =
      this.config.get<string>('STORAGE_ROOT') || path.join(process.cwd(), 'storage');
    if (storage) roots.push(path.resolve(storage));
    const media = this.config.get<string>('MEDIA_ROOT');
    if (media) roots.push(path.resolve(media));
    const importRoot = this.config.get<string>('ADMIN_IMPORT_ROOT');
    if (importRoot) roots.push(path.resolve(importRoot));
    for (const root of [...new Set(roots)]) {
      const candidate = path.join(root, normalized);
      if (candidate !== root && !candidate.startsWith(root + path.sep)) continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  private guessMime(name: string): string {
    const ext = path.extname(name).toLowerCase();
    const map: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.ts': 'video/mp2t',
    };
    return map[ext] || 'application/octet-stream';
  }

  /**
   * Owned / hosted media must never be rewritten by yt-dlp refresh.
   * Transfer-to-R2 episodes keep sourcePageUrl for provenance; without this guard,
   * play/preview would overwrite CDN hlsUrl with a third-party m3u8 whenever
   * resolvedExpiresAt is missing/expired (see drama 23 EP1–5).
   */
  private isOwnedHostedMediaUrl(url: string | null | undefined): boolean {
    const raw = String(url || '').trim();
    if (!raw) return false;
    if (!/^https?:\/\//i.test(raw)) {
      // Relative keys: uploads/…, hls/…, covers/…, api/v1/media/…
      return true;
    }
    try {
      const host = new URL(raw).host.toLowerCase();
      const cdnBase = (
        this.config.get<string>('CDN_BASE_URL') || 'https://cdn.velvetmovie.space'
      ).replace(/\/$/, '');
      const cdnHost = new URL(cdnBase).host.toLowerCase();
      if (host === cdnHost) return true;
      if (host.endsWith('.r2.dev') || host.includes('r2.cloudflarestorage.com')) return true;
      if (host.endsWith('velvetmovie.space')) return true;
    } catch {
      return false;
    }
    return false;
  }

  private async refreshExternalUrlIfNeeded(episode: {
    id: bigint;
    hlsUrl: string | null;
    sourcePageUrl: string | null;
    playlistIndex: number | null;
    resolvedExpiresAt: Date | null;
    drama?: { sourceType?: string | null } | null;
  }) {
    if (!episode.sourcePageUrl) return episode.hlsUrl;
    // Hosted dramas (R2/LOCAL) and any already-owned hlsUrl are final — do not re-resolve.
    const sourceType = String(episode.drama?.sourceType || '').toUpperCase();
    if (sourceType === 'R2' || sourceType === 'LOCAL') return episode.hlsUrl;
    if (this.isOwnedHostedMediaUrl(episode.hlsUrl)) return episode.hlsUrl;

    const refreshAt = episode.resolvedExpiresAt?.getTime() ?? 0;
    if (episode.hlsUrl && refreshAt > Date.now() + 5 * 60 * 1000) return episode.hlsUrl;

    const key = episode.id.toString();
    const existing = this.refreshes.get(key);
    if (existing) return existing;
    const task = this.ytdlp
      .resolvePlayUrl(episode.sourcePageUrl, 'best_hls', episode.playlistIndex ?? undefined)
      .then(async (playUrl) => {
        // Re-check before write: concurrent transcode/R2 push may have landed owned media.
        const current = await this.prisma.episode.findUnique({
          where: { id: episode.id },
          select: { hlsUrl: true, drama: { select: { sourceType: true } } },
        });
        if (
          current &&
          (String(current.drama?.sourceType || '').toUpperCase() === 'R2' ||
            String(current.drama?.sourceType || '').toUpperCase() === 'LOCAL' ||
            this.isOwnedHostedMediaUrl(current.hlsUrl))
        ) {
          return current.hlsUrl || playUrl;
        }
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
