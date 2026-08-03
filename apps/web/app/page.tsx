"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { Hero } from "@/components/hero";
import { DramaCard } from "@/components/drama-card";
import { ContentRail } from "@/components/content-rail";
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

  const [featured, setFeatured] = useState<Drama | null>(null);
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
          setFeatured(f[0] ?? h.rows[0] ?? null);
          setRows(h.rows);
          setTotal(h.total);
          setHot([]);
          setLatest([]);
        } else {
          const [f, hHot, hLatest, hAll] = await Promise.all([
            loadFeatured(),
            loadHome(1, 16, { sort: "hot" }),
            loadHome(1, 16, { sort: "latest" }),
            loadHome(1, 16),
          ]);
          if (cancelled) return;
          setFeatured(f[0] ?? hHot.rows[0] ?? hAll.rows[0] ?? null);
          setHot(hHot.rows);
          setLatest(hLatest.rows);
          setRows(hAll.rows);
          setTotal(hAll.total);
        }
      } catch {
        if (cancelled) return;
        setFeatured(null);
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
      {!filtered && featured && <Hero featured={featured} />}

      {filtered ? (
        <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-24">
          <section>
            <div className="mb-8 flex items-baseline justify-between gap-4">
              <h2 className="text-h2 font-bold text-ink">{filterTitle}</h2>
              <span className="text-body-sm text-ink-subtle">{total}</span>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="aspect-[2/3] animate-pulse rounded-md bg-surface-2" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="py-16 text-center text-ink-muted">{t("theater.empty")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {rows.map((d) => (
                  <DramaCard key={d.id} drama={d} />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-16 py-16 md:space-y-24 md:py-24">
          <ContentRail title={t("sections.trending")} dramas={hot} loading={loading} />
          <ContentRail title={t("sections.newReleases")} dramas={latest} loading={loading} />
          <ContentRail title={t("sections.forYou")} dramas={rows} loading={loading} />
        </div>
      )}
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-24 text-center text-ink-subtle md:px-6">
          …
        </div>
      }
    >
      <HomeInner />
    </Suspense>
  );
}
