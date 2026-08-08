"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { DramaCard } from "@/components/drama-card";
import { loadCategories, loadHome, loadHottest } from "@/lib/api";
import type { Category, Drama } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { DataErrorState } from "@/components/data-error-state";

type SortMode = "hot" | "latest" | "hottest";
type CacheKey = string;

function cacheKey(cat: string, sort: SortMode, q: string): CacheKey {
  return `${cat || "__all__"}|${sort}|${q}`;
}

export default function TheaterPage() {
  const { locale, t } = useLocale();
  const [categories, setCategories] = useState<Category[]>([]);
  const [cat, setCat] = useState<string>("");
  const [sort, setSort] = useState<SortMode>("hot");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Drama[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [urlReady, setUrlReady] = useState(false);
  const cacheRef = useRef<Map<CacheKey, Drama[]>>(new Map());
  const hasContentRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextSort = params.get("sort");
    setCat(params.get("cat") || "");
    setSort(nextSort === "latest" || nextSort === "hottest" ? nextSort : "hot");
    setQuery(params.get("q") || "");
    setQ(params.get("q")?.trim() || "");
    setUrlReady(true);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const timer = window.setTimeout(() => setQ(trimmed), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
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
  }, []);

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
    const key = cacheKey(cat, sort, q);
    const cached = cacheRef.current.get(key);

    // 命中缓存：立刻切换列表，后台静默刷新
    if (cached) {
      setRows(cached);
      hasContentRef.current = cached.length > 0;
      setInitialLoading(false);
      setRefreshing(false);
    } else if (!hasContentRef.current) {
      setInitialLoading(true);
    } else {
      // 有旧内容时不卸掉网格，仅轻量刷新指示
      setRefreshing(true);
    }

    const ac = new AbortController();
    setLoadError(false);
    const load =
      sort === "hottest" && !cat && !q
        ? loadHottest({ signal: ac.signal }).then((list) => ({ rows: list, total: list.length }))
        : loadHome(1, 48, {
            category: cat || undefined,
            q: q || undefined,
            sort: sort === "hottest" ? "hot" : sort,
            signal: ac.signal,
          });

    load
      .then((r) => {
        if (ac.signal.aborted) return;
        cacheRef.current.set(key, r.rows);
        hasContentRef.current = true;
        setRows(r.rows);
      })
      .catch((err) => {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setLoadError(true);
        if (!cacheRef.current.has(key)) {
          hasContentRef.current = false;
          setRows([]);
        }
      })
      .finally(() => {
        if (ac.signal.aborted) return;
        setInitialLoading(false);
        setRefreshing(false);
      });

    return () => {
      ac.abort();
    };
  }, [cat, sort, q, reloadKey, urlReady]);

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
              {pickContentText(locale, c.nameEn, c.nameZh)}
            </Chip>
          ))}
        </div>
      </div>

      {!urlReady || initialLoading ? (
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
        <div
          className={cn(
            "grid min-w-0 grid-cols-2 gap-x-3 gap-y-5 transition-opacity duration-200 md:grid-cols-4 md:gap-x-5 md:gap-y-8 lg:grid-cols-5 xl:grid-cols-6",
            refreshing && "opacity-60 pointer-events-none",
          )}
          aria-busy={refreshing}
        >
          {rows.map((d) => (
            <div key={d.id} className="min-w-0">
              <DramaCard drama={d} compact reserveTitleLines={2} />
            </div>
          ))}
        </div>
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
