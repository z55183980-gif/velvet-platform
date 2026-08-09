import { mapDrama } from "./api";
import type { Category, Drama } from "./mock-data";
import { serverApiGet } from "./ssr-api";

/** Theater grid page size (API max 50). */
export const THEATER_PAGE_SIZE = 30;

export type TheaterSortMode = "hot" | "latest" | "hottest";

export type TheaterInitial = {
  categories: Category[];
  cat: string;
  sort: TheaterSortMode;
  query: string;
  q: string;
  rows: Drama[];
  total: number;
  page: number;
  hasMore: boolean;
};

function mapCategory(c: any): Category {
  return {
    slug: String(c.slug || ""),
    nameEn: c.nameEn || "",
    nameZh: c.nameZh || "",
    nameFr: c.nameFr || "",
  };
}

function parseSort(raw?: string | string[]): TheaterSortMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "latest" || v === "hottest") return v;
  return "hot";
}

function one(raw?: string | string[]): string {
  if (Array.isArray(raw)) return (raw[0] || "").trim();
  return (raw || "").trim();
}

/**
 * Server prefetch for Theater (categories + first page for current URL filters).
 * Failures return null — client loads as before.
 */
export async function loadTheaterInitial(searchParams: {
  cat?: string | string[];
  sort?: string | string[];
  q?: string | string[];
}): Promise<TheaterInitial | null> {
  try {
    const cat = one(searchParams.cat);
    const sort = parseSort(searchParams.sort);
    const q = one(searchParams.q);

    // Parallelize categories + first page so worst TTFB ≈ one 5s budget, not two.
    const categoriesPromise = serverApiGet<any[]>("/categories", "theater-ssr").catch(
      () => [] as any[],
    );

    if (sort === "hottest" && !cat && !q) {
      const [categoriesRaw, listRaw] = await Promise.all([
        categoriesPromise,
        serverApiGet<any[]>("/dramas/hottest", "theater-ssr"),
      ]);
      const categories = (Array.isArray(categoriesRaw) ? categoriesRaw : [])
        .map(mapCategory)
        .filter((c) => c.slug);
      const rows = (Array.isArray(listRaw) ? listRaw : []).map(mapDrama);
      return {
        categories,
        cat: "",
        sort: "hottest",
        query: "",
        q: "",
        rows,
        total: rows.length,
        page: 1,
        hasMore: false,
      };
    }

    const params = new URLSearchParams({
      page: "1",
      pageSize: String(THEATER_PAGE_SIZE),
      sort: sort === "latest" ? "latest" : "hot",
    });
    if (cat) params.set("category", cat);
    if (q) params.set("q", q);

    const [categoriesRaw, homeRaw] = await Promise.all([
      categoriesPromise,
      serverApiGet<{ rows: any[]; total: number }>(
        `/dramas?${params.toString()}`,
        "theater-ssr",
      ),
    ]);
    const categories = (Array.isArray(categoriesRaw) ? categoriesRaw : [])
      .map(mapCategory)
      .filter((c) => c.slug);
    const rows = (Array.isArray(homeRaw?.rows) ? homeRaw.rows : []).map(mapDrama);
    const total = Number(homeRaw?.total) || rows.length;
    return {
      categories,
      cat,
      sort,
      query: q,
      q,
      rows,
      total,
      page: 1,
      hasMore: rows.length > 0 && rows.length < total,
    };
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[theater-ssr] initial load failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}
