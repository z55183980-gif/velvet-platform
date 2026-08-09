import { resolveApiProxyTarget } from "./api-proxy-target.mjs";
import { mapDrama, type HomeBanner } from "./api";
import type { Drama } from "./mock-data";

/** PC Popular dramas page size (API max is 50). */
export const HOME_PAGE_SIZE = 30;

export type HomeDesktopInitial = {
  banners: HomeBanner[];
  featured: Drama[];
  hot: Drama[];
  rows: Drama[];
  total: number;
  page: number;
  hasMore: boolean;
};

const HOME_SSR_TIMEOUT_MS = 5_000;

type ApiEnvelope<T> = {
  code?: number;
  data?: T;
  message?: unknown;
};

async function serverApiGet<T>(path: string): Promise<T> {
  const base = resolveApiProxyTarget();
  const res = await fetch(`${base}/api/v1${path}`, {
    headers: { Accept: "application/json", "Accept-Language": "en" },
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(HOME_SSR_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.code !== 0 || json.data === undefined) {
    throw new Error(
      `[home-ssr] ${path} failed (${res.status})${json?.message ? `: ${String(json.message)}` : ""}`,
    );
  }
  return json.data;
}

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
      serverApiGet<any[]>("/banners").catch(() => []),
      serverApiGet<any[]>("/dramas/featured").catch(() => []),
      serverApiGet<{ rows: any[]; total: number }>(
        `/dramas?page=1&pageSize=${HOME_PAGE_SIZE}&sort=hot`,
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
