"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, Filter, Flame, Play, Search, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { DramaCard } from "@/components/drama-card";
import { loadDramaTags, loadHome } from "@/lib/api";
import type { Drama } from "@/lib/mock-data";
import {
  composeDramaTagFilter,
  DRAMA_CONTENT_TYPES,
  resolveContentTypeSlug,
  type DramaContentTypeSlug,
} from "@/lib/drama-tags";
import { cn } from "@/lib/utils";
import { DataErrorState } from "@/components/data-error-state";
import {
  THEATER_PAGE_SIZE,
  type TheaterInitial,
  type TheaterSortMode,
} from "@/lib/theater-ssr";

type SortMode = TheaterSortMode;
type CacheKey = string;
type ContentTypeFilter = DramaContentTypeSlug | "";

type TheaterListCache = {
  rows: Drama[];
  total: number;
  page: number;
  hasMore: boolean;
};

type TheaterSnapshot = {
  contentType: ContentTypeFilter;
  tag: string;
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

function cacheKey(
  contentType: ContentTypeFilter,
  tag: string,
  sort: SortMode,
  q: string,
): CacheKey {
  return `${contentType || "__all__"}|${tag || "__notag__"}|${sort}|${q}`;
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
  const { t } = useLocale();
  const initialSnapshotRef = useRef(theaterSnapshot);
  const snap = initialSnapshotRef.current;

  const seedKey = cacheKey(
    snap?.contentType ?? initial?.contentType ?? "",
    snap?.tag ?? initial?.tag ?? "",
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

  const [contentType, setContentType] = useState<ContentTypeFilter>(
    () => snap?.contentType ?? initial?.contentType ?? "",
  );
  const [tag, setTag] = useState(() => snap?.tag ?? initial?.tag ?? "");
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  const cacheRef = useRef<Map<CacheKey, TheaterListCache>>(
    snap?.cache ?? new Map(),
  );
  if (seedList && !cacheRef.current.has(seedKey)) {
    cacheRef.current.set(seedKey, seedList);
  }
  const hasContentRef = useRef(!!seedList?.rows.length);
  const loadMoreLock = useRef(false);
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
    contentType,
    tag,
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
    contentType,
    tag,
    q,
  };
  const latestSnapshotRef = useRef({
    contentType,
    tag,
    sort,
    query,
    q,
    rows,
    total,
    page,
    hasMore,
  });
  latestSnapshotRef.current = {
    contentType,
    tag,
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
    const hasRouteState =
      params.has("type") ||
      params.has("tag") ||
      params.has("sort") ||
      params.has("q") ||
      params.has("cat");
    if (initialSnapshotRef.current && !hasRouteState) {
      setUrlReady(true);
      return;
    }
    if (!initialSnapshotRef.current && initial) {
      setUrlReady(true);
      return;
    }
    const nextSort = params.get("sort");
    setContentType(resolveContentTypeSlug(params.get("type") || ""));
    setTag((params.get("tag") || "").trim());
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
    if (!filterOpen || allTags.length > 0) return;
    let cancelled = false;
    setTagsLoading(true);
    loadDramaTags()
      .then((list) => {
        if (!cancelled) setAllTags(list);
      })
      .catch(() => {
        if (!cancelled) setAllTags([]);
      })
      .finally(() => {
        if (!cancelled) setTagsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterOpen, allTags.length]);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("cat");
    if (contentType) params.set("type", contentType);
    else params.delete("type");
    if (tag) params.set("tag", tag);
    else params.delete("tag");
    if (sort !== "hot") params.set("sort", sort);
    else params.delete("sort");
    if (q) params.set("q", q);
    else params.delete("q");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [contentType, tag, sort, q, urlReady]);

  useEffect(() => {
    if (!urlReady) return;
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadMoreLock.current = false;
    setLoadingMore(false);

    const key = cacheKey(contentType, tag, sort, q);
    const cached = cacheRef.current.get(key);
    const ac = new AbortController();
    const generation = ++listGenerationRef.current;
    const tagFilter = composeDramaTagFilter(contentType, tag);

    if (cached) {
      setRows(cached.rows);
      setTotal(cached.total);
      setPage(cached.page);
      setHasMore(cached.hasMore);
      hasContentRef.current = cached.rows.length > 0;
      setInitialLoading(false);
      setRefreshing(false);
      // Keep already-paginated lists; only refresh page-1 caches in background.
      if (cached.page > 1) {
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
    const load = loadHome(1, THEATER_PAGE_SIZE, {
      tag: tagFilter,
      q: q || undefined,
      sort: sort === "latest" ? "latest" : "hot",
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
  }, [contentType, tag, sort, q, reloadKey, urlReady]);

  const loadMore = useCallback(async () => {
    const cur = listRef.current;
    if (!cur.hasMore || cur.initialLoading || cur.refreshing || loadMoreLock.current) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    const nextPage = cur.page + 1;
    const key = cacheKey(cur.contentType, cur.tag, cur.sort, cur.q);
    const generation = listGenerationRef.current;
    loadMoreAbortRef.current?.abort();
    const ac = new AbortController();
    loadMoreAbortRef.current = ac;
    const timer = window.setTimeout(() => ac.abort(), 15_000);
    try {
      const h = await loadHome(nextPage, THEATER_PAGE_SIZE, {
        tag: composeDramaTagFilter(cur.contentType, cur.tag),
        q: cur.q || undefined,
        sort: cur.sort === "latest" ? "latest" : "hot",
        signal: ac.signal,
      });
      if (ac.signal.aborted || listGenerationRef.current !== generation) return;
      const live = listRef.current;
      if (cacheKey(live.contentType, live.tag, live.sort, live.q) !== key) return;
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
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: null, rootMargin: "800px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, initialLoading, loadMore, urlReady, sort, contentType, tag, q, page, rows.length]);

  function selectAll() {
    if (!contentType && sort === "hot" && !tag) return;
    startTransition(() => {
      setContentType("");
      setTag("");
      setSort("hot");
    });
  }

  function selectContentType(next: DramaContentTypeSlug) {
    if (next === contentType && sort === "hot") return;
    startTransition(() => {
      setContentType(next);
      setSort("hot");
    });
  }

  function selectRanking() {
    if (sort === "hottest") return;
    startTransition(() => setSort("hottest"));
  }

  function selectNew() {
    if (sort === "latest") return;
    startTransition(() => setSort("latest"));
  }

  function applyTag(next: string) {
    startTransition(() => {
      setTag(next);
      setSort("hot");
    });
  }

  const contentTypeLabel = (slug: DramaContentTypeSlug) => {
    if (slug === "comic") return t("theater.typeComic");
    if (slug === "live") return t("theater.typeLive");
    return t("theater.typeAi");
  };

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

      <div className="-mx-4 mb-3 min-w-0 md:mx-0">
        <div className="flex gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:px-0">
          <Chip active={!contentType && sort === "hot" && !tag} onClick={selectAll}>
            {t("theater.all")}
          </Chip>
          {DRAMA_CONTENT_TYPES.map((item) => (
            <Chip
              key={item.slug}
              active={contentType === item.slug && sort === "hot"}
              onClick={() => selectContentType(item.slug)}
            >
              {contentTypeLabel(item.slug)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="-mx-4 mb-3 min-w-0 md:mx-0">
        <div className="grid grid-cols-3 gap-2 px-4 md:max-w-2xl md:gap-3 md:px-0">
          <ActionPill
            active={!!tag || filterOpen}
            label={tag || t("theater.filter")}
            onClick={() => setFilterOpen((open) => !open)}
            iconBg="bg-[#7C5CFF]"
            icon={<Filter className="h-3 w-3 text-white" strokeWidth={2.5} />}
            trailing={
              filterOpen ? (
                <ChevronUp className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={2.5} />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={2.5} />
              )
            }
          />
          <ActionPill
            active={sort === "hottest"}
            label={t("theater.ranking")}
            onClick={selectRanking}
            iconBg="bg-[#FF7A1A]"
            icon={<Flame className="h-3 w-3 text-white" strokeWidth={2.5} />}
          />
          <ActionPill
            active={sort === "latest"}
            label={t("theater.newDramas")}
            onClick={selectNew}
            iconBg="bg-[#2EC8D8]"
            icon={<Play className="h-3 w-3 fill-white text-white" strokeWidth={2.5} />}
          />
        </div>
      </div>

      <TagFilterPanel
        open={filterOpen}
        tags={allTags}
        loading={tagsLoading}
        selected={tag}
        onSelect={applyTag}
      />

      <div className="mb-6" />

      {showSkeleton ? (
        <div className="grid min-w-0 grid-cols-3 gap-x-2 gap-y-4 lg:grid-cols-4 lg:gap-x-4 lg:gap-y-7 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] min-w-0 animate-pulse rounded-lg bg-surface-2" />
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
              "grid min-w-0 grid-cols-3 gap-x-2 gap-y-4 transition-opacity duration-200 lg:grid-cols-4 lg:gap-x-4 lg:gap-y-7 xl:grid-cols-6",
              refreshing && "pointer-events-none opacity-60",
            )}
            aria-busy={refreshing || loadingMore}
          >
            {rows.map((d) => (
              <DramaCard key={d.id} drama={d} variant="grid" />
            ))}
          </div>
          <div ref={sentinelRef} className="h-px w-full" aria-hidden />
          {loadingMore ? (
            <div className="mt-6 grid min-w-0 grid-cols-3 gap-x-2 gap-y-4 lg:grid-cols-4 lg:gap-x-4 lg:gap-y-7 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] min-w-0 animate-pulse rounded-lg bg-surface-2" />
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
  children: ReactNode;
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

function ActionPill({
  label,
  active,
  onClick,
  icon,
  iconBg,
  trailing,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  icon: ReactNode;
  iconBg: string;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-1.5 rounded-full px-2 py-2 text-body-sm transition-colors md:min-h-12 md:gap-2 md:px-4",
        active
          ? "bg-surface-3 font-medium text-ink ring-1 ring-brand/50"
          : "bg-surface-2 text-ink hover:bg-surface-3",
      )}
    >
      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-[5px] md:h-6 md:w-6", iconBg)}>{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** Inline expand-down tag grid: 3 cols (mobile) / 6 cols (PC) × 5 rows, then “more”. */
function TagFilterPanel({
  open,
  tags,
  loading,
  selected,
  onSelect,
}: {
  open: boolean;
  tags: string[];
  loading: boolean;
  selected: string;
  onSelect: (tag: string) => void;
}) {
  const { t } = useLocale();
  const ROWS_STEP = 5;
  const [cols, setCols] = useState(3);
  const [extraRows, setExtraRows] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setCols(mq.matches ? 6 : 3);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) setExtraRows(0);
  }, [open]);

  const visibleRows = ROWS_STEP + extraRows;
  const visibleSlots = visibleRows * cols;
  // +1 for leading "All"
  const totalItems = 1 + tags.length;
  const hasMore = totalItems > visibleSlots;
  const visibleTagCount = Math.max(0, visibleSlots - 1);
  const visibleTags = tags.slice(0, visibleTagCount);
  const skeletonCount = cols * ROWS_STEP;

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="relative -mx-4 bg-surface px-4 pb-2 pt-1 md:mx-0 md:rounded-xl">
          {loading ? (
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
              {Array.from({ length: skeletonCount }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          ) : tags.length === 0 ? (
            <p className="py-8 text-center text-body-sm text-ink-muted">{t("theater.filterEmpty")}</p>
          ) : (
            <>
              <div
                className="grid grid-cols-3 gap-2 md:grid-cols-6"
                role="listbox"
                aria-label={t("theater.filterTitle")}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={!selected}
                  onClick={() => onSelect("")}
                  className={cn(
                    "h-9 truncate rounded-md bg-surface-2 px-2 text-center text-[13px] transition-colors",
                    !selected ? "font-medium text-brand" : "text-ink hover:bg-surface-3",
                  )}
                >
                  {t("theater.all")}
                </button>
                {visibleTags.map((item) => {
                  const active = selected === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      role="option"
                      aria-selected={active}
                      title={item}
                      onClick={() => onSelect(item)}
                      className={cn(
                        "h-9 truncate rounded-md bg-surface-2 px-2 text-center text-[13px] transition-colors",
                        active ? "font-medium text-brand" : "text-ink hover:bg-surface-3",
                      )}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>

              {hasMore ? (
                <button
                  type="button"
                  onClick={() => setExtraRows((n) => n + ROWS_STEP)}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded-md py-2 text-[13px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  aria-label={t("theater.filterExpand")}
                >
                  <span>{t("theater.filterExpand")}</span>
                  <ChevronDown className="h-4 w-4" strokeWidth={2.25} />
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
