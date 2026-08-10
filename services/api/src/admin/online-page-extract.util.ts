/**
 * Deterministic helpers for Path B page extract.
 * Site rules are host-matched — do not apply DramaBox logic to ReelShort (or vice versa).
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
  /** Free-form genre / tag labels from page JSON when present. */
  genreLabels?: string[];
  /** Page/content language hint (e.g. en, zh). */
  language?: string;
  paidStart?: number;
  chapterCount?: number;
};

export function isDramaboxHost(pageUrl: string): boolean {
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    return (
      host === 'dramaboxapp.com' ||
      host === 'www.dramaboxapp.com' ||
      host.endsWith('.dramaboxapp.com') ||
      host === 'dramabox.com' ||
      host === 'www.dramabox.com' ||
      host.endsWith('.dramabox.com')
    );
  } catch {
    return false;
  }
}

function pushGenreLabel(out: string[], v: unknown) {
  if (typeof v === 'string' && v.trim()) out.push(v.trim());
  else if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
      else if (item && typeof item === 'object') {
        const name = String(
          (item as any).name || (item as any).title || (item as any).label || '',
        ).trim();
        if (name) out.push(name);
      }
    }
  }
}

function isLikelyCjkEpisodeTitle(title: string): boolean {
  return /第\s*\d+\s*[集话話]|第[一二三四五六七八九十百千零〇两兩]+[集话話]/.test(
    title,
  );
}

/** Expand episode/trailer URLs to listing pages (host-aware). */
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

  // DramaBox: a single /episode/{bookId}/{chapterId} page embeds full chapterList — no rewrite.
  if (isDramaboxHost(pageUrl)) {
    return out;
  }

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

/** Collect ReelShort /episodes/episode-N-... links from raw HTML. */
function extractReelshortEpisodeLinks(
  html: string,
  origin: string,
): ExtractedPageEpisode[] {
  const map = new Map<number, string>();
  const re =
    /(?:https?:\/\/[^"'\\\s<>]+)?((?:\/[a-z]{2})?\/episodes\/episode-(\d+)-[^"'\\\s<>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n < 1) continue;
    const path = m[1].replace(/&amp;/g, '&').split(/[?#]/)[0];
    if (!map.has(n)) map.set(n, `${origin}${path}`);
  }

  const abs =
    /https?:\/\/[^"'\\\s<>]+\/(?:[a-z]{2}\/)?episodes\/episode-(\d+)-[^"'\\\s<>]+/gi;
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

/**
 * DramaBox href scrape is unused for numbering (chapterList is authoritative).
 * Kept empty on purpose so global href merge never invents Dramabox rows.
 */
function extractDramaboxEpisodeLinks(
  _html: string,
  _origin: string,
): ExtractedPageEpisode[] {
  return [];
}

/** Collect episode links from raw HTML (host-matched site rules). */
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

  if (isDramaboxHost(pageUrl)) {
    return extractDramaboxEpisodeLinks(html, origin);
  }

  return extractReelshortEpisodeLinks(html, origin);
}

function extractReelshortFromPageData(pageData: any): {
  meta: PageMetaHints;
  episodes: ExtractedPageEpisode[];
} {
  const meta: PageMetaHints = {};
  const episodes: ExtractedPageEpisode[] = [];
  if (!pageData || typeof pageData !== 'object') return { meta, episodes };

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

  const genreLabels: string[] = [];
  pushGenreLabel(genreLabels, pageData.book_type);
  pushGenreLabel(genreLabels, pageData.bookType);
  pushGenreLabel(genreLabels, pageData.category);
  pushGenreLabel(genreLabels, pageData.category_name);
  pushGenreLabel(genreLabels, pageData.categoryName);
  pushGenreLabel(genreLabels, pageData.genre);
  pushGenreLabel(genreLabels, pageData.genres);
  pushGenreLabel(genreLabels, pageData.tags);
  pushGenreLabel(genreLabels, pageData.type_name);
  pushGenreLabel(genreLabels, pageData.typeName);
  if (genreLabels.length) meta.genreLabels = [...new Set(genreLabels)].slice(0, 12);

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

  return { meta, episodes };
}

/** DramaBox: pageProps.bookInfo + chapterList (only call when host matches). */
function extractDramaboxFromPageProps(
  pageProps: any,
  pageUrl: string,
): {
  meta: PageMetaHints;
  episodes: ExtractedPageEpisode[];
} {
  const meta: PageMetaHints = {};
  const episodes: ExtractedPageEpisode[] = [];
  const bookInfo = pageProps?.bookInfo;
  if (!bookInfo || typeof bookInfo !== 'object') return { meta, episodes };

  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = '';
  }

  const title = String(bookInfo.bookName || bookInfo.bookNameEn || '').trim();
  if (title) meta.title = title.slice(0, 80);
  const cover = String(bookInfo.cover || '').trim();
  if (/^https?:\/\//i.test(cover)) {
    // Strip DramaBox image transform suffix (@w=…&h=…) for a cleaner cover URL.
    meta.coverUrl = cover.replace(/@w=\d+&h=\d+$/i, '');
  }
  const desc = String(bookInfo.introduction || '').trim();
  if (desc) meta.description = desc.slice(0, 300);

  const lang = String(
    bookInfo.simpleLanguage || bookInfo.language || pageProps?.locale || '',
  )
    .trim()
    .toLowerCase();
  if (lang) meta.language = lang.startsWith('zh') ? 'zh' : lang.slice(0, 8);

  if (Number(bookInfo.chapterCount) > 0) {
    meta.chapterCount = Number(bookInfo.chapterCount);
  }

  const genreLabels: string[] = [];
  pushGenreLabel(genreLabels, bookInfo.tags);
  pushGenreLabel(genreLabels, bookInfo.labels);
  pushGenreLabel(genreLabels, bookInfo.typeTwoNames);
  pushGenreLabel(genreLabels, bookInfo.typeTwoList);
  pushGenreLabel(genreLabels, bookInfo.typeTwoName);
  if (genreLabels.length) meta.genreLabels = [...new Set(genreLabels)].slice(0, 12);

  const bookId = String(bookInfo.bookId || pageProps?.sourceBookId || '').trim();
  const list = Array.isArray(pageProps?.chapterList) ? pageProps.chapterList : [];
  const preferEnTitle =
    !meta.language ||
    meta.language === 'en' ||
    /english/i.test(String(bookInfo.language || ''));

  for (const ch of list) {
    if (!ch || typeof ch !== 'object') continue;
    const n = Number(ch.index);
    const episodeNumber =
      Number.isFinite(n) && n >= 0 ? Math.floor(n) + 1 : episodes.length + 1;
    const m3u8 = String(ch.m3u8Url || '').trim();
    const mp4 = String(ch.mp4 || '').trim();
    const chapterId = String(ch.id || '').trim();
    // Include every chapter: prefer playable media, else chapter page URL
    // (same as prior AI extract which listed all /episode/{bookId}/{chapterId} hrefs).
    const mediaUrl = /^https?:\/\//i.test(m3u8)
      ? m3u8
      : /^https?:\/\//i.test(mp4)
        ? mp4
        : '';
    const pageHref =
      origin && bookId && chapterId
        ? `${origin}/episode/${bookId}/${chapterId}`
        : '';
    const sourceUrl = mediaUrl || pageHref;
    if (!/^https?:\/\//i.test(sourceUrl)) continue;

    let epTitle = String(ch.name || '').trim();
    if (!epTitle || (preferEnTitle && isLikelyCjkEpisodeTitle(epTitle))) {
      epTitle = `EP${episodeNumber}`;
    }

    episodes.push({
      episodeNumber,
      title: epTitle.slice(0, 80) || `EP${episodeNumber}`,
      sourceUrl,
    });
  }

  return { meta, episodes };
}

/** Pull title/cover/desc (+ chapter list) from __NEXT_DATA__ using host-matched parser. */
export function extractMetaFromNextData(
  html: string,
  pageUrl = '',
): {
  meta: PageMetaHints;
  episodes: ExtractedPageEpisode[];
} {
  const empty = { meta: {} as PageMetaHints, episodes: [] as ExtractedPageEpisode[] };
  const m = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m?.[1]) return empty;

  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return empty;
  }

  const pageProps = data?.props?.pageProps;

  if (pageUrl && isDramaboxHost(pageUrl)) {
    return extractDramaboxFromPageProps(pageProps, pageUrl);
  }

  // Default / ReelShort: pageProps.data.book_title / chapter_list
  return extractReelshortFromPageData(pageProps?.data);
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
