/**
 * Deterministic helpers for Path B page extract.
 * Site rules are host-matched — do not cross-apply ReelShort / DramaBox / NetShort logic.
 */

export type ExtractedPageEpisode = {
  episodeNumber: number;
  title: string;
  sourceUrl: string;
};

export type ExtractedDramaCatalogItem = {
  id: string;
  title: string;
  webpageUrl: string;
  coverUrl?: string;
  description?: string;
  chapterCount?: number;
};

export type ExtractedDramaCatalog = {
  title: string;
  page: number;
  totalPages: number;
  totalItems: number;
  prevPageUrl?: string;
  nextPageUrl?: string;
  items: ExtractedDramaCatalogItem[];
};

export type PageMetaHints = {
  title?: string;
  coverUrl?: string;
  description?: string;
  /** Free-form genre / tag labels from page JSON when present. */
  genreLabels?: string[];
  /** Exact ReelShort /tags/ anchor labels; never pass through fuzzy matching. */
  fixedTagLabels?: string[];
  /** Page/content language hint (e.g. en, zh). */
  language?: string;
  paidStart?: number;
  chapterCount?: number;
  /** ReelShort detail `update_status`: 1 = completed, every other present value = ongoing. */
  completion?: '已完结' | '连载中';
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

export function isNetshortHost(pageUrl: string): boolean {
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    return (
      host === 'netshort.com' ||
      host === 'www.netshort.com' ||
      host.endsWith('.netshort.com')
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
  } else if (v && typeof v === 'object') {
    // NetShort shortPlayLabels: { "Revenge": "/drama/...", ... }
    for (const key of Object.keys(v as object)) {
      if (key.trim()) out.push(key.trim());
    }
  }
}

function isLikelyCjkEpisodeTitle(title: string): boolean {
  return /第\s*\d+\s*[集话話]|第[一二三四五六七八九十百千零〇两兩]+[集话話]/.test(
    title,
  );
}

/** NetShort series key: strip locale prefix and optional -ep-N suffix. */
function netshortSeriesKeyFromPath(pathname: string): string | null {
  const cleaned = pathname.replace(/\/+$/, '');
  const m = cleaned.match(
    /^\/(?:[a-z]{2}\/)?(?:episode|full-episodes)\/(.+?)(?:-ep-\d+)?$/i,
  );
  return m?.[1] ? m[1] : null;
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

  // NetShort (ReelShort-style): episode ↔ full-episodes for the same series key.
  if (isNetshortHost(pageUrl)) {
    const key = netshortSeriesKeyFromPath(path);
    if (key) {
      push(`${origin}/episode/${key}`);
      push(`${origin}/full-episodes/${key}`);
    }
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

/**
 * NetShort: /episode/{slug}-{id} (=EP1) and /episode/{slug}-{id}-ep-N (ReelShort-style page URLs).
 * Prefer same-series key when pageUrl is known.
 */
function extractNetshortEpisodeLinks(
  html: string,
  origin: string,
  pageUrl = '',
): ExtractedPageEpisode[] {
  let seriesKey: string | null = null;
  try {
    seriesKey = netshortSeriesKeyFromPath(new URL(pageUrl || origin).pathname);
  } catch {
    seriesKey = null;
  }
  // Also try recovering key from any full-episodes / episode href in HTML.
  if (!seriesKey) {
    const km = html.match(
      /\/(?:[a-z]{2}\/)?(?:episode|full-episodes)\/([a-z0-9][^"'\\\s<>]*?\d{10,})(?:-ep-\d+)?/i,
    );
    if (km?.[1]) seriesKey = km[1].replace(/-ep-\d+$/i, '');
  }

  const map = new Map<number, string>();
  const re =
    /(?:https?:\/\/[^"'\\\s<>]+)?(\/(?:[a-z]{2}\/)?episode\/([^"'\\\s<>]+?))(?:-ep-(\d+))?\/?(?=["'\s?#<>]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const slugPart = String(m[2] || '')
      .replace(/&amp;/g, '&')
      .split(/[?#]/)[0]
      .replace(/-ep-\d+$/i, '');
    if (seriesKey && slugPart !== seriesKey) continue;
    const n = m[3] ? Number(m[3]) : 1;
    if (!Number.isFinite(n) || n < 1) continue;
    const path = `/episode/${slugPart}${n > 1 ? `-ep-${n}` : ''}`;
    if (!map.has(n)) map.set(n, `${origin}${path}`);
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([episodeNumber, sourceUrl]) => ({
      episodeNumber,
      title: `EP${episodeNumber}`,
      sourceUrl,
    }));
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
  if (isNetshortHost(pageUrl)) {
    return extractNetshortEpisodeLinks(html, origin, pageUrl);
  }

  return extractReelshortEpisodeLinks(html, origin);
}

function extractObjectAfterKey(html: string, key: string): any | null {
  // RSC payloads often escape quotes as \\" — normalize first.
  const unescaped = html.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const marker = `"${key}":{`;
  const start = unescaped.indexOf(marker);
  if (start < 0) return null;
  const objStart = unescaped.indexOf('{', start);
  if (objStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = objStart; i < unescaped.length; i++) {
    const ch = unescaped[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(unescaped.slice(objStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function metaFromOgTags(html: string): PageMetaHints {
  const meta: PageMetaHints = {};
  const pick = (prop: string) => {
    const re = new RegExp(
      `(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']|content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
      'i',
    );
    const m = html.match(re);
    return (m?.[1] || m?.[2] || '').trim();
  };
  const title = pick('og:title').replace(/\s*[|\-–].*$/, '').trim();
  if (title) meta.title = title.slice(0, 80);
  const desc = pick('og:description') || pick('description');
  if (desc) {
    meta.description = desc
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .slice(0, 300);
  }
  const cover = pick('og:image');
  if (/^https?:\/\//i.test(cover)) meta.coverUrl = cover;
  const keywords = pick('keywords');
  if (keywords) {
    const labels = keywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (labels.length) meta.genreLabels = [...new Set(labels)].slice(0, 12);
  }
  return meta;
}

export function isReelshortHost(pageUrl: string): boolean {
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    return host === 'reelshort.com' || host === 'www.reelshort.com' || host.endsWith('.reelshort.com');
  } catch {
    return false;
  }
}

/** ReelShort tag/category pages contain multiple independent dramas, not episodes. */
export function isReelshortCatalogUrl(pageUrl: string): boolean {
  if (!isReelshortHost(pageUrl)) return false;
  try {
    return /^\/(?:[a-z]{2}\/)?tags(?:\/|$)/i.test(new URL(pageUrl).pathname);
  } catch {
    return false;
  }
}

function decodeHtmlText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteHttpUrl(raw: unknown, pageUrl: string): string | undefined {
  const value = String(raw || '').trim();
  if (!value) return undefined;
  try {
    const resolved = new URL(value, pageUrl);
    return /^https?:$/i.test(resolved.protocol) ? resolved.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Parse a ReelShort /tags/... page into selectable dramas for one catalog page. */
export function extractReelshortDramaCatalog(
  html: string,
  pageUrl: string,
): ExtractedDramaCatalog | null {
  if (!isReelshortCatalogUrl(pageUrl)) return null;
  const next = String(html || '').match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!next?.[1]) return null;

  let data: any;
  try {
    data = JSON.parse(next[1]);
  } catch {
    return null;
  }

  const pageProps = data?.props?.pageProps;
  const tagBooks = pageProps?.tagBooks;
  const books = Array.isArray(tagBooks?.books) ? tagBooks.books : [];
  if (!books.length) return null;

  // The catalog JSON has book ids but no canonical slug. Recover the exact
  // /movie/... href emitted by SSR HTML and match it by the trailing book id.
  const hrefById = new Map<string, string>();
  const hrefRe = /<a\b[^>]*href=["']([^"']*\/movie\/[^"']*?([a-f0-9]{24})\/?(?:[?#][^"']*)?)["'][^>]*>/gi;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = hrefRe.exec(html))) {
    const id = String(hrefMatch[2] || '').toLowerCase();
    const url = absoluteHttpUrl(hrefMatch[1], pageUrl);
    if (id && url && !hrefById.has(id)) hrefById.set(id, url);
  }

  const items: ExtractedDramaCatalogItem[] = [];
  const seen = new Set<string>();
  for (const book of books) {
    if (!book || typeof book !== 'object') continue;
    const id = String(book.book_id || '').trim().toLowerCase();
    const title = String(book.book_title || '').trim();
    const webpageUrl = hrefById.get(id);
    if (!id || !title || !webpageUrl || seen.has(id)) continue;
    seen.add(id);
    const coverUrl = absoluteHttpUrl(book.book_pic, pageUrl);
    const description = String(book.special_desc || book.book_desc || '').trim();
    const chapterCount = Number(book.chapter_count);
    items.push({
      id,
      title: title.slice(0, 120),
      webpageUrl,
      ...(coverUrl ? { coverUrl } : {}),
      ...(description ? { description: description.slice(0, 500) } : {}),
      ...(Number.isFinite(chapterCount) && chapterCount > 0
        ? { chapterCount: Math.floor(chapterCount) }
        : {}),
    });
  }
  if (!items.length) return null;

  const pathTitle = String(pageProps?.path || '')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch: string) => ch.toUpperCase());
  const title = String(tagBooks?.tag_name || pathTitle || 'ReelShort').trim();
  const page = Number(pageProps?.page ?? tagBooks?.page);
  const totalPages = Number(pageProps?.totalPage);
  const totalItems = Number(pageProps?.total ?? tagBooks?.total_items);

  return {
    title,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    totalPages:
      Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : 1,
    totalItems:
      Number.isFinite(totalItems) && totalItems >= 0
        ? Math.floor(totalItems)
        : items.length,
    prevPageUrl: absoluteHttpUrl(pageProps?.prevPageLink, pageUrl),
    nextPageUrl: absoluteHttpUrl(pageProps?.nextPageLink, pageUrl),
    items,
  };
}

/** Extract ReelShort's visible fixed tag links without semantic guessing. */
export function extractReelshortFixedTagLabels(html: string): string[] {
  const labels: string[] = [];
  const re = /<a\b[^>]*href=["'][^"']*\/tags\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(html || '')))) {
    const label = decodeHtmlText(match[1] || '');
    if (!label || label.length > 60 || labels.includes(label)) continue;
    labels.push(label);
    if (labels.length >= 6) break;
  }
  return labels;
}

/**
 * NetShort: parse shortPlayDetailVo from Next.js RSC HTML (no classic __NEXT_DATA__).
 * Emit episode page URLs; playable MP4 is resolved later via NetShort encrypted API
 * (`playVoucher`), not yt-dlp on the episode page.
 */
function extractNetshortFromHtml(
  html: string,
  pageUrl: string,
): {
  meta: PageMetaHints;
  episodes: ExtractedPageEpisode[];
} {
  const meta: PageMetaHints = { ...metaFromOgTags(html) };
  const episodes: ExtractedPageEpisode[] = [];
  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return { meta, episodes };
  }

  const vo = extractObjectAfterKey(html, 'shortPlayDetailVo');
  if (vo && typeof vo === 'object') {
    const title = String(vo.shortPlayName || '').trim();
    if (title) meta.title = title.slice(0, 80);
    const cover = String(vo.shortPlayCover || '').trim();
    if (/^https?:\/\//i.test(cover)) meta.coverUrl = cover;
    const desc = String(vo.shotIntroduce || '').trim();
    if (desc) meta.description = desc.slice(0, 300);
    meta.language = 'en';

    const genreLabels: string[] = [];
    pushGenreLabel(genreLabels, vo.shortPlayLabels);
    if (genreLabels.length) meta.genreLabels = [...new Set(genreLabels)].slice(0, 12);
    else if (meta.genreLabels?.length) {
      // Fallback: og keywords, drop title-like first token when it matches the series name.
      meta.genreLabels = meta.genreLabels
        .filter((t) => t.toLowerCase() !== title.toLowerCase())
        .slice(0, 12);
    }

    const basePath =
      String(vo.shortPlayUrl || '').trim() ||
      (() => {
        const key = netshortSeriesKeyFromPath(new URL(pageUrl).pathname);
        return key ? `/episode/${key}` : '';
      })();
    const list = Array.isArray(vo.videoEpisodeInfos) ? vo.videoEpisodeInfos : [];
    if (list.length) meta.chapterCount = list.length;

    for (const ch of list) {
      if (!ch || typeof ch !== 'object') continue;
      const episodeNumber = Number(ch.episodeNo);
      if (!Number.isFinite(episodeNumber) || episodeNumber < 1) continue;
      if (!basePath) continue;
      // Detail list may include isLock for the current visitor session.
      if (
        ch.isLock === true &&
        (!meta.paidStart || episodeNumber < meta.paidStart)
      ) {
        meta.paidStart = episodeNumber;
      }
      const path =
        episodeNumber === 1 ? basePath : `${basePath}-ep-${episodeNumber}`;
      episodes.push({
        episodeNumber,
        title: `EP${episodeNumber}`,
        sourceUrl: `${origin}${path.startsWith('/') ? path : `/${path}`}`,
      });
    }
  }

  // Href fallback when RSC blob missing / incomplete — still page URLs.
  if (episodes.length < 2) {
    for (const ep of extractNetshortEpisodeLinks(html, origin, pageUrl)) {
      if (!episodes.some((e) => e.episodeNumber === ep.episodeNumber)) {
        episodes.push(ep);
      }
    }
    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  }

  return { meta, episodes };
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
  if (Object.prototype.hasOwnProperty.call(pageData, 'update_status')) {
    meta.completion = Number(pageData.update_status) === 1 ? '已完结' : '连载中';
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

/** Pull title/cover/desc (+ episode list) using host-matched parsers. */
export function extractMetaFromNextData(
  html: string,
  pageUrl = '',
): {
  meta: PageMetaHints;
  episodes: ExtractedPageEpisode[];
} {
  const empty = { meta: {} as PageMetaHints, episodes: [] as ExtractedPageEpisode[] };

  // NetShort has no classic __NEXT_DATA__; parse RSC + og tags instead.
  if (pageUrl && isNetshortHost(pageUrl)) {
    return extractNetshortFromHtml(html, pageUrl);
  }

  const m = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m?.[1]) {
    const fixedTags = isReelshortHost(pageUrl)
      ? extractReelshortFixedTagLabels(html)
      : [];
    return fixedTags.length ? { meta: { fixedTagLabels: fixedTags }, episodes: [] } : empty;
  }

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

  // Default / ReelShort: pageProps.data.book_title / chapter_list.
  const parsed = extractReelshortFromPageData(pageProps?.data);
  const fixedTags = isReelshortHost(pageUrl)
    ? extractReelshortFixedTagLabels(html)
    : [];
  if (fixedTags.length) parsed.meta.fixedTagLabels = fixedTags;
  return parsed;
}

/** Build LLM-friendly text: visible copy + hrefs + truncated page JSON. */
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
  let jsonSnippet = next?.[1] ? next[1].slice(0, 40_000) : '';
  if (!jsonSnippet && isNetshortHost(pageUrl)) {
    const vo = extractObjectAfterKey(html, 'shortPlayDetailVo');
    if (vo) jsonSnippet = JSON.stringify(vo).slice(0, 40_000);
  }

  return [
    `Page URL: ${pageUrl}`,
    '',
    'Visible text:',
    stripped.slice(0, 20_000),
    '',
    links ? `Episode hrefs found in HTML:\n${links}` : 'Episode hrefs found in HTML: (none)',
    '',
    jsonSnippet
      ? `${next?.[1] ? '__NEXT_DATA__' : 'shortPlayDetailVo'} JSON (truncated):\n${jsonSnippet}`
      : '',
  ]
    .join('\n')
    .slice(0, 80_000);
}
