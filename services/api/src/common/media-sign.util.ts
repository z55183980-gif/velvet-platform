import { createHmac, timingSafeEqual } from 'crypto';
import * as path from 'path';

/** 对媒体相对路径签发短时 HMAC（绑定 path + exp） */
export function signMediaPath(relPath: string, exp: number, key: string): string {
  return createHmac('sha256', key).update(`${relPath}:${exp}`).digest('base64url');
}

export function verifyMediaSig(
  relPath: string,
  exp: number | string | undefined,
  sig: string | undefined,
  key: string,
): boolean {
  if (!sig || exp == null || exp === '') return false;
  const expN = typeof exp === 'string' ? parseInt(exp, 10) : exp;
  if (!Number.isFinite(expN) || expN < Math.floor(Date.now() / 1000)) return false;
  const expected = signMediaPath(relPath, expN, key);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** CDN 绝对 URL：绑定 episodeId + exp（生产可换 CloudFront 私钥） */
export function signCdnEpisode(episodeId: string | bigint, exp: number, key: string): string {
  return createHmac('sha256', key).update(`${episodeId}:${exp}`).digest('base64url');
}

/**
 * 给 HLS 播放列表内的相对 URI 补上与该目标 path 绑定的签名。
 * 浏览器 / hls.js / Safari 原生 HLS 都会按相对路径再请求 .ts / 子 m3u8，
 * 若不重写，分片请求会缺 sig/exp → 403 → 黑屏 0:00/0:00。
 */
export function signPlaylistUri(
  playlistRelPath: string,
  uri: string,
  exp: number,
  key: string,
): string {
  if (!uri || /^https?:\/\//i.test(uri) || /^data:/i.test(uri)) return uri;

  const hashIdx = uri.indexOf('#');
  const hash = hashIdx >= 0 ? uri.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? uri.slice(0, hashIdx) : uri;
  const qIdx = noHash.indexOf('?');
  const pathOnly = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const existingQ = qIdx >= 0 ? noHash.slice(qIdx + 1) : '';

  const playlistPosix = playlistRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const dir = path.posix.dirname(playlistPosix);
  let target: string;
  if (pathOnly.startsWith('/')) {
    target = pathOnly.replace(/^\/+/, '');
  } else {
    target = path.posix
      .normalize(dir === '.' ? pathOnly : `${dir}/${pathOnly}`)
      .replace(/^(\.\.\/)+/, '');
  }

  const params = new URLSearchParams(existingQ);
  params.set('sig', signMediaPath(target, exp, key));
  params.set('exp', String(exp));
  return `${pathOnly}?${params.toString()}${hash}`;
}

/** 重写 m3u8：URI 行 + 标签内 URI="..."（KEY/MAP/MEDIA 等） */
export function rewriteSignedPlaylist(
  body: string,
  playlistRelPath: string,
  exp: number,
  key: string,
): string {
  const endsWithNl = /\r?\n$/.test(body);
  const lines = body.split(/\r?\n/);
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
        return `URI="${signPlaylistUri(playlistRelPath, uri, exp, key)}"`;
      });
    }
    return signPlaylistUri(playlistRelPath, trimmed, exp, key);
  });
  const joined = out.join('\n');
  return endsWithNl ? `${joined}\n` : joined;
}
