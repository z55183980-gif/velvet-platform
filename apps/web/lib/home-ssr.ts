import { mapDrama, type HomeBanner } from "./api";
import type { Drama } from "./mock-data";
import { serverApiGet } from "./ssr-api";

/** PC Popular dramas page size (API max is 50). */
export const HOME_PAGE_SIZE = 30;

/** Mobile VerticalFeed page size (matches vertical-feed.tsx). */
export const HOME_FEED_PAGE_SIZE = 20;
export const HOME_FEED_PIN_HOTTEST = 3;

export type HomeDesktopInitial = {
  banners: HomeBanner[];
  featured: Drama[];
  hot: Drama[];
  rows: Drama[];
  total: number;
  page: number;
  hasMore: boolean;
};

export type HomeMobileFeedInitial = {
  rows: Drama[];
  page: number;
  hasMore: boolean;
  total: number;
};

function mapBanner(b: any): HomeBanner {
  return {
    id: String(b.id),
    titleEn: b.titleEn || "",
    titleZh: b.titleZh || "",
    imageUrl: b.imageUrl || "",
    linkUrl: b.linkUrl || null,
    dramaId: b.dramaId != null ? String(b.dramaId) : null,
    focusX: b.focusX != null ? Number(b.focusX) : undefined,
    focusY: b.focusY != null ? Number(b.focusY) : undefined,
    sortOrder: b.sortOrder ?? 0,
  };
}

/** Soft mobile UA heuristic for skipping desktop SSR shell (phones use VerticalFeed). */
export function likelyMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

/**
 * Server prefetch for default PC home (banners + featured + hot grid).
 * Failures return null so the client can load as before — never block the route.
 */
export async function loadHomeDesktopInitial(): Promise<HomeDesktopInitial | null> {
  try {
    const [bannersRaw, featuredRaw, homeRaw] = await Promise.all([
      serverApiGet<any[]>("/banners", "home-ssr").catch(() => []),
      serverApiGet<any[]>("/dramas/featured", "home-ssr").catch(() => []),
      serverApiGet<{ rows: any[]; total: number }>(
        `/dramas?page=1&pageSize=${HOME_PAGE_SIZE}&sort=hot`,
        "home-ssr",
      ),
    ]);
    const banners = (Array.isArray(bannersRaw) ? bannersRaw : []).map(mapBanner);
    const featured = (Array.isArray(featuredRaw) ? featuredRaw : []).map(mapDrama);
    const rows = (Array.isArray(homeRaw?.rows) ? homeRaw.rows : []).map(mapDrama);
    const total = Number(homeRaw?.total) || rows.length;
    if (rows.length === 0 && banners.length === 0 && featured.length === 0) return null;
    return {
      banners,
      featured,
      hot: rows,
      rows,
      total,
      page: 1,
      hasMore: rows.length > 0 && rows.length < total,
    };
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[home-ssr] desktop initial load failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

/**
 * Server prefetch for mobile home VerticalFeed (ops hottest pins + 7d heat).
 */
export async function loadHomeMobileFeedInitial(): Promise<HomeMobileFeedInitial | null> {
  try {
    const params = new URLSearchParams({
      page: "1",
      pageSize: String(HOME_FEED_PAGE_SIZE),
      pinHottest: String(HOME_FEED_PIN_HOTTEST),
    });
    const feedRaw = await serverApiGet<{
      rows: any[];
      total: number;
      hasMore?: boolean;
      page?: number;
    }>(`/dramas/feed?${params.toString()}`, "home-ssr");
    const rows = (Array.isArray(feedRaw?.rows) ? feedRaw.rows : []).map(mapDrama);
    const total = Number(feedRaw?.total) || rows.length;
    if (rows.length === 0) return null;
    const page = feedRaw.page || 1;
    const hasMore =
      typeof feedRaw.hasMore === "boolean"
        ? feedRaw.hasMore
        : page * HOME_FEED_PAGE_SIZE < total;
    return { rows, page, hasMore, total };
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[home-ssr] mobile feed initial load failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}
