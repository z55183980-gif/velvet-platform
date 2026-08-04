"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { dramaToHeroSlide, Hero, type HeroSlide } from "@/components/hero";
import { DramaCard } from "@/components/drama-card";
import { VerticalFeed } from "@/components/mobile/vertical-feed";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { loadBanners, loadFeatured, loadHome, type HomeBanner } from "@/lib/api";
import type { Drama } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

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
  };
}

type HomeCache = {
  heroSlides: HeroSlide[];
  hot: Drama[];
  rows: Drama[];
  total: number;
  banners: HomeBanner[];
  featured: Drama[];
};

function homeKey(category?: string, q?: string, sort?: string) {
  return `${category || ""}|${q || ""}|${sort || ""}`;
}

function HomeInner() {
  const { locale, t } = useLocale();
  const { mobile: isMobile, ready: mobileReady } = useIsMobile();
  const params = useSearchParams();
  const category = params.get("cat") || undefined;
  const q = params.get("q") || undefined;
  const sortParam = params.get("sort");
  const sort = sortParam === "hot" || sortParam === "latest" ? sortParam : undefined;
  const filtered = !!(category || q || sort);

  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>([]);
  const [hot, setHot] = useState<Drama[]>([]);
  const [rows, setRows] = useState<Drama[]>([]);
  const [total, setTotal] = useState(0);
  const [banners, setBanners] = useState<HomeBanner[]>([]);
  const [featured, setFeatured] = useState<Drama[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const cacheRef = useRef<Map<string, HomeCache>>(new Map());
  const hasContentRef = useRef(false);

  useEffect(() => {
    const key = homeKey(category, q, sort);
    const cached = cacheRef.current.get(key);
    const ac = new AbortController();

    if (cached) {
      setHeroSlides(cached.heroSlides);
      setHot(cached.hot);
      setRows(cached.rows);
      setTotal(cached.total);
      setBanners(cached.banners);
      setFeatured(cached.featured);
      hasContentRef.current = true;
      setInitialLoading(false);
      setRefreshing(false);
    } else if (!hasContentRef.current) {
      setInitialLoading(true);
    } else {
      setRefreshing(true);
    }

    const run = async () => {
      try {
        if (filtered) {
          const [f, h] = await Promise.all([
            loadFeatured({ signal: ac.signal }),
            loadHome(1, 24, { category, q, sort, signal: ac.signal }),
          ]);
          if (ac.signal.aborted) return;
          const feat = f.length ? f : h.rows.slice(0, 5);
          const slides = feat.map((d) => dramaToHeroSlide(d, locale, t));
          const next: HomeCache = {
            heroSlides: slides,
            hot: [],
            rows: h.rows,
            total: h.total,
            banners: [],
            featured: feat,
          };
          cacheRef.current.set(key, next);
          hasContentRef.current = true;
          setHeroSlides(slides);
          setHot([]);
          setRows(h.rows);
          setTotal(h.total);
          setBanners([]);
          setFeatured(feat);
        } else {
          const [b, f, hHot] = await Promise.all([
            loadBanners({ signal: ac.signal }),
            loadFeatured({ signal: ac.signal }),
            loadHome(1, 30, { sort: "hot", signal: ac.signal }),
          ]);
          if (ac.signal.aborted) return;
          const feat = f.length > 0 ? f : hHot.rows.slice(0, 5);
          const slides =
            b.length > 0
              ? b.slice(0, 5).map(bannerToSlide)
              : feat.map((d) => dramaToHeroSlide(d, locale, t));
          const next: HomeCache = {
            heroSlides: slides,
            hot: hHot.rows,
            rows: hHot.rows,
            total: hHot.total,
            banners: b,
            featured: feat,
          };
          cacheRef.current.set(key, next);
          hasContentRef.current = true;
          setHeroSlides(slides);
          setHot(hHot.rows);
          setRows(hHot.rows);
          setTotal(hHot.total);
          setBanners(b);
          setFeatured(feat);
        }
      } catch {
        if (ac.signal.aborted) return;
        if (!cacheRef.current.has(key)) {
          hasContentRef.current = false;
          setHeroSlides([]);
          setHot([]);
          setRows([]);
          setTotal(0);
          setBanners([]);
          setFeatured([]);
        }
      } finally {
        if (ac.signal.aborted) return;
        setInitialLoading(false);
        setRefreshing(false);
      }
    };

    void run();
    return () => ac.abort();
    // locale/t only affect labels — remapped in separate effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, q, sort, filtered]);

  // Remap hero titles when locale changes without refetching
  useEffect(() => {
    if (banners.length > 0) {
      setHeroSlides(banners.slice(0, 5).map(bannerToSlide));
    } else if (featured.length > 0) {
      setHeroSlides(featured.map((d) => dramaToHeroSlide(d, locale, t)));
    }
  }, [locale, t, banners, featured]);

  const filterTitle = useMemo(() => {
    if (q) return `“${q}”`;
    if (category) return t("sections.allCategories");
    if (sort === "latest") return t("sections.newReleases");
    if (sort === "hot") return t("sections.trending");
    return t("sections.trending");
  }, [q, category, sort, t]);

  const feedDramas = hot.length > 0 ? hot : rows;
  const gridDramas = hot.length > 0 ? hot : rows;

  // Wait for breakpoint before choosing mobile feed vs desktop grid (avoids layout flash)
  if (!mobileReady) {
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

  // Mobile home: Hongguo-style vertical feed (unfiltered)
  if (isMobile && !filtered) {
    if (initialLoading && feedDramas.length === 0) {
      return (
        <div className="flex h-full min-h-[50dvh] items-center justify-center bg-base text-ink-muted">
          …
        </div>
      );
    }
    return <VerticalFeed dramas={feedDramas} />;
  }

  const showSkeleton = initialLoading && gridDramas.length === 0 && rows.length === 0;

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
            ) : rows.length === 0 ? (
              <p className="py-16 text-center text-ink-muted">{t("theater.empty")}</p>
            ) : (
              <div
                className={cn(
                  "grid grid-cols-2 gap-x-4 gap-y-7 transition-opacity duration-200 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
                  refreshing && "pointer-events-none opacity-60",
                )}
                aria-busy={refreshing}
              >
                {rows.map((d) => (
                  <DramaCard key={d.id} drama={d} variant="grid" />
                ))}
              </div>
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
            ) : (
              <div
                className={cn(
                  "grid grid-cols-2 gap-x-4 gap-y-7 transition-opacity duration-200 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
                  refreshing && "pointer-events-none opacity-60",
                )}
                aria-busy={refreshing}
              >
                {gridDramas.map((d) => (
                  <DramaCard key={d.id} drama={d} variant="grid" />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-10">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        </div>
      }
    >
      <HomeInner />
    </Suspense>
  );
}
