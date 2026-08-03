"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { DramaCard } from "@/components/drama-card";
import { loadCategories, loadHome } from "@/lib/api";
import type { Category, Drama } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { cn } from "@/lib/utils";

export default function TheaterPage() {
  const { locale, t } = useLocale();
  const [categories, setCategories] = useState<Category[]>([]);
  const [cat, setCat] = useState<string>("");
  const [rows, setRows] = useState<Drama[]>([]);
  const [loading, setLoading] = useState(true);

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
    let cancelled = false;
    setLoading(true);
    loadHome(1, 48, {
      category: cat || undefined,
      sort: "hot",
    })
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cat]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-10">
      <div className="mb-6 flex items-end justify-between gap-4 md:mb-8">
        <h1 className="text-h2 font-bold text-ink md:text-h1">{t("theater.title")}</h1>
      </div>

      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        <Chip active={!cat} onClick={() => setCat("")}>
          {t("theater.all")}
        </Chip>
        {categories.map((c) => (
          <Chip key={c.slug} active={cat === c.slug} onClick={() => setCat(c.slug)}>
            {pickContentText(locale, c.nameVi, c.nameZh)}
          </Chip>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-5 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] animate-pulse rounded-md bg-surface-2" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-20 text-center text-ink-muted">{t("theater.empty")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 md:gap-x-5 md:gap-y-8 lg:grid-cols-5 xl:grid-cols-6">
          {rows.map((d) => (
            <DramaCard key={d.id} drama={d} compact />
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
      className={cn(
        "shrink-0 rounded-full px-3.5 py-1.5 text-body-sm transition-colors",
        active
          ? "bg-brand font-medium text-white"
          : "bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
