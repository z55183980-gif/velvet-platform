import { createHash } from 'crypto';

const REELSHORT_BOOK_ID = /^[0-9a-f]{24}$/i;

function normalizedReelshortUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = decodeURIComponent(url.pathname)
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '')
      .toLowerCase();
    return `${host}${pathname}`;
  } catch {
    return String(pageUrl || '').trim().toLowerCase();
  }
}

/** Extract the ReelShort book id shared by movie and episode URLs. */
export function reelshortBookIdFromUrl(pageUrl: string): string | null {
  const normalized = normalizedReelshortUrl(pageUrl);
  const match = normalized.match(/(?:^|[^0-9a-f])([0-9a-f]{24})(?:[^0-9a-f]|$)/i);
  return match?.[1]?.toLowerCase() || null;
}

/**
 * Stable identity for one ReelShort drama.
 *
 * The previous implementation truncated the beginning of a Base64 URL. Since
 * every ReelShort URL starts with the same host prefix, unrelated dramas got
 * the same externalRef. Prefer the provider's book id; hash the complete,
 * normalized URL only when no id is available.
 */
export function reelshortExternalRefFor(
  pageUrl: string,
  bookIdHint?: string,
): string {
  const hinted = String(bookIdHint || '').trim().toLowerCase();
  const bookId = REELSHORT_BOOK_ID.test(hinted)
    ? hinted
    : reelshortBookIdFromUrl(pageUrl);
  if (bookId) return `ytdlp:html:reelshort_${bookId}`;

  const digest = createHash('sha256')
    .update(normalizedReelshortUrl(pageUrl))
    .digest('hex')
    .slice(0, 32);
  return `ytdlp:html:reelshort_url_${digest}`;
}
