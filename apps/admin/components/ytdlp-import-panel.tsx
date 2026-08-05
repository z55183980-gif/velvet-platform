"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  adminListCategories,
  adminStorageStatus,
  adminYtdlpImport,
  adminYtdlpProbe,
  adminYtdlpResolve,
  adminYtdlpStatus,
  adminYtdlpTransfer,
} from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { StreamPreview } from "@/components/stream-preview";
import { useI18n } from "@/lib/i18n";

type Category = { slug: string; nameZh?: string; nameEn?: string };
type ProbeResult = Awaited<ReturnType<typeof adminYtdlpProbe>>;
type FormatPreference = "best_hls" | "best_mp4" | "best";
type TransferTarget = "local" | "r2";

export function YtdlpImportPanel() {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [categorySlug, setCategorySlug] = useState("");
  const [maxEpisodes, setMaxEpisodes] = useState("");
  const [formatPreference, setFormatPreference] = useState<FormatPreference>("best_hls");
  const [error, setError] = useState<string | null>(null);
  const [previewEpIndex, setPreviewEpIndex] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localMediaUrl, setLocalMediaUrl] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    resolvedEpisodes: number;
    failedCount: number;
    mode: "online" | "transfer";
    target?: TransferTarget;
  } | null>(null);

  const statusQ = useQuery({
    queryKey: ["admin", "ytdlp", "status"],
    queryFn: () => adminYtdlpStatus(),
  });
  const storageQ = useQuery({
    queryKey: ["admin", "storage", "status"],
    queryFn: () => adminStorageStatus(),
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
      setPreviewEpIndex(null);
      setPreviewUrl(null);
      setLocalMediaUrl(null);
      setProbe(data);
    },
    onError: (e: Error) => {
      setProbe(null);
      setError(e.message);
    },
  });

  const resolveMut = useMutation({
    mutationFn: (ep: ProbeResult["episodes"][number]) =>
      adminYtdlpResolve({
        url: ep.webpageUrl,
        formatPreference,
        playlistIndex: ep.playlistIndex,
      }),
    onSuccess: (data, ep) => {
      setError(null);
      setLocalMediaUrl(null);
      setPreviewEpIndex(ep.index);
      setPreviewUrl(data.playUrl);
    },
    onError: (e: Error) => setError(e.message),
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
        mode: "online",
      });
    },
    onError: (e: Error) => setError(e.message),
  });

  const transferMut = useMutation({
    mutationFn: (args: { target: TransferTarget; status: "LIVE" | "DRAFT" }) => {
      if (!probe) throw new Error(t("ytdlpNeedProbe"));
      if (!categorySlug) throw new Error(t("onlineNeedCategory"));
      const max = maxEpisodes.trim() ? Number(maxEpisodes) : undefined;
      return adminYtdlpTransfer({
        url: url.trim(),
        categorySlug,
        target: args.target,
        titleZh: probe.title,
        status: args.status,
        maxEpisodes: max && max > 0 ? max : undefined,
        // Prefer downloadable file for transfer pipeline
        formatPreference: formatPreference === "best_hls" ? "best" : formatPreference,
      });
    },
    onSuccess: (data) => {
      setError(null);
      setResult({
        id: data.id,
        resolvedEpisodes: data.transferredEpisodes,
        failedCount: data.failedEpisodes?.length ?? 0,
        mode: "transfer",
        target: data.target,
      });
      const first = data.jobs?.[0];
      if (data.previewUrl) {
        setLocalMediaUrl(data.previewUrl);
        setPreviewUrl(null);
        setPreviewEpIndex(first?.episodeNumber ?? 1);
      } else if (first?.filename) {
        setLocalMediaUrl(`/api/v1/media/uploads/${first.filename}`);
        setPreviewUrl(null);
        setPreviewEpIndex(first.episodeNumber);
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  const configured = !!statusQ.data?.configured;
  const r2Ready = !!storageQ.data?.r2Configured;
  const ffmpegReady = storageQ.data?.ffmpegReady !== false;
  const busy =
    probeMut.isPending ||
    resolveMut.isPending ||
    importMut.isPending ||
    transferMut.isPending;

  const activePreviewSrc = localMediaUrl || previewUrl;

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
            {result.mode === "transfer"
              ? t("ytdlpTransferred", {
                  n: result.resolvedEpisodes,
                  failed: result.failedCount,
                  target: result.target === "r2" ? "R2" : t("ytdlpTargetLocal"),
                })
              : t("ytdlpImported", {
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
            setPreviewEpIndex(null);
            setPreviewUrl(null);
            setLocalMediaUrl(null);
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
        <div className="card glass-card space-y-4 p-4">
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

          <div className="space-y-2">
            <h5 className="text-body-sm font-medium">{t("ytdlpEpisodeList")}</h5>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-line/60 p-2">
              {probe.episodes.map((ep) => (
                <li
                  key={`${ep.id}-${ep.index}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1.5 text-body-sm hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-ink-muted">#{ep.index}</span> {ep.title}
                    {ep.durationSec ? (
                      <span className="ml-2 text-caption text-ink-muted">
                        {Math.floor(ep.durationSec / 60)}:
                        {String(ep.durationSec % 60).padStart(2, "0")}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => resolveMut.mutate(ep)}
                  >
                    {resolveMut.isPending && previewEpIndex === ep.index
                      ? t("loading")
                      : t("ytdlpPreviewEp")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          {activePreviewSrc ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-body-sm font-medium">
                  {t("ytdlpPreviewTitle")}
                  {previewEpIndex != null ? ` · #${previewEpIndex}` : ""}
                  {localMediaUrl ? ` · ${t("ytdlpPreviewLocal")}` : ""}
                </h5>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPreviewUrl(null);
                    setLocalMediaUrl(null);
                    setPreviewEpIndex(null);
                  }}
                >
                  {t("close")}
                </Button>
              </div>
              <StreamPreview src={activePreviewSrc} poster={probe.coverUrl} />
              {previewUrl && !localMediaUrl ? (
                <p className="break-all text-caption text-ink-muted">{previewUrl}</p>
              ) : null}
            </div>
          ) : null}

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
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line/50 pt-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => importMut.mutate("DRAFT")}
            >
              {t("importDraft")}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => importMut.mutate("LIVE")}>
              {t("importLive")}
            </Button>
            <span className="mx-1 hidden h-8 w-px bg-line/60 sm:block" aria-hidden />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !ffmpegReady}
              title={!ffmpegReady ? t("ytdlpNeedFfmpeg") : undefined}
              onClick={() => transferMut.mutate({ target: "local", status: "DRAFT" })}
            >
              {transferMut.isPending && transferMut.variables?.target === "local"
                ? t("ytdlpTransferring")
                : t("ytdlpTransferLocal")}
            </Button>
            <Button
              size="sm"
              disabled={busy || !ffmpegReady || !r2Ready}
              title={
                !r2Ready
                  ? t("ytdlpNeedR2")
                  : !ffmpegReady
                    ? t("ytdlpNeedFfmpeg")
                    : undefined
              }
              onClick={() => transferMut.mutate({ target: "r2", status: "DRAFT" })}
            >
              {transferMut.isPending && transferMut.variables?.target === "r2"
                ? t("ytdlpTransferring")
                : t("ytdlpTransferR2")}
            </Button>
          </div>
          <p className="text-caption text-ink-muted">{t("ytdlpTransferHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
