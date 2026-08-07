/** 将第三方平台链接规范为可在本站播放的直链 */

import { createHash } from 'crypto';

const PLAYABLE_RE = /\.(m3u8|mp4|webm|mov|m4v)(\?|$)/i;
const STREAM_PATH_RE = /\/(hls|playlist|index\.m3u8|master\.m3u8)\b/i;
const EMBED_KEYS = ['url', 'src', 'playUrl', 'play_url', 'video', 'm3u8', 'media', 'videoUrl'];

export function isPlayableMediaUrl(url: string): boolean {
  return PLAYABLE_RE.test(url) || STREAM_PATH_RE.test(url);
}

/**
 * 转换外链：优先从常见 query 参数中提取直链；否则校验自身是否可播放。
 * 返回 originalUrl（运营填写）与 playUrl（写入 episode.hlsUrl）。
 * @param opts.relaxed 为 true 时：任意合法 http(s) 均接受（第三方解析结果常用）
 */
export function convertExternalPlayUrl(
  input: string,
  opts?: { relaxed?: boolean },
): { playUrl: string; originalUrl: string } {
  const originalUrl = String(input || '').trim();
  if (!originalUrl) {
    throw new Error('播放地址不能为空');
  }

  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    throw new Error(`无效链接: ${originalUrl.slice(0, 120)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http/https 链接');
  }

  for (const key of EMBED_KEYS) {
    const nested = parsed.searchParams.get(key);
    if (!nested) continue;
    try {
      const nestedUrl = decodeURIComponent(nested);
      if (/^https?:\/\//i.test(nestedUrl) && isPlayableMediaUrl(nestedUrl)) {
        return { playUrl: nestedUrl, originalUrl };
      }
    } catch {
      /* keep scanning */
    }
  }

  if (isPlayableMediaUrl(originalUrl) || opts?.relaxed) {
    return { playUrl: originalUrl, originalUrl };
  }

  throw new Error(
    '无法从该链接识别可播放地址，请填写 m3u8/mp4 直链，或带 url/src/playUrl 参数的跳转链',
  );
}

export function slugifyTitle(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  return base || `online-${Date.now().toString(36)}`;
}

/** 尽力读取第三方签名 URL 的过期时间；无法识别时使用短缓存，确保可重新解析。 */
export function inferExternalUrlExpiry(url: string, fallbackMs = 2 * 60 * 60 * 1000): Date {
  try {
    const parsed = new URL(url);
    for (const key of ['expire', 'expires', 'exp', 'Expires']) {
      const raw = parsed.searchParams.get(key);
      if (!raw) continue;
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
        const value = new Date(millis);
        if (Number.isFinite(value.getTime())) return value;
      }
      const value = new Date(raw);
      if (Number.isFinite(value.getTime())) return value;
    }
  } catch {
    // URL validation is handled by the caller.
  }
  return new Date(Date.now() + fallbackMs);
}

/** Drama-level dedupe key for manual paste import (hash of episode play URLs). */
export function manualExternalRef(sourceUrls: string[]): string {
  const key = sourceUrls
    .map((u) => String(u || '').trim())
    .filter(Boolean)
    .sort()
    .join('\n');
  const hash = createHash('sha256')
    .update(key || `empty:${Date.now()}`)
    .digest('hex')
    .slice(0, 24);
  return `manual:${hash}`;
}

/** Stable id for a single pasted play URL (episode provenance). */
export function manualExternalVideoId(sourceUrl: string): string {
  return createHash('sha256')
    .update(String(sourceUrl || '').trim())
    .digest('hex')
    .slice(0, 20);
}
