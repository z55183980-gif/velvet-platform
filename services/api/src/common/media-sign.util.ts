import { createHmac, timingSafeEqual } from 'crypto';

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
