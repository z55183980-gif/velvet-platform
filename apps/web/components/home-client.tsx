"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { dramaToHeroSlide, Hero, type HeroSlide } from "@/components/hero";
import { DramaCard } from "@/components/drama-card";
import { VerticalFeed, peekHomeFeedSnapshot } from "@/components/mobile/vertical-feed";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { loadBanners, loadFeatured, loadHome, type HomeBanner } from "@/lib/api";
import {
  HOME_PAGE_SIZE,
  type HomeDesktopInitial,
  type HomeMobileFeedInitial,
} from "@/lib/home-ssr";
import type { Drama } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { DataErrorState } from "@/components/data-error-state";

function bannerToSlide(banner: HomeBanner): HeroSlide {
  const href =
    banner.linkUrl ||
    (banner.dramaId ? `/drama/${banner.dramaId}` : "/");
  const cover = banner.imageUrl || "#1a1a1a";
  return {
    id: `banner-${banner.id}`,
    titleEn: banner.titleEn,
    titleZh: banner.titleZh || banner.titleEn,
    cover: [cover, cover],
    href,
    tags: [],
    coverKind: "banner",
    focusX: banner.focusX,
    focusY: banner.focusY,
  };
}

type HomeCache = {
  heroSlides: HeroSlide[];
  hot: Drama[];
  rows: Drama[];
  total: number;
  banners: HomeBanner[];
  featured: Drama[];
  page: number;
  hasMore: boolean;
};

type HomeSnapshot = {
  key: string;
  heroSlides: HeroSlide[];
  hot: Drama[];
  rows: Drama[];
  total: number;
  banners: HomeBanner[];
  featured: Drama[];
  page: number;
  hasMore: boolean;
  cache: Map<string, HomeCache>;
  scrollY: number;
  /** Last painted layout was the desktop grid (not mobile VerticalFeed). */
  desktopLayout: boolean;
};

let homeSnapshot: HomeSnapshot | null = null;

function homeKey(category?: string, q?: string, sort?: string) {
  return `${category || ""}|${q || ""}|${sort || ""}`;
}

function entryHasContent(entry: Pick<HomeCache, "heroSlides" | "hot" | "rows"> | null | undefined) {
  return !!entry && (entry.rows.length > 0 || entry.hot.length > 0 || entry.heroSlides.length > 0);
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

function cacheFromInitial(initial: HomeDesktopInitial): HomeCache {
  const featured =
    initial.featured.length > 0 ? initial.featured : initial.rows.slice(0, 5);
  const heroSlides =
    initial.banners.length > 0
      ? initial.banners.slice(0, 5).map(bannerToSlide)
      : featured.map((d) => ({
          id: d.id,
          titleEn: d.titleEn,
          titleZh: d.titleZh,
          titleFr: d.titleFr,
          descEn: d.descEn,
          descZh: d.descZh,
          cover: d.cover,
          href: `/drama/${d.id}`,
          tags: [] as string[],
          coverKind: "poster" as const,
        }));
  return {
    heroSlides,
    hot: initial.hot,
    rows: initial.rows,
    total: initial.total,
    banners: initial.banners,
    featured,
    page: initial.page || 1,
    hasMore:
      typeof initial.hasMore === "boolean"
        ? initial.hasMore
        : computeHasMore(1, HOME_PAGE_SIZE, initial.rows.length, initial.total),
  };
}

function toCacheEntry(
  entry: Pick<
    HomeCache,
    "heroSlides" | "hot" | "rows" | "total" | "banners" | "featured" | "page" | "hasMore"
  >,
): HomeCache {
  return {
    heroSlides: entry.heroSlides,
    hot: entry.hot,
    rows: entry.rows,
    total: entry.total,
    banners: entry.banners,
    featured: entry.featured,
    page: entry.page,
    hasMore: entry.hasMore,
  };
}

function HomeInner({
  initialUnfiltered,
  initialMobileFeed,
  preferMobileFeed,
}: {
  initialUnfiltered: HomeDesktopInitial | null;
  initialMobileFeed: HomeMobileFeedInitial | null;
  preferMobileFeed: boolean;
}) {
  const { locale, t } = useLocale();
  const { mobile: isMobile, ready: mobileReady } = useIsMobile();
  const params = useSearchParams();
  const category = params.get("cat") || undefined;
  const q = params.get("q") || undefined;
  const sortParam = params.get("sort");
  const sort = sortParam === "hot" || sortParam === "latest" ? sortParam : undefined;
  const filtered = !!(category || q || sort);
  const key = homeKey(category, q, sort);

  const initialSnapshotRef = useRef(homeSnapshot);
  const snap = initialSnapshotRef.current;
  const fromSnap = snap?.cache.get(key) ?? (snap?.key === key ? snap : null);
  const fromSsr =
    !filtered && initialUnfiltered ? cacheFromInitial(initialUnfiltered) : null;
  const restore = (fromSnap && entryHasContent(fromSnap) ? fromSnap : null) ?? fromSsr;
  const restoredDesktop =
    !!restore &&
    entryHasContent(restore) &&
    (!!fromSsr || (snap?.desktopLayout ?? true));

  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>(() => restore?.heroSlides ?? []);
  const [hot, setHot] = useState<Drama[]>(() => restore?.hot ?? []);
  const [rows, setRows] = useState<Drama[]>(() => restore?.rows ?? []);
  const [total, setTotal] = useState(() => restore?.total ?? 0);
  const [banners, setBanners] = useState<HomeBanner[]>(() => restore?.banners ?? []);
  const [featured, setFeatured] = useState<Drama[]>(() => restore?.featured ?? []);
  const [page, setPage] = useState(() => restore?.page ?? 1);
  const [hasMore, setHasMore] = useState(() =>
    restore
      ? typeof restore.hasMore === "boolean"
        ? restore.hasMore
        : computeHasMore(
            restore.page ?? 1,
            HOME_PAGE_SIZE,
            (restore.hot.length > 0 ? restore.hot : restore.rows).length,
            restore.total,
          )
      : true,
  );
  const [initialLoading, setInitialLoading] = useState(() => !entryHasContent(restore));
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const cacheRef = useRef<Map<string, HomeCache>>(snap?.cache ?? new Map());
  if (fromSsr && !cacheRef.current.has(homeKey())) {
    cacheRef.current.set(homeKey(), fromSsr);
  }
  if (restore && !cacheRef.current.has(key)) {
    cacheRef.current.set(key, toCacheEntry(restore));
  }
  const hasContentRef = useRef(entryHasContent(restore));
  const loadMoreLock = useRef(false);
  /** Bumps on filter/key change so stale page-1 revalidate cannot wipe page-2. */
  const listGenerationRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef({
    hot,
    rows,
    total,
    page,
    hasMore,
    heroSlides,
    banners,
    featured,
    initialLoading,
    refreshing,
  });
  listRef.current = {
    hot,
    rows,
    total,
    page,
    hasMore,
    heroSlides,
    banners,
    featured,
    initialLoading,
    refreshing,
  };
  const latestSnapshotRef = useRef({
    key,
    heroSlides,
    hot,
    rows,
    total,
    banners,
    featured,
    page,
    hasMore,
    desktopLayout: restoredDesktop,
  });
  latestSnapshotRef.current = {
    key,
    heroSlides,
    hot,
    rows,
    total,
    banners,
    featured,
    page,
    hasMore,
    desktopLayout: mobileReady ? !(isMobile && !filtered) : restoredDesktop,
  };

  const persistCache = useCallback(
    (entry: HomeCache) => {
      cacheRef.current.set(key, entry);
    },
    [key],
  );

  useEffect(() => {
    const restored = initialSnapshotRef.current;
    if (!restored || restored.key !== key || !fromSnap || !restoredDesktop) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => window.scrollTo(0, restored.scrollY));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
    // Only restore scroll for the mount that reused this snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      const latest = latestSnapshotRef.current;
      const hasContent = entryHasContent(latest) || cacheRef.current.size > 0;
      // Mobile VerticalFeed owns its own snapshot; don't wipe a good desktop cache
      // when this visit never painted/loaded the desktop grid.
      if (!hasContent && !latest.desktopLayout) return;
      homeSnapshot = {
        ...latest,
        cache: cacheRef.current,
        scrollY: window.scrollY,
      };
    },
    [],
  );

  useEffect(() => {
    // The unfiltered mobile route owns its feed request. Avoid downloading the
    // desktop banners/featured/grid payload before the breakpoint is known.
    if (!mobileReady || (isMobile && !filtered)) {
      setInitialLoading(false);
      setRefreshing(false);
      return;
    }

    const cached = cacheRef.current.get(key);
    const ac = new AbortController();
    const generation = ++listGenerationRef.current;

    if (cached) {
      setHeroSlides(cached.heroSlides);
      setHot(cached.hot);
      setRows(cached.rows);
      setTotal(cached.total);
      setBanners(cached.banners);
      setFeatured(cached.featured);
      setPage(cached.page);
      setHasMore(cached.hasMore);
      hasContentRef.current = true;
      setInitialLoading(false);
      setRefreshing(false);
      // Keep already-paginated lists intact — no silent page-1 wipe.
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

    const run = async () => {
      try {
        setLoadError(false);
        if (filtered) {
          const [f, h] = await Promise.all([
            loadFeatured({ signal: ac.signal }),
            loadHome(1, HOME_PAGE_SIZE, { category, q, sort, signal: ac.signal }),
          ]);
          if (!stillCurrent()) return;
          const feat = f.length ? f : h.rows.slice(0, 5);
          const slides = feat.map((d) => dramaToHeroSlide(d, locale, t));
          const nextPage = 1;
          const nextHasMore = computeHasMore(nextPage, HOME_PAGE_SIZE, h.rows.length, h.total);
          const next: HomeCache = {
            heroSlides: slides,
            hot: [],
            rows: h.rows,
            total: h.total,
            banners: [],
            featured: feat,
            page: nextPage,
            hasMore: nextHasMore,
          };
          persistCache(next);
          hasContentRef.current = true;
          setHeroSlides(slides);
          setHot([]);
          setRows(h.rows);
          setTotal(h.total);
          setBanners([]);
          setFeatured(feat);
          setPage(nextPage);
          setHasMore(nextHasMore);
        } else {
          const [b, f, hHot] = await Promise.all([
            loadBanners({ signal: ac.signal }),
            loadFeatured({ signal: ac.signal }),
            loadHome(1, HOME_PAGE_SIZE, { sort: "hot", signal: ac.signal }),
          ]);
          if (!stillCurrent()) return;
          const feat = f.length > 0 ? f : hHot.rows.slice(0, 5);
          const slides =
            b.length > 0
              ? b.slice(0, 5).map(bannerToSlide)
              : feat.map((d) => dramaToHeroSlide(d, locale, t));
          const nextPage = 1;
          const nextHasMore = computeHasMore(
            nextPage,
            HOME_PAGE_SIZE,
            hHot.rows.length,
            hHot.total,
          );
          const next: HomeCache = {
            heroSlides: slides,
            hot: hHot.rows,
            rows: hHot.rows,
            total: hHot.total,
            banners: b,
            featured: feat,
            page: nextPage,
            hasMore: nextHasMore,
          };
          persistCache(next);
          hasContentRef.current = true;
          setHeroSlides(slides);
          setHot(hHot.rows);
          setRows(hHot.rows);
          setTotal(hHot.total);
          setBanners(b);
          setFeatured(feat);
          setPage(nextPage);
          setHasMore(nextHasMore);
        }
      } catch {
        if (!stillCurrent()) return;
        setLoadError(true);
        if (!cacheRef.current.has(key)) {
          hasContentRef.current = false;
          setHeroSlides([]);
          setHot([]);
          setRows([]);
          setTotal(0);
          setBanners([]);
          setFeatured([]);
          setPage(1);
          setHasMore(false);
        }
      } finally {
        if (ac.signal.aborted || listGenerationRef.current !== generation) return;
        setInitialLoading(false);
        setRefreshing(false);
      }
    };

    void run();
    return () => ac.abort();
    // locale/t only affect labels — remapped in separate effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, q, sort, filtered, mobileReady, isMobile, reloadKey, key, persistCache]);

  // Remap hero titles when locale changes without refetching
  useEffect(() => {
    if (banners.length > 0) {
      setHeroSlides(banners.slice(0, 5).map(bannerToSlide));
    } else if (featured.length > 0) {
      setHeroSlides(featured.map((d) => dramaToHeroSlide(d, locale, t)));
    }
  }, [locale, t, banners, featured]);

  const loadMore = useCallback(async () => {
    if (!mobileReady || (isMobile && !filtered)) return;
    const cur = listRef.current;
    if (!cur.hasMore || cur.initialLoading || cur.refreshing || loadMoreLock.current) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    const nextPage = cur.page + 1;
    const generation = listGenerationRef.current;
    const requestKey = key;
    const ac = new AbortController();
    try {
      const h = await loadHome(nextPage, HOME_PAGE_SIZE, {
        category: filtered ? category : undefined,
        q: filtered ? q : undefined,
        sort: filtered ? sort : "hot",
        signal: ac.signal,
      });
      if (ac.signal.aborted || listGenerationRef.current !== generation) return;
      // Filter key must still match; otherwise drop stale page-N.
      if (requestKey !== key) return;
      const live = listRef.current;
      const base = filtered ? live.rows : live.hot.length > 0 ? live.hot : live.rows;
      const merged = appendUnique(base, h.rows);
      const nextTotal = h.total || live.total;
      const nextHasMore =
        h.rows.length > 0 && computeHasMore(nextPage, HOME_PAGE_SIZE, merged.length, nextTotal);
      if (filtered) {
        setRows(merged);
        setHot([]);
      } else {
        setHot(merged);
        setRows(merged);
      }
      setTotal(nextTotal);
      setPage(nextPage);
      setHasMore(nextHasMore);
      const prev = cacheRef.current.get(requestKey);
      persistCache({
        heroSlides: prev?.heroSlides ?? live.heroSlides,
        hot: filtered ? [] : merged,
        rows: merged,
        total: nextTotal,
        banners: prev?.banners ?? live.banners,
        featured: prev?.featured ?? live.featured,
        page: nextPage,
        hasMore: nextHasMore,
      });
    } catch {
      // Keep existing grid; user can scroll again to retry.
    } finally {
      loadMoreLock.current = false;
      setLoadingMore(false);
    }
  }, [mobileReady, isMobile, filtered, category, q, sort, key, persistCache]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || initialLoading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: null, rootMargin: "600px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, initialLoading, loadMore, key]);

  const filterTitle = useMemo(() => {
    if (q) return `“${q}”`;
    if (category) return t("sections.allCategories");
    if (sort === "latest") return t("sections.newReleases");
    if (sort === "hot") return t("sections.trending");
    return t("sections.trending");
  }, [q, category, sort, t]);

  const gridDramas = hot.length > 0 ? hot : rows;

  const mobileFeedSeeded =
    !filtered &&
    (preferMobileFeed ||
      !!(initialMobileFeed && initialMobileFeed.rows.length > 0) ||
      !!(peekHomeFeedSnapshot()?.dramas.length));

  // Soft-nav remounts / SSR always start ready=false.
  // - PC with desktop snapshot/SSR: paint grid immediately
  // - Mobile UA / feed snapshot / SSR feed: paint VerticalFeed immediately (never the PC grid skeleton)
  if (!mobileReady) {
    if (mobileFeedSeeded) {
      return (
        <VerticalFeed
          source="home"
          initialFeed={
            initialMobileFeed
              ? {
                  rows: initialMobileFeed.rows,
                  page: initialMobileFeed.page,
                  hasMore: initialMobileFeed.hasMore,
                }
              : null
          }
        />
      );
    }
    if (!restoredDesktop) {
      return (
        <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-10">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        </div>
      );
    }
  }

  // Mobile home: mixed feed (ops hottest + 7d heat), self-paging
  if (mobileReady && isMobile && !filtered) {
    return (
      <VerticalFeed
        source="home"
        initialFeed={
          initialMobileFeed
            ? {
                rows: initialMobileFeed.rows,
                page: initialMobileFeed.page,
                hasMore: initialMobileFeed.hasMore,
              }
            : null
        }
      />
    );
  }

  const showSkeleton = initialLoading && gridDramas.length === 0 && rows.length === 0;

  const gridFooter = (
    <>
      <div ref={sentinelRef} className="h-px w-full" aria-hidden />
      {loadingMore ? (
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : null}
    </>
  );

  return (
    <>
      {!filtered && heroSlides.length > 0 && <Hero slides={heroSlides} />}

      {filtered ? (
        <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-10 md:py-16">
          <section>
            <div className="mb-8 flex items-baseline justify-between gap-4">
              <h2 className="text-h2 font-bold text-ink">{filterTitle}</h2>
              <span className="text-body-sm text-ink-subtle">{total}</span>
            </div>
            {showSkeleton ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface-2" />
                ))}
              </div>
            ) : loadError && rows.length === 0 ? (
              <DataErrorState onRetry={() => setReloadKey((k) => k + 1)} />
            ) : rows.length === 0 ? (
              <p className="py-16 text-center text-ink-muted">{t("theater.empty")}</p>
            ) : (
              <>
                <div
                  className={cn(
                    "grid grid-cols-2 gap-x-4 gap-y-7 transition-opacity duration-200 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
                    refreshing && "pointer-events-none opacity-60",
                  )}
                  aria-busy={refreshing || loadingMore}
                >
                  {rows.map((d) => (
                    <DramaCard key={d.id} drama={d} variant="grid" />
                  ))}
                </div>
                {gridFooter}
              </>
            )}
          </section>
        </div>
      ) : (
        <div className="relative z-10 -mt-2 bg-base pb-20 pt-10 md:pt-14">
          <section className="mx-auto max-w-[1280px] px-4 md:px-10">
            <h2 className="mb-6 text-[22px] font-bold text-ink md:mb-8 md:text-[26px]">
              {t("sections.hotDramas")}
            </h2>
            {showSkeleton ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface-2" />
                ))}
              </div>
            ) : loadError && gridDramas.length === 0 ? (
              <DataErrorState onRetry={() => setReloadKey((k) => k + 1)} />
            ) : (
              <>
                <div
                  className={cn(
                    "grid grid-cols-2 gap-x-4 gap-y-7 transition-opacity duration-200 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
                    refreshing && "pointer-events-none opacity-60",
                  )}
                  aria-busy={refreshing || loadingMore}
                >
                  {gridDramas.map((d) => (
                    <DramaCard key={d.id} drama={d} variant="grid" />
                  ))}
                </div>
                {gridFooter}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export function HomeClient({
  initialUnfiltered,
  initialMobileFeed,
  preferMobileFeed = false,
}: {
  initialUnfiltered: HomeDesktopInitial | null;
  initialMobileFeed?: HomeMobileFeedInitial | null;
  preferMobileFeed?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <HomeInner
        initialUnfiltered={initialUnfiltered}
        initialMobileFeed={initialMobileFeed ?? null}
        preferMobileFeed={preferMobileFeed}
      />
    </Suspense>
  );
}
