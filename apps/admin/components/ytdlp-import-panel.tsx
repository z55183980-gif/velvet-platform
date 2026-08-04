"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  adminListCategories,
  adminYtdlpImport,
  adminYtdlpProbe,
  adminYtdlpStatus,
} from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";

type Category = { slug: string; nameZh?: string; nameEn?: string };
type ProbeResult = Awaited<ReturnType<typeof adminYtdlpProbe>>;
type FormatPreference = "best_hls" | "best_mp4" | "best";

export function YtdlpImportPanel() {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [categorySlug, setCategorySlug] = useState("");
  const [maxEpisodes, setMaxEpisodes] = useState("");
  const [formatPreference, setFormatPreference] = useState<FormatPreference>("best_hls");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    resolvedEpisodes: number;
    failedCount: number;
  } | null>(null);

  const statusQ = useQuery({
    queryKey: ["admin", "ytdlp", "status"],
    queryFn: () => adminYtdlpStatus(),
  });
  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Category[]>,
  });

  const probeMut = useMutation({
    mutationFn: () => {
      const u = url.trim();
      if (!u) throw new Error(t("ytdlpNeedUrl"));
      return adminYtdlpProbe(u);
    },
    onSuccess: (data) => {
      setError(null);
      setResult(null);
      setProbe(data);
    },
    onError: (e: Error) => {
      setProbe(null);
      setError(e.message);
    },
  });

  const importMut = useMutation({
    mutationFn: (status: "LIVE" | "DRAFT") => {
      if (!probe) throw new Error(t("ytdlpNeedProbe"));
      if (!categorySlug) throw new Error(t("onlineNeedCategory"));
      const max = maxEpisodes.trim() ? Number(maxEpisodes) : undefined;
      return adminYtdlpImport({
        url: url.trim(),
        categorySlug,
        titleZh: probe.title,
        status,
        maxEpisodes: max && max > 0 ? max : undefined,
        formatPreference,
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
        <h3 className="text-h4 font-semibold">{t("ytdlpImportTitle")}</h3>
        <p className="text-body-sm text-ink-muted">{t("ytdlpImportHint")}</p>
        {!configured ? (
          <p className="text-body-sm text-danger">
            {t("ytdlpNotConfigured")}
            {statusQ.data?.lastError ? ` (${statusQ.data.lastError})` : ""}
          </p>
        ) : (
          <p className="text-caption text-ink-muted">
            {t("ytdlpProvider")}: {statusQ.data?.provider}
            {statusQ.data?.version ? ` ${statusQ.data.version}` : ""}
            {statusQ.data?.binSource ? ` · ${t("ytdlpBinSource")}: ${statusQ.data.binSource}` : ""}
            {statusQ.data?.bin ? ` · ${statusQ.data.bin}` : ""}
            {" · "}
            {t("ytdlpNoApiKey")}
          </p>
        )}
      </div>

      {error ? <p className="text-body-sm text-danger">{error}</p> : null}
      {result ? (
        <div className="card glass-card flex flex-wrap items-center gap-3 p-4 text-body-sm">
          <span>
            {t("ytdlpImported", {
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
          className="min-w-[20rem] flex-1"
          placeholder={t("ytdlpUrlPlaceholder")}
          value={url}
          disabled={!configured}
          onChange={(e) => {
            setUrl(e.target.value);
            setProbe(null);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && configured && url.trim()) probeMut.mutate();
          }}
        />
        <Button
          size="sm"
          disabled={!configured || !url.trim() || probeMut.isPending}
          onClick={() => probeMut.mutate()}
        >
          {probeMut.isPending ? t("loading") : t("ytdlpProbe")}
        </Button>
      </div>

      {probe ? (
        <div className="card glass-card space-y-3 p-4">
          <div className="flex flex-wrap gap-3">
            {probe.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={probe.coverUrl} alt="" className="h-24 w-16 rounded object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold">{probe.title}</h4>
              <p className="text-caption text-ink-muted">
                {probe.extractor} · {probe.kind} ·{" "}
                {t("importEpisodeCount", { n: probe.episodes.length })}
              </p>
              {probe.description ? (
                <p className="mt-1 line-clamp-3 text-body-sm text-ink-muted">{probe.description}</p>
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
                    {c.nameZh || c.nameEn || c.slug}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-caption text-ink-muted">
              {t("ytdlpFormat")}
              <Select
                className="mt-1 w-40"
                value={formatPreference}
                onChange={(e) => setFormatPreference(e.target.value as FormatPreference)}
              >
                <option value="best_hls">{t("ytdlpFormatHls")}</option>
                <option value="best_mp4">{t("ytdlpFormatMp4")}</option>
                <option value="best">{t("ytdlpFormatBest")}</option>
              </Select>
            </label>
            <label className="text-caption text-ink-muted">
              {t("importMaxEpisodes")}
              <Input
                className="mt-1 w-28"
                type="number"
                placeholder={t("all")}
                value={maxEpisodes}
                onChange={(e) => setMaxEpisodes(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={importMut.isPending}
              onClick={() => importMut.mutate("DRAFT")}
            >
              {t("importDraft")}
            </Button>
            <Button size="sm" disabled={importMut.isPending} onClick={() => importMut.mutate("LIVE")}>
              {t("importLive")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
