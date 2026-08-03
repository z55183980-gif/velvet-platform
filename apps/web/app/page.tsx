"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { Hero } from "@/components/hero";
import { DramaCard } from "@/components/drama-card";
import { VerticalFeed } from "@/components/mobile/vertical-feed";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { loadFeatured, loadHome } from "@/lib/api";
import type { Drama } from "@/lib/mock-data";

function HomeInner() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const params = useSearchParams();
  const category = params.get("cat") || undefined;
  const q = params.get("q") || undefined;
  const sortParam = params.get("sort");
  const sort = sortParam === "hot" || sortParam === "latest" ? sortParam : undefined;
  const filtered = !!(category || q || sort);

  const [featuredList, setFeaturedList] = useState<Drama[]>([]);
  const [hot, setHot] = useState<Drama[]>([]);
  const [latest, setLatest] = useState<Drama[]>([]);
  const [rows, setRows] = useState<Drama[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      try {
        if (filtered) {
          const [f, h] = await Promise.all([
            loadFeatured(),
            loadHome(1, 24, { category, q, sort }),
          ]);
          if (cancelled) return;
          setFeaturedList(f.length ? f : h.rows.slice(0, 5));
          setRows(h.rows);
          setTotal(h.total);
          setHot([]);
          setLatest([]);
        } else {
          const [f, hHot, hLatest, hAll] = await Promise.all([
            loadFeatured(),
            loadHome(1, 30, { sort: "hot" }),
            loadHome(1, 16, { sort: "latest" }),
            loadHome(1, 30),
          ]);
          if (cancelled) return;
          const featured =
            f.length > 0
              ? f
              : hHot.rows.length > 0
                ? hHot.rows.slice(0, 5)
                : hAll.rows.slice(0, 5);
          setFeaturedList(featured);
          setHot(hHot.rows);
          setLatest(hLatest.rows);
          setRows(hAll.rows);
          setTotal(hAll.total);
        }
      } catch {
        if (cancelled) return;
        setFeaturedList([]);
        setHot([]);
        setLatest([]);
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [category, q, sort, filtered]);

  const filterTitle = useMemo(() => {
    if (q) return `“${q}”`;
    if (category) return t("sections.allCategories");
    if (sort === "latest") return t("sections.newReleases");
    if (sort === "hot") return t("sections.trending");
    return t("sections.trending");
  }, [q, category, sort, t]);

  const feedDramas = hot.length > 0 ? hot : rows;
  const gridDramas = hot.length > 0 ? hot : rows;

  // Mobile home: Hongguo-style vertical feed (unfiltered)
  if (isMobile && !filtered) {
    if (loading && feedDramas.length === 0) {
      return (
        <div className="flex h-[calc(100dvh-3rem-3.5rem)] items-center justify-center bg-black text-white/60">
          …
        </div>
      );
    }
    return <VerticalFeed dramas={feedDramas} />;
  }

  return (
    <>
      {!filtered && featuredList.length > 0 && <Hero featured={featuredList} />}

      {filtered ? (
        <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-10 md:py-16">
          <section>
            <div className="mb-8 flex items-baseline justify-between gap-4">
              <h2 className="text-h2 font-bold text-ink">{filterTitle}</h2>
              <span className="text-body-sm text-ink-subtle">{total}</span>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface-2" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="py-16 text-center text-ink-muted">{t("theater.empty")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
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
            {loading ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface-2" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {gridDramas.map((d) => (
                  <DramaCard key={d.id} drama={d} variant="grid" />
                ))}
              </div>
            )}
          </section>

          {latest.length > 0 && (
            <section className="mx-auto mt-14 max-w-[1280px] px-4 md:mt-20 md:px-10">
              <h2 className="mb-6 text-[22px] font-bold text-ink md:mb-8 md:text-[26px]">
                {t("sections.newReleases")}
              </h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {latest.map((d) => (
                  <DramaCard key={d.id} drama={d} variant="grid" />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1280px] px-4 py-24 text-center text-ink-subtle md:px-10">
          …
        </div>
      }
    >
      <HomeInner />
    </Suspense>
  );
}
