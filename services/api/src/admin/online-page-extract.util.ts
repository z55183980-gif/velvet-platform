/**
 * Deterministic helpers for Path B page extract (esp. ReelShort SPA pages).
 * Episode lists live in HTML hrefs / __NEXT_DATA__, not visible stripped text.
 */

export type ExtractedPageEpisode = {
  episodeNumber: number;
  title: string;
  sourceUrl: string;
};

export type PageMetaHints = {
  title?: string;
  coverUrl?: string;
  description?: string;
  paidStart?: number;
  chapterCount?: number;
};

/** Expand episode/trailer URLs to movie + full-episodes listing pages. */
export function expandDramaPageCandidates(pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    const t = u.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  push(pageUrl);
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return out;
  }

  const origin = parsed.origin;
  const path = parsed.pathname;

  // /vi/episodes/... → also try /episodes/...
  if (/^\/[a-z]{2}\/episodes\//i.test(path)) {
    push(`${origin}${path.replace(/^\/[a-z]{2}\//i, '/')}`);
  }

  // ReelShort episode / trailer → movie + full-episodes
  const ep = path.match(
    /\/(?:[a-z]{2}\/)?episodes\/(?:episode-\d+|trailer)-(.+)-([a-f0-9]{24})-([a-z0-9]+)\/?$/i,
  );
  if (ep) {
    const slug = ep[1];
    const bookId = ep[2].toLowerCase();
    push(`${origin}/movie/${slug}-${bookId}`);
    push(`${origin}/full-episodes/${slug}-${bookId}`);
  }

  // Already on movie page → also full-episodes
  const movie = path.match(/\/(?:[a-z]{2}\/)?movie\/(.+)-([a-f0-9]{24})\/?$/i);
  if (movie) {
    push(`${origin}/full-episodes/${movie[1]}-${movie[2].toLowerCase()}`);
  }

  // full-episodes → movie
  const full = path.match(/\/(?:[a-z]{2}\/)?full-episodes\/(.+)-([a-f0-9]{24})\/?$/i);
  if (full) {
    push(`${origin}/movie/${full[1]}-${full[2].toLowerCase()}`);
  }

  return out;
}

/** Collect /episodes/episode-N-... links from raw HTML (and absolute URLs). */
export function extractEpisodeLinksFromHtml(
  html: string,
  pageUrl: string,
): ExtractedPageEpisode[] {
  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const map = new Map<number, string>();
  const re =
    /(?:https?:\/\/[^"'\\\s<>]+)?(\/episodes\/episode-(\d+)-[^"'\\\s<>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n < 1) continue;
    const path = m[1].replace(/&amp;/g, '&').split(/[?#]/)[0];
    if (!map.has(n)) map.set(n, `${origin}${path}`);
  }

  // Also absolute episode URLs without leading path capture edge cases
  const abs = /https?:\/\/[^"'\\\s<>]+\/episodes\/episode-(\d+)-[^"'\\\s<>]+/gi;
  while ((m = abs.exec(html))) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1) continue;
    const url = m[0].replace(/&amp;/g, '&').split(/[?#]/)[0];
    if (!map.has(n)) map.set(n, url);
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([episodeNumber, sourceUrl]) => ({
      episodeNumber,
      title: `EP${episodeNumber}`,
      sourceUrl,
    }));
}

/** Pull title/cover/desc (+ chapter_list when present) from Next.js __NEXT_DATA__. */
export function extractMetaFromNextData(html: string): {
  meta: PageMetaHints;
  episodes: ExtractedPageEpisode[];
} {
  const meta: PageMetaHints = {};
  const episodes: ExtractedPageEpisode[] = [];
  const m = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m?.[1]) return { meta, episodes };

  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return { meta, episodes };
  }

  const pageData = data?.props?.pageProps?.data;
  if (pageData && typeof pageData === 'object') {
    const title = String(pageData.book_title || pageData.title || '').trim();
    if (title) meta.title = title.slice(0, 80);
    const cover = String(pageData.book_pic || pageData.video_pic || '').trim();
    if (/^https?:\/\//i.test(cover)) meta.coverUrl = cover;
    const desc = String(
      pageData.book_desc || pageData.chapter_desc || pageData.desc || '',
    ).trim();
    if (desc) meta.description = desc.slice(0, 300);
    if (Number(pageData.paid_start) > 0) meta.paidStart = Number(pageData.paid_start);
    if (Number(pageData.chapter_count) > 0) {
      meta.chapterCount = Number(pageData.chapter_count);
    }

    const list = Array.isArray(pageData.chapter_list)
      ? pageData.chapter_list
      : Array.isArray(pageData.chapterList)
        ? pageData.chapterList
        : [];
    for (const ch of list) {
      if (!ch || typeof ch !== 'object') continue;
      const n = Number(ch.serial_number ?? ch.serialNumber ?? ch.index);
      // ReelShort serial_number is often 0-based for ep1
      const episodeNumber =
        Number.isFinite(n) && n >= 0
          ? n >= 1
            ? Math.floor(n)
            : Math.floor(n) + 1
          : episodes.length + 1;
      const sourceUrl = String(
        ch.play_url || ch.playUrl || ch.video_url || ch.videoUrl || '',
      ).trim();
      if (!/^https?:\/\//i.test(sourceUrl)) continue;
      episodes.push({
        episodeNumber,
        title: String(ch.desc || ch.chapter_name || `EP${episodeNumber}`)
          .trim()
          .slice(0, 80) || `EP${episodeNumber}`,
        sourceUrl,
      });
    }
  }

  return { meta, episodes };
}

/** Build LLM-friendly text: visible copy + hrefs + truncated __NEXT_DATA__. */
export function buildExtractContext(html: string, pageUrl: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const links = extractEpisodeLinksFromHtml(html, pageUrl)
    .slice(0, 120)
    .map((e) => `#${e.episodeNumber} ${e.sourceUrl}`)
    .join('\n');

  const next = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  const nextSnippet = next?.[1] ? next[1].slice(0, 40_000) : '';

  return [
    `Page URL: ${pageUrl}`,
    '',
    'Visible text:',
    stripped.slice(0, 20_000),
    '',
    links ? `Episode hrefs found in HTML:\n${links}` : 'Episode hrefs found in HTML: (none)',
    '',
    nextSnippet ? `__NEXT_DATA__ JSON (truncated):\n${nextSnippet}` : '',
  ]
    .join('\n')
    .slice(0, 80_000);
}
