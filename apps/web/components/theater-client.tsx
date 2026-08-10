"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { DramaCard } from "@/components/drama-card";
import { loadCategories, loadHome, loadHottest } from "@/lib/api";
import type { Category, Drama } from "@/lib/mock-data";
import { resolveCategorySlug } from "@/lib/mock-data";
import { pickTitleText } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { DataErrorState } from "@/components/data-error-state";
import {
  THEATER_PAGE_SIZE,
  type TheaterInitial,
  type TheaterSortMode,
} from "@/lib/theater-ssr";

type SortMode = TheaterSortMode;
type CacheKey = string;

type TheaterListCache = {
  rows: Drama[];
  total: number;
  page: number;
  hasMore: boolean;
};

type TheaterSnapshot = {
  categories: Category[];
  cat: string;
  sort: SortMode;
  query: string;
  q: string;
  rows: Drama[];
  total: number;
  page: number;
  hasMore: boolean;
  cache: Map<CacheKey, TheaterListCache>;
  scrollY: number;
};

let theaterSnapshot: TheaterSnapshot | null = null;

function cacheKey(cat: string, sort: SortMode, q: string): CacheKey {
  return `${cat || "__all__"}|${sort}|${q}`;
}

function computeHasMore(page: number, pageSize: number, loaded: number, total: number) {
  return loaded > 0 && loaded < total && page * pageSize < total;
}

function appendUnique(prev: Drama[], next: Drama[]) {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((d) => d.id));
  const extra = next.filter((d) => !seen.has(d.id));
  return extra.length ? [...prev, ...extra] : prev;
}

function seedFromInitial(initial: TheaterInitial): TheaterListCache {
  return {
    rows: initial.rows,
    total: initial.total,
    page: initial.page,
    hasMore: initial.hasMore,
  };
}

export function TheaterClient({ initial }: { initial: TheaterInitial | null }) {
  const { locale, t } = useLocale();
  const initialSnapshotRef = useRef(theaterSnapshot);
  const snap = initialSnapshotRef.current;

  const seedKey = cacheKey(
    snap?.cat ?? initial?.cat ?? "",
    snap?.sort ?? initial?.sort ?? "hot",
    snap?.q ?? initial?.q ?? "",
  );
  const seedList: TheaterListCache | null = snap
    ? {
        rows: snap.rows,
        total: snap.total,
        page: snap.page,
        hasMore: snap.hasMore,
      }
    : initial
      ? seedFromInitial(initial)
      : null;

  const [categories, setCategories] = useState<Category[]>(
    () => snap?.categories ?? initial?.categories ?? [],
  );
  const [cat, setCat] = useState<string>(() => snap?.cat ?? initial?.cat ?? "");
  const [sort, setSort] = useState<SortMode>(() => snap?.sort ?? initial?.sort ?? "hot");
  const [query, setQuery] = useState(() => snap?.query ?? initial?.query ?? "");
  const [q, setQ] = useState(() => snap?.q ?? initial?.q ?? "");
  const [rows, setRows] = useState<Drama[]>(() => seedList?.rows ?? []);
  const [total, setTotal] = useState(() => seedList?.total ?? 0);
  const [page, setPage] = useState(() => seedList?.page ?? 1);
  const [hasMore, setHasMore] = useState(() => seedList?.hasMore ?? true);
  const [initialLoading, setInitialLoading] = useState(() => !seedList?.rows.length);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [urlReady, setUrlReady] = useState(() => !!snap || !!initial);

  const cacheRef = useRef<Map<CacheKey, TheaterListCache>>(
    snap?.cache ?? new Map(),
  );
  if (seedList && !cacheRef.current.has(seedKey)) {
    cacheRef.current.set(seedKey, seedList);
  }
  const hasContentRef = useRef(!!seedList?.rows.length);
  const loadMoreLock = useRef(false);
  /** Bumps on filter change so stale page-1/page-N responses cannot mix. */
  const listGenerationRef = useRef(0);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef({
    rows,
    total,
    page,
    hasMore,
    initialLoading,
    refreshing,
    sort,
    cat,
    q,
  });
  listRef.current = {
    rows,
    total,
    page,
    hasMore,
    initialLoading,
    refreshing,
    sort,
    cat,
    q,
  };
  const latestSnapshotRef = useRef({
    categories,
    cat,
    sort,
    query,
    q,
    rows,
    total,
    page,
    hasMore,
  });
  latestSnapshotRef.current = {
    categories,
    cat,
    sort,
    query,
    q,
    rows,
    total,
    page,
    hasMore,
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasRouteState = params.has("cat") || params.has("sort") || params.has("q");
    if (initialSnapshotRef.current && !hasRouteState) {
      setUrlReady(true);
      return;
    }
    if (!initialSnapshotRef.current && initial) {
      // SSR already applied matching URL state
      setUrlReady(true);
      return;
    }
    const nextSort = params.get("sort");
    setCat(resolveCategorySlug(params.get("cat") || ""));
    setSort(nextSort === "latest" || nextSort === "hottest" ? nextSort : "hot");
    setQuery(params.get("q") || "");
    setQ(params.get("q")?.trim() || "");
    setUrlReady(true);
  }, [initial]);

  useEffect(() => {
    const restored = initialSnapshotRef.current;
    if (!restored) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => window.scrollTo(0, restored.scrollY));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(
    () => () => {
      theaterSnapshot = {
        ...latestSnapshotRef.current,
        cache: cacheRef.current,
        scrollY: window.scrollY,
      };
    },
    [],
  );

  useEffect(() => {
    const trimmed = query.trim();
    const timer = window.setTimeout(() => setQ(trimmed), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (categories.length > 0) return;
    let cancelled = false;
    loadCategories()
      .then((c) => {
        if (!cancelled) setCategories(c);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [categories.length]);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams(window.location.search);
    if (cat) params.set("cat", cat);
    else params.delete("cat");
    if (sort !== "hot") params.set("sort", sort);
    else params.delete("sort");
    if (q) params.set("q", q);
    else params.delete("q");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [cat, sort, q, urlReady]);

  useEffect(() => {
    if (!urlReady) return;
    // Filter change: cancel in-flight page-N and release pagination lock.
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadMoreLock.current = false;
    setLoadingMore(false);

    const key = cacheKey(cat, sort, q);
    const cached = cacheRef.current.get(key);
    const ac = new AbortController();
    const generation = ++listGenerationRef.current;

    if (cached) {
      setRows(cached.rows);
      setTotal(cached.total);
      setPage(cached.page);
      setHasMore(cached.hasMore);
      hasContentRef.current = cached.rows.length > 0;
      setInitialLoading(false);
      setRefreshing(false);
      // Keep already-paginated lists intact
      if (cached.page > 1 || (sort === "hottest" && !cat && !q)) {
        return () => ac.abort();
      }
    } else if (!hasContentRef.current) {
      setInitialLoading(true);
      setPage(1);
      setHasMore(true);
    } else {
      setRefreshing(true);
    }

    const stillCurrent = () =>
      !ac.signal.aborted &&
      listGenerationRef.current === generation &&
      listRef.current.page <= 1;

    setLoadError(false);
    const load =
      sort === "hottest" && !cat && !q
        ? loadHottest({ signal: ac.signal }).then((list) => ({
            rows: list,
            total: list.length,
            page: 1,
            hasMore: false,
          }))
        : loadHome(1, THEATER_PAGE_SIZE, {
            category: cat || undefined,
            q: q || undefined,
            sort: sort === "hottest" ? "hot" : sort,
            signal: ac.signal,
          }).then((r) => ({
            rows: r.rows,
            total: r.total,
            page: 1,
            hasMore: computeHasMore(1, THEATER_PAGE_SIZE, r.rows.length, r.total),
          }));

    load
      .then((r) => {
        if (!stillCurrent()) return;
        cacheRef.current.set(key, r);
        hasContentRef.current = true;
        setRows(r.rows);
        setTotal(r.total);
        setPage(r.page);
        setHasMore(r.hasMore);
      })
      .catch((err) => {
        if (!stillCurrent() || (err instanceof DOMException && err.name === "AbortError")) return;
        setLoadError(true);
        if (!cacheRef.current.has(key)) {
          hasContentRef.current = false;
          setRows([]);
          setTotal(0);
          setPage(1);
          setHasMore(false);
        }
      })
      .finally(() => {
        if (ac.signal.aborted || listGenerationRef.current !== generation) return;
        setInitialLoading(false);
        setRefreshing(false);
      });

    return () => {
      ac.abort();
    };
  }, [cat, sort, q, reloadKey, urlReady]);

  const loadMore = useCallback(async () => {
    const cur = listRef.current;
    if (cur.sort === "hottest" && !cur.cat && !cur.q) return;
    if (!cur.hasMore || cur.initialLoading || cur.refreshing || loadMoreLock.current) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    const nextPage = cur.page + 1;
    const key = cacheKey(cur.cat, cur.sort, cur.q);
    const generation = listGenerationRef.current;
    loadMoreAbortRef.current?.abort();
    const ac = new AbortController();
    loadMoreAbortRef.current = ac;
    const timer = window.setTimeout(() => ac.abort(), 15_000);
    try {
      const h = await loadHome(nextPage, THEATER_PAGE_SIZE, {
        category: cur.cat || undefined,
        q: cur.q || undefined,
        sort: cur.sort === "hottest" ? "hot" : cur.sort,
        signal: ac.signal,
      });
      if (ac.signal.aborted || listGenerationRef.current !== generation) return;
      const live = listRef.current;
      if (cacheKey(live.cat, live.sort, live.q) !== key) return;
      const merged = appendUnique(live.rows, h.rows);
      const nextTotal = h.total || live.total;
      const nextHasMore =
        h.rows.length > 0 && computeHasMore(nextPage, THEATER_PAGE_SIZE, merged.length, nextTotal);
      setRows(merged);
      setTotal(nextTotal);
      setPage(nextPage);
      setHasMore(nextHasMore);
      cacheRef.current.set(key, {
        rows: merged,
        total: nextTotal,
        page: nextPage,
        hasMore: nextHasMore,
      });
    } catch {
      // Keep grid; scroll again to retry.
    } finally {
      window.clearTimeout(timer);
      if (loadMoreAbortRef.current === ac) loadMoreAbortRef.current = null;
      loadMoreLock.current = false;
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || initialLoading || !urlReady) return;
    if (sort === "hottest" && !cat && !q) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: null, rootMargin: "600px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, initialLoading, loadMore, urlReady, sort, cat, q, page]);

  function selectAll() {
    if (!cat && sort === "hot") return;
    startTransition(() => {
      setCat("");
      setSort("hot");
    });
  }

  function selectLatest() {
    if (!cat && sort === "latest") return;
    startTransition(() => {
      setCat("");
      setSort("latest");
    });
  }

  function selectHottest() {
    if (!cat && sort === "hottest") return;
    startTransition(() => {
      setCat("");
      setSort("hottest");
    });
  }

  function selectCat(next: string) {
    if (next === cat && sort === "hot") return;
    startTransition(() => {
      setCat(next);
      setSort("hot");
    });
  }

  const showSkeleton = !urlReady || (initialLoading && rows.length === 0);

  return (
    <div className="mx-auto w-full max-w-[1200px] overflow-x-clip px-4 py-6 md:px-6 md:py-10">
      <h1 className="sr-only">{t("theater.title")}</h1>

      <div className="relative mb-5 md:mb-6">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("theater.searchPlaceholder")}
          aria-label={t("theater.searchPlaceholder")}
          className="w-full rounded-full bg-surface-2 py-2.5 pl-10 pr-10 text-body-sm text-ink outline-none placeholder:text-ink-subtle focus:bg-surface-3"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-muted hover:bg-surface-3 hover:text-ink"
            aria-label={t("common.clear")}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/*
        Edge-bleed chip scroller: negative margin stays inside overflow-x-clip parent so
        shrink-0 chips scroll in-place instead of widening the document (mobile shrink-to-fit).
      */}
      <div className="-mx-4 mb-6 min-w-0 md:mx-0">
        <div className="flex gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:px-0">
          <Chip active={!cat && sort === "hot"} onClick={selectAll}>
            {t("theater.all")}
          </Chip>
          <Chip active={!cat && sort === "latest"} onClick={selectLatest}>
            {t("theater.latest")}
          </Chip>
          <Chip active={!cat && sort === "hottest"} onClick={selectHottest}>
            {t("theater.hottest")}
          </Chip>
          {categories.map((c) => (
            <Chip key={c.slug} active={cat === c.slug} onClick={() => selectCat(c.slug)}>
              {pickTitleText(locale, c.nameEn, c.nameZh || "", c.nameFr)}
            </Chip>
          ))}
        </div>
      </div>

      {showSkeleton ? (
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4 md:gap-5 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] min-w-0 animate-pulse rounded-md bg-surface-2" />
          ))}
        </div>
      ) : loadError && rows.length === 0 ? (
        <DataErrorState onRetry={() => setReloadKey((key) => key + 1)} />
      ) : rows.length === 0 ? (
        <p className="py-20 text-center text-ink-muted">
          {q ? t("theater.searchEmpty") : t("theater.empty")}
        </p>
      ) : (
        <>
          <div
            className={cn(
              "grid min-w-0 grid-cols-2 gap-x-3 gap-y-5 transition-opacity duration-200 md:grid-cols-4 md:gap-x-5 md:gap-y-8 lg:grid-cols-5 xl:grid-cols-6",
              refreshing && "pointer-events-none opacity-60",
            )}
            aria-busy={refreshing || loadingMore}
          >
            {rows.map((d) => (
              <div key={d.id} className="min-w-0">
                <DramaCard drama={d} compact reserveTitleLines={2} />
              </div>
            ))}
          </div>
          <div ref={sentinelRef} className="h-px w-full" aria-hidden />
          {loadingMore ? (
            <div className="mt-6 grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4 md:gap-5 lg:grid-cols-5 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] min-w-0 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-11 shrink-0 touch-manipulation rounded-full px-3.5 py-2 text-body-sm transition-colors",
        active
          ? "bg-brand font-medium text-white"
          : "bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
