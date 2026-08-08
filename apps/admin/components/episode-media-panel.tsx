"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminCreateEpisodeWithUploadSmart,
  adminDramaStorage,
  adminStorageStatus,
  adminTranscodeJob,
  adminUploadEpisodeVideoSmart,
} from "@velvet/api-client";
import { Badge, Button, cn } from "@velvet/ui";
import { Cloud, HardDrive, LoaderCircle, RefreshCw, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { VIDEO_ACCEPT } from "@/lib/video-formats";
import { GlassModal } from "@/components/glass-modal";
import {
  WatermarkPositionEditor,
  DEFAULT_PLACEMENT,
  type WatermarkPlacement,
} from "@/components/watermark-position-editor";

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function mediaKind(url?: string | null): "cdn" | "local" | "external" | "empty" {
  if (!url?.trim()) return "empty";
  const u = url.trim();
  if (/cdn\.velvetmovie\.space|\.r2\.dev|r2\.cloudflarestorage/i.test(u)) return "cdn";
  if (/^https?:\/\//i.test(u)) return "external";
  return "local";
}

async function firstFrameFromFile(file: File): Promise<{
  url: string;
  width: number;
  height: number;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("failed to load video for first frame"));
    });
    try {
      video.currentTime = Math.min(0.05, (video.duration || 1) * 0.01);
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        video.onseeked = done;
        window.setTimeout(done, 800);
      });
    } catch {
      /* use frame 0 */
    }
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(video, 0, 0, width, height);
    return {
      url: canvas.toDataURL("image/jpeg", 0.86),
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function EpisodeVideoUploadButton({
  episodeId,
  disabled,
  onDone,
  onError,
  label,
}: {
  episodeId: string;
  disabled?: boolean;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [frame, setFrame] = useState<{ url: string; width: number; height: number } | null>(null);
  const [frameBusy, setFrameBusy] = useState(false);
  const [placement, setPlacement] = useState<WatermarkPlacement>(DEFAULT_PLACEMENT);
  const { t } = useI18n();
  const storageQ = useQuery({
    queryKey: ["admin", "storage-status"],
    queryFn: () => adminStorageStatus(),
    staleTime: 60_000,
  });
  const preferDirect =
    !!storageQ.data?.r2DirectUpload || !!storageQ.data?.r2Configured;

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const job = await adminTranscodeJob(jobId);
        if (cancelled) return;
        if (job.status === "completed" || job.status === "failed") {
          setJobId(null);
          setBusy(false);
          if (job.status === "failed") onError(job.error || t("transcoding"));
          await onDone();
          return;
        }
        window.setTimeout(tick, 2500);
      } catch {
        if (!cancelled) {
          setJobId(null);
          setBusy(false);
          await onDone();
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [jobId, onDone, onError, t]);

  function closeWatermarkModal() {
    setPendingFile(null);
    setFrame(null);
    setPlacement(DEFAULT_PLACEMENT);
    setFrameBusy(false);
  }

  async function confirmUpload() {
    if (!pendingFile || busy) return;
    const file = pendingFile;
    const wm = { ...placement };
    closeWatermarkModal();
    setBusy(true);
    try {
      const res = await adminUploadEpisodeVideoSmart(episodeId, file, {
        preferDirect,
        watermarkEnabled: wm.enabled,
        watermarkX: wm.x,
        watermarkY: wm.y,
        watermarkScale: wm.scale,
      });
      if (res.jobId) {
        setJobId(res.jobId);
        await onDone();
      } else {
        setBusy(false);
        await onDone();
      }
    } catch (err) {
      setBusy(false);
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="!h-8 !w-8 !p-0"
        title={label}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setPendingFile(file);
          setPlacement(DEFAULT_PLACEMENT);
          setFrame(null);
          setFrameBusy(true);
          void firstFrameFromFile(file)
            .then(setFrame)
            .catch(() => setFrame(null))
            .finally(() => setFrameBusy(false));
        }}
      />
      <GlassModal open={!!pendingFile} onClose={closeWatermarkModal} title={label} size="lg">
        <div className="space-y-4">
          {pendingFile ? (
            <p className="truncate text-caption text-ink-muted">{pendingFile.name}</p>
          ) : null}
          {frameBusy ? (
            <p className="text-caption text-ink-muted">{t("watermarkLoadingFrame")}</p>
          ) : null}
          <WatermarkPositionEditor
            frameUrl={frame?.url || null}
            frameWidth={frame?.width}
            frameHeight={frame?.height}
            value={placement}
            busy={frameBusy}
            onChange={setPlacement}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={closeWatermarkModal}>
              {t("cancel")}
            </Button>
            <Button size="sm" disabled={!pendingFile} onClick={() => void confirmUpload()}>
              {t("uploadVideo")}
            </Button>
          </div>
        </div>
      </GlassModal>
    </>
  );
}

export function DramaStoragePanel({
  dramaId,
  onPurge,
}: {
  dramaId: string;
  onPurge: (episodeId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["admin", "drama-storage", dramaId],
    queryFn: () => adminDramaStorage(dramaId),
    refetchInterval: 15_000,
  });

  const data = q.data;
  const totalObjects = data?.episodes.reduce((s, e) => s + e.objectCount, 0) ?? 0;
  const totalBytes = data?.episodes.reduce((s, e) => s + e.totalBytes, 0) ?? 0;

  return (
    <section className="content-section-card space-y-4">
      <div className="content-section-heading">
        <div>
          <h2>{t("mediaStorage")}</h2>
          <p>{t("mediaStorageHint")}</p>
        </div>
        <Button size="sm" variant="ghost" disabled={q.isFetching} onClick={() => void q.refetch()}>
          {q.isFetching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t("refreshStorage")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone={data?.r2Enabled ? "success" : "default"}>
          {data?.r2Enabled ? <Cloud className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}
          {data?.r2Enabled ? t("r2Enabled") : t("r2Disabled")}
        </Badge>
        <Badge tone={data?.ffmpegReady ? "success" : "warning"}>
          {data?.ffmpegReady ? t("ffmpegReady") : t("ffmpegMissing")}
        </Badge>
        <Badge tone="default">
          {t("storageBackend")}: {data?.storageBackend || "—"}
        </Badge>
        <Badge tone="default">
          {t("r2Objects")}: {totalObjects} · {fmtBytes(totalBytes)}
        </Badge>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      ) : null}

      <div className="space-y-2">
        {(data?.episodes ?? []).map((ep) => {
          const kind = mediaKind(ep.hlsUrl || ep.originalUrl);
          return (
            <div
              key={ep.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5"
            >
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-surface px-2 text-xs font-semibold">
                {ep.episodeNumber}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{ep.title || `EP ${ep.episodeNumber}`}</p>
                <p className="truncate text-[11px] text-ink-subtle">
                  {ep.r2Prefix || ep.hlsUrl || ep.originalUrl || t("noR2Objects")}
                </p>
              </div>
              <Badge
                tone={
                  ep.transcodeStatus === "FAILED"
                    ? "danger"
                    : ep.transcodeStatus === "COMPLETED" || ep.transcodeStatus === "READY"
                      ? "success"
                      : "warning"
                }
              >
                {ep.transcodeStatus || "—"}
              </Badge>
              <Badge tone={kind === "cdn" ? "success" : kind === "local" ? "warning" : "default"}>
                {kind === "cdn"
                  ? t("mediaCdn")
                  : kind === "local"
                    ? t("mediaLocal")
                    : kind === "external"
                      ? t("mediaExternal")
                      : "—"}
              </Badge>
              <span className="text-xs tabular-nums text-ink-muted">
                {ep.objectCount} · {fmtBytes(ep.totalBytes)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="!h-8 !text-danger"
                disabled={!ep.hlsUrl && !ep.originalUrl}
                title={t("purgeMedia")}
                onClick={() => void onPurge(ep.id)}
              >
                <Trash2 className="h-4 w-4" />
                {t("purgeMedia")}
              </Button>
            </div>
          );
        })}
        {!q.isLoading && !(data?.episodes?.length) ? (
          <p className="text-sm text-ink-muted">{t("emptyEpisodes")}</p>
        ) : null}
      </div>
    </section>
  );
}

export function NewEpisodeUploadForm({
  dramaId,
  title,
  isFree,
  priceCredits,
  thumbnailUrl,
  disabled,
  onDone,
  onError,
}: {
  dramaId: string;
  title: string;
  isFree: boolean;
  priceCredits: number;
  thumbnailUrl?: string;
  disabled?: boolean;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const storageQ = useQuery({
    queryKey: ["admin", "storage-status"],
    queryFn: () => adminStorageStatus(),
    staleTime: 60_000,
  });
  const preferDirect =
    !!storageQ.data?.r2DirectUpload || !!storageQ.data?.r2Configured;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? t("uploadingVideo") : t("addEpisodeByUpload")}
      </Button>
      {fileName ? <span className="text-xs text-ink-subtle truncate max-w-[16rem]">{fileName}</span> : null}
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setFileName(file.name);
          setBusy(true);
          void (async () => {
            try {
              await adminCreateEpisodeWithUploadSmart(dramaId, file, {
                title: title || undefined,
                isFree,
                priceCredits: isFree ? 0 : priceCredits,
                thumbnailUrl: thumbnailUrl || undefined,
                preferDirect,
              });
              setFileName("");
              await onDone();
            } catch (err) {
              onError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
      <p className={cn("w-full text-xs leading-5 text-ink-subtle")}>{t("uploadVideoHint")}</p>
    </div>
  );
}
