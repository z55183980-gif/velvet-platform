"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  adminHongguoDetail,
  adminHongguoImport,
  adminHongguoSearch,
  adminHongguoStatus,
  adminListCategories,
} from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";

type Category = { slug: string; nameZh?: string; nameVi?: string };
type SearchItem = {
  id: string;
  title: string;
  coverUrl?: string;
  episodeCount?: number;
  intro?: string;
};

export function HongguoImportPanel() {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categorySlug, setCategorySlug] = useState("");
  const [maxEpisodes, setMaxEpisodes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    resolvedEpisodes: number;
    failedCount: number;
  } | null>(null);

  const statusQ = useQuery({
    queryKey: ["admin", "hongguo", "status"],
    queryFn: () => adminHongguoStatus(),
  });
  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Category[]>,
  });
  const searchQ = useQuery({
    queryKey: ["admin", "hongguo", "search", q, page],
    queryFn: () => adminHongguoSearch(q, page) as Promise<SearchItem[]>,
    enabled: !!q && !!statusQ.data?.configured,
  });
  const detailQ = useQuery({
    queryKey: ["admin", "hongguo", "detail", selectedId],
    queryFn: () => adminHongguoDetail(selectedId!),
    enabled: !!selectedId && !!statusQ.data?.configured,
  });

  const importMut = useMutation({
    mutationFn: (status: "LIVE" | "DRAFT") => {
      if (!selectedId) throw new Error(t("hongguoNeedSelect"));
      if (!categorySlug) throw new Error(t("onlineNeedCategory"));
      const max = maxEpisodes.trim() ? Number(maxEpisodes) : undefined;
      return adminHongguoImport({
        id: selectedId,
        categorySlug,
        titleZh: detailQ.data?.title,
        status,
        maxEpisodes: max && max > 0 ? max : undefined,
      });
    },
    onSuccess: (data) => {
      setError(null);
      setResult({
        id: data.id,
        resolvedEpisodes: data.resolvedEpisodes,
        failedCount: data.failedEpisodes?.length ?? 0,
      });
    },
    onError: (e: Error) => setError(e.message),
  });

  const configured = !!statusQ.data?.configured;

  return (
    <div className="space-y-4">
      <div className="card glass-card space-y-2 p-4">
        <h3 className="text-h4 font-semibold">{t("hongguoImportTitle")}</h3>
        <p className="text-body-sm text-ink-muted">{t("hongguoImportHint")}</p>
        {!configured ? (
          <p className="text-body-sm text-danger">{t("hongguoNotConfigured")}</p>
        ) : (
          <p className="text-caption text-ink-muted">
            {t("hongguoProvider")}: {statusQ.data?.provider} · {statusQ.data?.baseUrl}
          </p>
        )}
      </div>

      {error ? <p className="text-body-sm text-danger">{error}</p> : null}
      {result ? (
        <div className="card glass-card flex flex-wrap items-center gap-3 p-4 text-body-sm">
          <span>
            {t("hongguoImported", {
              n: result.resolvedEpisodes,
              failed: result.failedCount,
            })}
          </span>
          <Link href={`/content/${result.id}`} className="text-brand hover:underline">
            {t("onlineViewDrama")}
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="w-64"
          placeholder={t("hongguoKeyword")}
          value={keyword}
          disabled={!configured}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setPage(1);
              setQ(keyword.trim());
              setSelectedId(null);
              setResult(null);
            }
          }}
        />
        <Button
          size="sm"
          disabled={!configured || !keyword.trim() || searchQ.isFetching}
          onClick={() => {
            setPage(1);
            setQ(keyword.trim());
            setSelectedId(null);
            setResult(null);
          }}
        >
          {t("search")}
        </Button>
      </div>

      {searchQ.isFetching ? <p className="text-body-sm text-ink-muted">{t("loading")}</p> : null}
      {searchQ.data?.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {searchQ.data.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id);
                setResult(null);
              }}
              className={[
                "card glass-card flex gap-3 p-3 text-left transition-colors",
                selectedId === item.id ? "ring-2 ring-brand" : "hover:bg-white/40",
              ].join(" ")}
            >
              {item.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.coverUrl} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-16 w-12 shrink-0 rounded bg-surface-2" />
              )}
              <div className="min-w-0">
                <div className="truncate font-medium">{item.title}</div>
                <div className="text-caption text-ink-muted">
                  ID {item.id}
                  {item.episodeCount ? ` · ${item.episodeCount} ep` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {q && searchQ.data && !searchQ.isFetching ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("prevPage")}
          </Button>
          <span className="text-caption text-ink-muted">{t("pageNumber", { n: page })}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={(searchQ.data?.length ?? 0) === 0}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("nextPage")}
          </Button>
        </div>
      ) : null}

      {detailQ.data ? (
        <div className="card glass-card space-y-3 p-4">
          <div className="flex flex-wrap gap-3">
            {detailQ.data.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={detailQ.data.coverUrl}
                alt=""
                className="h-24 w-16 rounded object-cover"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold">{detailQ.data.title}</h4>
              <p className="text-caption text-ink-muted">
                {t("hongguoEpisodeCount", { n: detailQ.data.episodes.length })}
              </p>
              {detailQ.data.intro ? (
                <p className="mt-1 line-clamp-3 text-body-sm text-ink-muted">{detailQ.data.intro}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-caption text-ink-muted">
              {t("onlineCategory")}
              <Select
                className="mt-1 w-48"
                value={categorySlug}
                onChange={(e) => setCategorySlug(e.target.value)}
              >
                <option value="">{t("onlineCategory")}</option>
                {(categoriesQ.data ?? []).map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.nameZh || c.nameVi || c.slug}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-caption text-ink-muted">
              {t("hongguoMaxEpisodes")}
              <Input
                className="mt-1 w-28"
                type="number"
                placeholder={t("all")}
                value={maxEpisodes}
                onChange={(e) => setMaxEpisodes(e.target.value)}
              />
            </label>
            <Button size="sm" disabled={importMut.isPending} onClick={() => importMut.mutate("LIVE")}>
              {t("hongguoImportLive")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={importMut.isPending}
              onClick={() => importMut.mutate("DRAFT")}
            >
              {t("hongguoImportDraft")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
