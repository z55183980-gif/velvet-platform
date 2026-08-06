"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  adminListCategories,
  adminStorageStatus,
  adminYtdlpImport,
  adminYtdlpProbe,
  adminYtdlpResolve,
  adminYtdlpStatus,
  adminYtdlpTransfer,
  adminYtdlpTransferJob,
  type YtdlpTransferJob,
} from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { StreamPreview } from "@/components/stream-preview";
import { contentDetailHref } from "@/lib/content-href";
import { useI18n } from "@/lib/i18n";

type Category = { slug: string; nameZh?: string; nameEn?: string };
type ProbeResult = Awaited<ReturnType<typeof adminYtdlpProbe>>;
type FormatPreference = "best_hls" | "best_mp4" | "best";
type TransferTarget = "local" | "r2";
type EpisodeFailure = { episodeNumber: number; url: string; error: string };
/** import = 链接直播；transfer = 转存本地托管 */
export type YtdlpPanelMode = "import" | "transfer";

export function YtdlpImportPanel({ mode }: { mode: YtdlpPanelMode }) {
  const { t } = useI18n();
  const router = useRouter();
  const showImport = mode === "import";
  const showTransfer = mode === "transfer";
  const [url, setUrl] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [categorySlug, setCategorySlug] = useState("");
  const [maxEpisodes, setMaxEpisodes] = useState("");
  const [formatPreference, setFormatPreference] = useState<FormatPreference>(
    mode === "transfer" ? "best" : "best_hls",
  );
  const [error, setError] = useState<string | null>(null);
  const [engineOpen, setEngineOpen] = useState(false);
  const [previewEpIndex, setPreviewEpIndex] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localMediaUrl, setLocalMediaUrl] = useState<string | null>(null);
  const [failedEpisodes, setFailedEpisodes] = useState<EpisodeFailure[]>([]);
  const [transferProgress, setTransferProgress] = useState<YtdlpTransferJob | null>(null);
  const [result, setResult] = useState<{
    id: string;
    resolvedEpisodes: number;
    failedCount: number;
    mode: "online" | "transfer";
    target?: TransferTarget;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startTransferPoll(jobId: string, target: TransferTarget) {
    stopPoll();
    const tick = async () => {
      try {
        const job = await adminYtdlpTransferJob(jobId);
        setTransferProgress(job);
        setFailedEpisodes(job.failedEpisodes ?? []);
        if (job.previewUrl) {
          setLocalMediaUrl(job.previewUrl);
          setPreviewUrl(null);
          setPreviewEpIndex(job.jobs[0]?.episodeNumber ?? 1);
        }
        if (job.status === "completed") {
          stopPoll();
          setResult({
            id: job.dramaId,
            resolvedEpisodes: job.transferred,
            failedCount: job.failedEpisodes?.length ?? 0,
            mode: "transfer",
            target,
          });
          if (!(job.failedEpisodes?.length > 0)) {
            router.push(contentDetailHref(job.dramaId, "episodes"));
          }
        } else if (job.status === "failed") {
          stopPoll();
          setError(job.error || t("ytdlpTransferFailed"));
        }
      } catch (e: unknown) {
        stopPoll();
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 2000);
  }

  const probeMut = useMutation({
    mutationFn: () => {
      const u = url.trim();
      if (!u) throw new Error(t("ytdlpNeedUrl"));
      return adminYtdlpProbe(u);
    },
    onSuccess: (data) => {
      setError(null);
      setResult(null);
      setFailedEpisodes([]);
      setTransferProgress(null);
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
    mutationFn: () => {
      if (!probe) throw new Error(t("ytdlpNeedProbe"));
      if (!categorySlug) throw new Error(t("onlineNeedCategory"));
      const max = maxEpisodes.trim() ? Number(maxEpisodes) : undefined;
      return adminYtdlpImport({
        url: url.trim(),
        categorySlug,
        titleZh: probe.title,
        maxEpisodes: max && max > 0 ? max : undefined,
        formatPreference,
      });
    },
    onSuccess: (data) => {
      setError(null);
      setFailedEpisodes(data.failedEpisodes ?? []);
      setResult({
        id: data.id,
        resolvedEpisodes: data.resolvedEpisodes,
        failedCount: data.failedEpisodes?.length ?? 0,
        mode: "online",
      });
      // Stay when partial failures so ops can read the list; otherwise go to rights check.
      if (!(data.failedEpisodes?.length > 0)) {
        router.push(contentDetailHref(data.id, "info"));
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  const transferMut = useMutation({
    mutationFn: (target: TransferTarget) => {
      if (!probe) throw new Error(t("ytdlpNeedProbe"));
      if (!categorySlug) throw new Error(t("onlineNeedCategory"));
      const max = maxEpisodes.trim() ? Number(maxEpisodes) : undefined;
      return adminYtdlpTransfer({
        url: url.trim(),
        categorySlug,
        target,
        titleZh: probe.title,
        maxEpisodes: max && max > 0 ? max : undefined,
        formatPreference: formatPreference === "best_hls" ? "best" : formatPreference,
      }).then((data) => ({ data, target }));
    },
    onSuccess: ({ data, target }) => {
      setError(null);
      setFailedEpisodes([]);
      setResult(null);
      setTransferProgress({
        id: data.jobId,
        dramaId: data.id,
        slug: data.slug,
        status: data.jobStatus,
        target: data.target,
        preferR2: data.preferR2,
        total: data.totalEpisodes,
        transferred: 0,
        currentEpisode: null,
        failedEpisodes: [],
        jobs: [],
        extractor: data.extractor,
        kind: data.kind,
        externalRef: data.externalRef,
        sourceType: data.sourceType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      startTransferPoll(data.jobId, target);
    },
    onError: (e: Error) => setError(e.message),
  });

  const configured = !!statusQ.data?.configured;
  const r2Ready = !!storageQ.data?.r2Configured;
  const ffmpegReady = storageQ.data?.ffmpegReady !== false;
  const transferring =
    !!transferProgress &&
    (transferProgress.status === "queued" || transferProgress.status === "running");
  const busy =
    probeMut.isPending ||
    resolveMut.isPending ||
    importMut.isPending ||
    transferMut.isPending ||
    transferring;

  const activePreviewSrc = localMediaUrl || previewUrl;

  const panelTitle = mode === "transfer" ? t("ytdlpTransferTitle") : t("ytdlpImportTitle");
  const panelHint = mode === "transfer" ? t("ytdlpTransferPanelHint") : t("ytdlpImportOnlyHint");

  const progressPct =
    transferProgress && transferProgress.total > 0
      ? Math.min(
          100,
          Math.round(
            ((transferProgress.transferred + (transferProgress.failedEpisodes?.length ?? 0)) /
              transferProgress.total) *
              100,
          ),
        )
      : 0;

  return (
    <div className="space-y-4">
      <div className="upload-panel space-y-2">
        <h3 className="text-h4 font-semibold">{panelTitle}</h3>
        <p className="text-body-sm text-ink-muted">{panelHint}</p>
        {!configured ? (
          <p className="text-body-sm text-danger">
            {t("ytdlpNotConfigured")}
            {statusQ.data?.lastError ? ` (${statusQ.data.lastError})` : ""}
          </p>
        ) : (
          <div className="text-caption text-ink-muted">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-line/60 bg-surface-2/40 px-2 py-1 hover:bg-surface-2"
              onClick={() => setEngineOpen((v) => !v)}
              aria-expanded={engineOpen}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-success)" }}
                aria-hidden
              />
              {t("ytdlpEngineReady")}
              <span className="text-ink-subtle">{engineOpen ? "▾" : "▸"}</span>
            </button>
            {engineOpen ? (
              <p className="mt-1.5 break-all">
                {t("ytdlpProvider")}: {statusQ.data?.provider}
                {statusQ.data?.version ? ` ${statusQ.data.version}` : ""}
                {statusQ.data?.binSource ? ` · ${t("ytdlpBinSource")}: ${statusQ.data.binSource}` : ""}
                {statusQ.data?.bin ? ` · ${statusQ.data.bin}` : ""}
                {" · "}
                {t("ytdlpNoApiKey")}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {error ? <p className="text-body-sm text-danger">{error}</p> : null}

      {transferProgress && (transferring || transferProgress.status === "failed") ? (
        <div className="upload-panel space-y-2 text-body-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {transferring ? t("ytdlpTransferProgress") : t("ytdlpTransferFailed")}
            </span>
            <span className="text-caption text-ink-muted">
              {t("ytdlpTransferProgressCount", {
                done: transferProgress.transferred,
                total: transferProgress.total,
                failed: transferProgress.failedEpisodes?.length ?? 0,
              })}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {transferProgress.currentEpisode != null && transferring ? (
            <p className="text-caption text-ink-muted">
              {t("ytdlpTransferCurrentEp", { n: transferProgress.currentEpisode })}
            </p>
          ) : null}
          {transferring ? (
            <p className="text-caption text-ink-muted">{t("ytdlpTransferAsyncHint")}</p>
          ) : null}
          {transferProgress.dramaId ? (
            <Link
              href={contentDetailHref(transferProgress.dramaId, "episodes")}
              className="text-brand hover:underline"
            >
              {t("onlineViewDrama")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="upload-panel flex flex-wrap items-center gap-3 text-body-sm">
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
          <Link
            href={contentDetailHref(result.id, result.mode === "transfer" ? "episodes" : "info")}
            className="text-brand hover:underline"
          >
            {t("onlineViewDrama")}
          </Link>
        </div>
      ) : null}

      {failedEpisodes.length > 0 ? (
        <div className="upload-panel space-y-2">
          <h5 className="text-body-sm font-medium text-danger">
            {t("ytdlpFailedList", { n: failedEpisodes.length })}
          </h5>
          <ul className="max-h-36 space-y-1 overflow-y-auto text-caption text-ink-muted">
            {failedEpisodes.map((ep) => (
              <li key={`${ep.episodeNumber}-${ep.url}`} className="break-all">
                #{ep.episodeNumber}: {ep.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="min-w-[20rem] flex-1"
          placeholder={t("ytdlpUrlPlaceholder")}
          value={url}
          disabled={!configured || transferring}
          onChange={(e) => {
            setUrl(e.target.value);
            setProbe(null);
            setResult(null);
            setFailedEpisodes([]);
            setPreviewEpIndex(null);
            setPreviewUrl(null);
            setLocalMediaUrl(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && configured && url.trim() && !transferring) probeMut.mutate();
          }}
        />
        <Button
          size="sm"
          disabled={!configured || !url.trim() || probeMut.isPending || transferring}
          onClick={() => probeMut.mutate()}
        >
          {probeMut.isPending ? t("loading") : t("ytdlpProbe")}
        </Button>
      </div>

      {probe ? (
        <div className="upload-panel space-y-4">
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
              {previewUrl && !localMediaUrl ? (
                <p className="text-caption text-ink-muted">{t("ytdlpPreviewCorsHint")}</p>
              ) : null}
              <StreamPreview
                src={activePreviewSrc}
                poster={probe.coverUrl}
                failHint={
                  previewUrl && !localMediaUrl ? t("ytdlpPreviewCorsFail") : t("ytdlpPreviewLocalFail")
                }
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-caption text-ink-muted">
              {t("onlineCategory")}
              <Select
                className="mt-1 w-48"
                value={categorySlug}
                disabled={transferring}
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
                disabled={transferring}
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
                disabled={transferring}
                onChange={(e) => setMaxEpisodes(e.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line/50 pt-3">
            {showImport ? (
              <Button size="sm" disabled={busy} onClick={() => importMut.mutate()}>
                {importMut.isPending ? t("loading") : t("importDraft")}
              </Button>
            ) : null}
            {showTransfer ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !ffmpegReady}
                  title={!ffmpegReady ? t("ytdlpNeedFfmpeg") : undefined}
                  onClick={() => transferMut.mutate("local")}
                >
                  {transferMut.isPending && transferMut.variables === "local"
                    ? t("ytdlpTransferring")
                    : transferring && transferProgress?.target === "local"
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
                  onClick={() => transferMut.mutate("r2")}
                >
                  {transferMut.isPending && transferMut.variables === "r2"
                    ? t("ytdlpTransferring")
                    : transferring && transferProgress?.target === "r2"
                      ? t("ytdlpTransferring")
                      : t("ytdlpTransferR2")}
                </Button>
              </>
            ) : null}
          </div>
          {showImport ? (
            <p className="text-caption text-ink-muted">{t("ytdlpImportComplianceHint")}</p>
          ) : null}
          {showTransfer ? <p className="text-caption text-ink-muted">{t("ytdlpTransferHint")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
