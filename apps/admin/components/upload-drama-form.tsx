"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateUploadDrama,
  adminCreateUploadDramaWithFiles,
  adminCreateEpisodeWithUpload,
  adminListCategories,
  adminStorageStatus,
} from "@velvet/api-client";
import { Badge, Button, Input, Select, cn } from "@velvet/ui";
import {
  AlertTriangle,
  ChevronDown,
  Cloud,
  HardDrive,
  LoaderCircle,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { EpisodeThumbnailField } from "@/components/episode-thumbnail-field";
import { useI18n } from "@/lib/i18n";

type Category = { slug: string; nameZh?: string; nameEn?: string };

type ProgressRow = {
  name: string;
  size: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

const ONESHOT_MAX_FILE = 200 * 1024 * 1024;
const ONESHOT_MAX_TOTAL = 1024 * 1024 * 1024;
const VIDEO_ACCEPT =
  "video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.mkv,.webm,.m4v";

function fmtSize(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileKey(f: File) {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

function mergeFiles(prev: File[], incoming: File[]) {
  const map = new Map(prev.map((f) => [fileKey(f), f]));
  for (const f of incoming) map.set(fileKey(f), f);
  return [...map.values()];
}

export function UploadDramaForm() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [titleZh, setTitleZh] = useState("");
  const [slug, setSlug] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [descriptionZh, setDescriptionZh] = useState("");
  const [isFree, setIsFree] = useState(true);
  const [priceCredits, setPriceCredits] = useState(10);
  const [freeEpisodeCount, setFreeEpisodeCount] = useState(3);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);
  const [createdLocal, setCreatedLocal] = useState(false);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [mode, setMode] = useState<"sequential" | "oneshot">("sequential");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Category[]>,
  });
  const storageQ = useQuery({
    queryKey: ["admin", "storage-status"],
    queryFn: () => adminStorageStatus(),
  });

  const totalBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);
  const maxFileBytes = useMemo(
    () => files.reduce((m, f) => Math.max(m, f.size), 0),
    [files],
  );
  const oneshotBlocked =
    files.length > 0 && (maxFileBytes > ONESHOT_MAX_FILE || totalBytes > ONESHOT_MAX_TOTAL);

  useEffect(() => {
    if (oneshotBlocked && mode === "oneshot") setMode("sequential");
  }, [oneshotBlocked, mode]);

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [files],
  );

  const doneCount = progress.filter((p) => p.status === "done").length;
  const failedCount = progress.filter((p) => p.status === "error").length;
  const uploadingRow = progress.find((p) => p.status === "uploading");
  const r2Enabled = !!storageQ.data?.r2Enabled;
  const ffmpegReady = !!storageQ.data?.ffmpegReady;

  const blockReason = useMemo(() => {
    if (storageQ.isLoading) return t("loading");
    if (!ffmpegReady) return t("uploadBlockFfmpeg");
    if (!titleZh.trim()) return t("uploadBlockTitle");
    if (!categorySlug) return t("uploadBlockCategory");
    if (!sortedFiles.length) return t("uploadBlockFiles");
    return null;
  }, [storageQ.isLoading, ffmpegReady, titleZh, categorySlug, sortedFiles.length, t]);

  function addFiles(list: File[]) {
    const videos = list.filter((f) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(f.name) || f.type.startsWith("video/"));
    if (!videos.length) return;
    setFiles((prev) => mergeFiles(prev, videos));
    setError(null);
  }

  const buildMeta = (status: "DRAFT" | "LIVE") => ({
    titleZh: titleZh.trim(),
    slug: slug.trim() || undefined,
    categorySlug,
    coverUrl: coverUrl.trim() || undefined,
    descriptionZh: descriptionZh.trim() || undefined,
    freeEpisodeCount: isFree ? sortedFiles.length : freeEpisodeCount,
    lockMode: (isFree ? "ALL_FREE" : "FREE_FIRST_N") as "ALL_FREE" | "FREE_FIRST_N",
    status,
    isFree,
    priceCredits: isFree ? 0 : priceCredits,
  });

  async function uploadSequential(
    dramaId: string,
    targets: File[],
    startIndexMap?: Map<string, number>,
  ) {
    for (let i = 0; i < targets.length; i++) {
      const file = targets[i];
      const episodeNumber =
        startIndexMap?.get(fileKey(file)) ??
        sortedFiles.findIndex((f) => fileKey(f) === fileKey(file)) + 1;
      setProgress((prev) =>
        prev.map((row) =>
          row.name === file.name && row.size === file.size
            ? { ...row, status: "uploading", error: undefined }
            : row,
        ),
      );
      try {
        await adminCreateEpisodeWithUpload(dramaId, file, {
          title: file.name.replace(/\.[^.]+$/, "") || undefined,
          episodeNumber: episodeNumber > 0 ? episodeNumber : i + 1,
          isFree,
          priceCredits: isFree ? 0 : priceCredits,
        });
        setProgress((prev) =>
          prev.map((row) =>
            row.name === file.name && row.size === file.size
              ? { ...row, status: "done" }
              : row,
          ),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setProgress((prev) =>
          prev.map((row) =>
            row.name === file.name && row.size === file.size
              ? { ...row, status: "error", error: message }
              : row,
          ),
        );
        throw Object.assign(e instanceof Error ? e : new Error(message), {
          dramaId,
          partial: true,
        });
      }
    }
  }

  const uploadMut = useMutation({
    mutationFn: async (status: "DRAFT" | "LIVE") => {
      if (!ffmpegReady) throw new Error(t("uploadBlockFfmpeg"));
      if (!titleZh.trim()) throw new Error(t("uploadBlockTitle"));
      if (!categorySlug) throw new Error(t("uploadBlockCategory"));
      if (!sortedFiles.length) throw new Error(t("uploadBlockFiles"));

      const meta = buildMeta(status);
      const effectiveMode = oneshotBlocked ? "sequential" : mode;

      if (effectiveMode === "oneshot") {
        setProgress(
          sortedFiles.map((f) => ({
            name: f.name,
            size: f.size,
            status: "uploading" as const,
          })),
        );
        const res = await adminCreateUploadDramaWithFiles(sortedFiles, meta);
        setProgress(
          sortedFiles.map((f) => ({
            name: f.name,
            size: f.size,
            status: "done" as const,
          })),
        );
        return { ...res, localOnly: !r2Enabled };
      }

      const drama = await adminCreateUploadDrama(meta);
      setCreatedId(drama.id);
      setProgress(
        sortedFiles.map((f) => ({
          name: f.name,
          size: f.size,
          status: "pending" as const,
        })),
      );
      try {
        await uploadSequential(drama.id, sortedFiles);
      } catch (e: any) {
        setCreatedId(drama.id);
        throw e;
      }
      return {
        ...drama,
        totalEpisodes: sortedFiles.length,
        localOnly: !r2Enabled,
      };
    },
    onSuccess: async (data) => {
      setError(null);
      setCreatedId(data.id);
      setCreatedCount(data.totalEpisodes);
      setCreatedLocal(!!(data as { localOnly?: boolean }).localOnly);
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
      await qc.invalidateQueries({ queryKey: ["admin", "drama", data.id] });
      await qc.invalidateQueries({ queryKey: ["admin", "drama-storage", data.id] });
    },
    onError: (e: Error & { dramaId?: string }) => {
      setError(e.message);
      if (e.dramaId) setCreatedId(e.dramaId);
    },
  });

  const retryMut = useMutation({
    mutationFn: async () => {
      if (!createdId) throw new Error(t("uploadBlockFiles"));
      const failed = sortedFiles.filter((f) =>
        progress.some(
          (p) => p.name === f.name && p.size === f.size && p.status === "error",
        ),
      );
      if (!failed.length) return { id: createdId, totalEpisodes: doneCount };
      const indexMap = new Map(
        sortedFiles.map((f, i) => [fileKey(f), i + 1] as const),
      );
      await uploadSequential(createdId, failed, indexMap);
      return { id: createdId, totalEpisodes: sortedFiles.length };
    },
    onSuccess: async (data) => {
      setError(null);
      setCreatedCount(data.totalEpisodes);
      await qc.invalidateQueries({ queryKey: ["admin", "drama", data.id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const busy = uploadMut.isPending || retryMut.isPending;
  const canSubmit = !blockReason && !busy;
  const progressPct =
    progress.length > 0 ? Math.round((doneCount / progress.length) * 100) : 0;

  return (
    <div className="upload-drama">
      {error ? (
        <div className="content-inline-error mb-4">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      ) : null}

      {createdId ? (
        <div className="upload-panel mb-4 flex flex-wrap items-center gap-3 !py-3">
          <span className="text-sm text-ink">
            {createdLocal
              ? t("uploadDramaCreatedLocal", { n: createdCount || doneCount })
              : t("uploadDramaCreated", { n: createdCount || doneCount })}
          </span>
          <Link href={`/content/${createdId}`} className="text-sm font-medium text-brand hover:underline">
            {t("onlineViewDrama")}
          </Link>
          {failedCount > 0 ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => retryMut.mutate()}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {t("uploadRetryFailed")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="upload-layout">
        <div className="upload-col">
          <section className="upload-panel">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadSectionInfo")}</h2>
                <p>{t("uploadSectionInfoHint")}</p>
              </div>
            </div>

            <div className="grid gap-3.5 md:grid-cols-2">
              <label className="upload-field">
                <span>{t("onlineTitleZh")}</span>
                <Input value={titleZh} onChange={(e) => setTitleZh(e.target.value)} disabled={busy} />
              </label>
              <label className="upload-field">
                <span>{t("onlineCategory")}</span>
                <Select
                  value={categorySlug}
                  onChange={(e) => setCategorySlug(e.target.value)}
                  disabled={busy}
                >
                  <option value="">{t("selectCategory")}</option>
                  {(categoriesQ.data ?? []).map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.nameZh || c.nameEn || c.slug}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="upload-field md:col-span-2">
                <span>{t("onlineDescZh")}</span>
                <textarea
                  className="content-textarea"
                  rows={4}
                  value={descriptionZh}
                  onChange={(e) => setDescriptionZh(e.target.value)}
                  disabled={busy}
                />
              </label>
            </div>

            <div className="mt-3.5 border-t border-line pt-3">
              <button
                type="button"
                className="upload-advanced-toggle"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                <ChevronDown className={cn("h-4 w-4 transition", advancedOpen && "rotate-180")} />
                {t("uploadAdvancedOptions")}
              </button>
              {advancedOpen ? (
                <label className="upload-field mt-3 max-w-md">
                  <span>{t("onlineSlug")}</span>
                  <Input value={slug} onChange={(e) => setSlug(e.target.value)} disabled={busy} />
                </label>
              ) : null}
            </div>
          </section>

          <section className="upload-panel">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadVideosTitle")}</h2>
                <p>{t("uploadVideosHint")}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {files.length ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setFiles([]); setProgress([]); }}>
                    {t("uploadClearFiles")}
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  {t("selectVideoFile")}
                </Button>
              </div>
            </div>

            <div className="space-y-3.5">

        <input
          ref={fileRef}
          type="file"
          multiple
          accept={VIDEO_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const list = Array.from(e.target.files || []);
            e.target.value = "";
            addFiles(list);
          }}
        />

        <div
          className={cn("upload-dropzone", dragOver && "is-active", busy && "is-disabled")}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (busy) return;
            addFiles(Array.from(e.dataTransfer.files || []));
          }}
          onClick={() => !busy && fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
        >
          <Upload className="h-6 w-6 text-ink-subtle" />
          <p className="text-sm font-medium text-ink">
            {dragOver ? t("uploadDropActive") : t("uploadNoFiles")}
          </p>
          <p className="text-xs text-ink-subtle">{t("uploadFilesSummary", { n: sortedFiles.length, size: fmtSize(totalBytes) })}</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-ink-muted">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="upload-mode"
              checked={mode === "sequential"}
              disabled={busy}
              onChange={() => setMode("sequential")}
            />
            {t("uploadModeSequential")}
          </label>
          <label className={cn("flex items-center gap-2", oneshotBlocked && "opacity-50")}>
            <input
              type="radio"
              name="upload-mode"
              checked={mode === "oneshot"}
              disabled={busy || oneshotBlocked}
              onChange={() => setMode("oneshot")}
            />
            {t("uploadModeOneshot")}
          </label>
          {oneshotBlocked ? (
            <span className="text-xs text-warning">{t("uploadModeOneshotDisabled")}</span>
          ) : null}
        </div>

        {sortedFiles.length ? (
          <ul className="space-y-1.5">
            {sortedFiles.map((f, i) => {
              const row = progress.find((p) => p.name === f.name && p.size === f.size);
              return (
                <li key={fileKey(f)} className="upload-file-row">
                  <span className="upload-file-row__index">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{f.name}</span>
                  <span className="text-xs tabular-nums text-ink-subtle">{fmtSize(f.size)}</span>
                  {row ? (
                    <Badge
                      tone={
                        row.status === "done"
                          ? "success"
                          : row.status === "error"
                            ? "danger"
                            : row.status === "uploading"
                              ? "warning"
                              : "default"
                      }
                    >
                      {row.status === "uploading"
                        ? t("uploadingVideo")
                        : row.status === "done"
                          ? t("uploadQueued")
                          : row.status === "error"
                            ? row.error || "error"
                            : "…"}
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="!h-7 !w-7 !p-0 !text-danger"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFiles((prev) => prev.filter((x) => fileKey(x) !== fileKey(f)));
                      setProgress((prev) =>
                        prev.filter((p) => !(p.name === f.name && p.size === f.size)),
                      );
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {progress.length > 0 ? (
          <div className="upload-progress">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>{t("uploadProgressLabel", { done: doneCount, total: progress.length })}</span>
              {uploadingRow ? (
                <span className="truncate">{t("uploadProgressCurrent", { name: uploadingRow.name })}</span>
              ) : null}
            </div>
            <div className="upload-progress__track">
              <div className="upload-progress__bar" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        ) : null}
            </div>
          </section>
        </div>

        <aside className="upload-col upload-col--side">
          <section className="upload-panel">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadSectionCover")}</h2>
                <p>{t("coverRecommendation")}</p>
              </div>
            </div>
            <EpisodeThumbnailField
              url={coverUrl || undefined}
              kind="cover"
              size="poster"
              disabled={busy}
              videoFile={sortedFiles[0]}
              fromVideoLabel={t("thumbFromVideo")}
              uploadLabel={t("thumbUpload")}
              onError={setError}
              onUploaded={(url) => {
                setCoverUrl(url);
                setError(null);
              }}
            />
            <label className="upload-field mt-3">
              <span>{t("onlineCoverUrl")}</span>
              <Input
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="/api/v1/media/… 或 CDN URL"
                disabled={busy}
              />
            </label>
          </section>

          <section className="upload-panel">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadSectionPolicy")}</h2>
                <p>{t("uploadSectionPolicyHint")}</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input
                className="content-checkbox"
                type="checkbox"
                checked={isFree}
                disabled={busy}
                onChange={(e) => setIsFree(e.target.checked)}
              />
              {t("free")}
            </label>
            {!isFree ? (
              <div className="mt-3.5 grid gap-3">
                <label className="upload-field">
                  <span>{t("priceCreditsPerEpisode")}</span>
                  <Input
                    type="number"
                    min={1}
                    value={priceCredits}
                    disabled={busy}
                    onChange={(e) => setPriceCredits(Number(e.target.value) || 0)}
                  />
                </label>
                <label className="upload-field">
                  <span>{t("freeEpisodes")}</span>
                  <Input
                    type="number"
                    min={0}
                    value={freeEpisodeCount}
                    disabled={busy}
                    onChange={(e) => setFreeEpisodeCount(Number(e.target.value) || 0)}
                  />
                </label>
              </div>
            ) : null}
          </section>

          <section className="upload-panel">
            <div className="upload-panel__head !mb-3">
              <div>
                <h2>{t("uploadEnvTitle")}</h2>
              </div>
            </div>
            <div className="upload-env">
              <div className="upload-env__row">
                <span className="upload-env__label">{t("uploadEnvStorage")}</span>
                <span className={cn("upload-status-pill", r2Enabled ? "is-ok" : "is-muted")}>
                  {r2Enabled ? <Cloud className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}
                  {r2Enabled ? t("uploadR2CdnNote") : t("uploadR2LocalNote")}
                </span>
              </div>
              <div className="upload-env__row">
                <span className="upload-env__label">ffmpeg</span>
                <span className={cn("upload-status-pill", ffmpegReady ? "is-ok" : "is-warn")}>
                  {ffmpegReady ? t("ffmpegReady") : t("ffmpegMissing")}
                </span>
              </div>
              {storageQ.data?.mediaBucket ? (
                <div className="upload-env__row">
                  <span className="upload-env__label">Bucket</span>
                  <span className="upload-status-pill is-muted">
                    {storageQ.data.storageBackend} · {storageQ.data.mediaBucket}
                  </span>
                </div>
              ) : null}
              {!r2Enabled && !storageQ.isLoading ? (
                <p className="upload-status-note">{t("uploadR2NotEnabledHint")}</p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      <div className="upload-submit-bar">
        <p className="min-w-0 flex-1 text-xs text-ink-subtle">
          {blockReason || (!r2Enabled ? t("uploadR2LocalNote") : t("uploadR2CdnNote"))}
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canSubmit || busy}
          onClick={() => uploadMut.mutate("DRAFT")}
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {t("uploadSubmitDraft")}
        </Button>
        <Button size="sm" disabled={!canSubmit || busy} onClick={() => uploadMut.mutate("LIVE")}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {t("uploadSubmitLive")}
        </Button>
      </div>
    </div>
  );
}
