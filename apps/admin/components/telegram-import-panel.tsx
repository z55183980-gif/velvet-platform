"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  adminStorageStatus,
  adminTelegramProbe,
  adminTelegramStatus,
  adminTelegramThumb,
} from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { GlassModal } from "@/components/glass-modal";
import {
  dramaInfoFromYtdlpProbe,
  type DramaInfoFillPayload,
} from "@/lib/drama-info-fill";
import { useI18n } from "@/lib/i18n";

type ProbeData = Awaited<ReturnType<typeof adminTelegramProbe>>;
type EpisodeRow = ProbeData["episodes"][number];

/** Persist thumbs across remounts / re-probes of the same message. */
const thumbCache = new Map<string, string>();

function thumbCacheKey(channel: string, messageId: number) {
  return `${channel.toLowerCase()}:${messageId}`;
}

export function parseTelegramInput(raw: string): {
  channel: string;
  messageId?: number;
} | null {
  const text = raw.trim();
  if (!text) return null;
  const post = text.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)\/(\d+)/i,
  );
  if (post) return { channel: post[1], messageId: Number(post[2]) };
  const ch = text.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)\/?/i,
  );
  if (ch) return { channel: ch[1] };
  if (/^[A-Za-z0-9_]+$/.test(text) && !text.includes(".")) {
    return { channel: text };
  }
  return null;
}

export function isLikelyTelegramUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return /(?:^|\/\/)(?:t\.me|telegram\.me)\//i.test(t);
}

function formatBytes(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Telegram channel probe / apply (R2 only).
 * URL is owned by the parent parse field — this panel only shows TG actions + results.
 */
export function TelegramImportPanel({
  url,
  onDirtyChange,
  onFillDramaInfo,
  probeRequestKey = 0,
}: {
  /** Shared URL from the online parse input (t.me / channel). */
  url: string;
  onDirtyChange?: (dirty: boolean) => void;
  onFillDramaInfo?: (payload: DramaInfoFillPayload) => void;
  /** Increment to request a probe from the parent (e.g. Enter / shared TG button). */
  probeRequestKey?: number;
} = {
  url: "",
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"recent" | "range">("recent");
  const [recentN, setRecentN] = useState("20");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [probe, setProbe] = useState<ProbeData | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [overwriteMeta, setOverwriteMeta] = useState(true);
  /** Empty = no split; when set, seconds per episode (30–600). */
  const [segmentSeconds, setSegmentSeconds] = useState("");
  const [preview, setPreview] = useState<{
    ep: EpisodeRow;
    dataUrl: string;
  } | null>(null);
  /** messageId → data URL | loading | error */
  const [thumbs, setThumbs] = useState<
    Record<number, string | "loading" | "error">
  >({});
  const lastProbeKey = useRef(0);

  const statusQ = useQuery({
    queryKey: ["admin", "telegram", "status"],
    queryFn: () => adminTelegramStatus(),
  });
  const storageQ = useQuery({
    queryKey: ["admin", "storage", "status"],
    queryFn: () => adminStorageStatus(),
  });

  const ready =
    !!statusQ.data?.enabled && !!statusQ.data?.health?.authorized;
  const r2Ready = !!storageQ.data?.r2Configured || !!statusQ.data?.r2Configured;
  const ffmpegReady = !!statusQ.data?.ffmpegReady;
  const parsed = parseTelegramInput(url);

  useEffect(() => {
    // Parent owns the shared URL dirty bit; only bump dirty when we have TG results.
    if (probe) onDirtyChange?.(true);
  }, [probe, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Sync range fields when URL carries a message id.
  useEffect(() => {
    if (parsed?.messageId) {
      setMode("range");
      setFromId(String(parsed.messageId));
      setToId(String(parsed.messageId));
    }
  }, [parsed?.messageId]);

  // Clear results when leaving TG / emptying URL.
  useEffect(() => {
    if (!parsed?.channel) {
      setProbe(null);
      setPreview(null);
      setError(null);
      setApplied(false);
    }
  }, [parsed?.channel, url]);

  useEffect(() => {
    if (!probe?.episodes?.length) {
      setSelectedIndexes([]);
      return;
    }
    setSelectedIndexes(probe.episodes.map((ep) => ep.index));
  }, [probe]);

  const itemsByMessageId = useMemo(() => {
    const map = new Map<number, ProbeData["items"][number]>();
    for (const it of probe?.items || []) map.set(it.messageId, it);
    return map;
  }, [probe]);

  const selectedCount = selectedIndexes.length;
  const busy = statusQ.isFetching;

  const segmentSecNum = useMemo(() => {
    const n = Math.floor(Number(segmentSeconds));
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
  }, [segmentSeconds]);

  const estimatedEpisodes = useMemo(() => {
    if (!probe?.episodes?.length || !selectedIndexes.length) return null;
    const selected = probe.episodes.filter((ep) =>
      selectedIndexes.includes(ep.index),
    );
    if (!segmentSecNum || segmentSecNum < 30) return selected.length;
    return selected.reduce((sum, ep) => {
      const d = ep.durationSec;
      if (typeof d === "number" && d > 0) {
        return sum + Math.max(1, Math.ceil(d / segmentSecNum));
      }
      return sum + 1;
    }, 0);
  }, [probe, selectedIndexes, segmentSecNum]);

  const probeMut = useMutation({
    mutationFn: async () => {
      if (!parsed?.channel) throw new Error(t("telegramNeedUrl"));
      if (!ready) throw new Error(t("telegramNotReady"));
      let from = fromId.trim() ? Number(fromId) : undefined;
      let to = toId.trim() ? Number(toId) : undefined;
      if (mode === "range" && parsed.messageId && from == null && to == null) {
        from = parsed.messageId;
        to = parsed.messageId;
      }
      const n = Math.max(1, Math.min(500, Number(recentN) || 20));
      return adminTelegramProbe({
        channel: parsed.channel,
        mode,
        recentN: mode === "recent" ? n : undefined,
        fromId: mode === "range" ? from : undefined,
        toId: mode === "range" ? to : undefined,
        mediaOnly: true,
      });
    },
    onSuccess: (data) => {
      setError(null);
      setApplied(false);
      setPreview(null);
      setProbe(data);
    },
    onError: (e: Error) => {
      setApplied(false);
      setError(e.message);
    },
  });

  useEffect(() => {
    if (!probeRequestKey || probeRequestKey === lastProbeKey.current) return;
    lastProbeKey.current = probeRequestKey;
    if (parsed?.channel && ready && !probeMut.isPending) {
      probeMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only on key bumps
  }, [probeRequestKey]);

  const probeEpisodeKey = probe
    ? `${probe.channel}:${probe.episodes.map((e) => e.messageId).join(",")}`
    : "";

  // Auto-load thumbs for card grid (cache + serial fetch; avoid flood / remount races).
  useEffect(() => {
    if (!probe?.channel || !probe.episodes.length) {
      return;
    }
    let cancelled = false;
    const channel = probe.channel;
    const ids = probe.episodes.map((e) => e.messageId);

    setThumbs((prev) => {
      const next: Record<number, string | "loading" | "error"> = { ...prev };
      for (const id of ids) {
        const hit = thumbCache.get(thumbCacheKey(channel, id));
        if (hit) next[id] = hit;
        else if (typeof next[id] !== "string") next[id] = "loading";
      }
      return next;
    });

    const pending = ids.filter(
      (id) => !thumbCache.has(thumbCacheKey(channel, id)),
    );

    async function run() {
      for (const messageId of pending) {
        if (cancelled) return;
        let attempt = 0;
        while (attempt < 2 && !cancelled) {
          attempt += 1;
          try {
            const data = await adminTelegramThumb({ channel, messageId });
            if (cancelled) return;
            const dataUrl = `data:${data.contentType};base64,${data.base64}`;
            thumbCache.set(thumbCacheKey(channel, messageId), dataUrl);
            setThumbs((prev) => ({ ...prev, [messageId]: dataUrl }));
            break;
          } catch {
            if (cancelled) return;
            if (attempt >= 2) {
              setThumbs((prev) => ({ ...prev, [messageId]: "error" }));
            } else {
              await new Promise((r) => setTimeout(r, 400 * attempt));
            }
          }
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [probeEpisodeKey]);

  function toggleSelected(index: number) {
    setSelectedIndexes((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
    setApplied(false);
  }

  function applyToMain() {
    if (!probe || !onFillDramaInfo) {
      setError(t("ytdlpApplyNeedMain"));
      return;
    }
    if (!selectedIndexes.length) {
      setError(t("ytdlpResolveSelectNeed"));
      return;
    }
    const selected = probe.episodes.filter((ep) =>
      selectedIndexes.includes(ep.index),
    );
    const missing = selected.filter(
      (ep) => !(Number.isFinite(ep.messageId) && ep.messageId > 0),
    );
    if (missing.length) {
      setError(
        t("ytdlpApplyNeedDownloadUrl", {
          n: String(missing.length),
          total: String(selected.length),
        }),
      );
      return;
    }

    let segment: number | undefined;
    if (segmentSeconds.trim()) {
      const n = Math.floor(Number(segmentSeconds));
      if (!Number.isFinite(n) || n < 30 || n > 600) {
        setError(t("telegramSegmentSecondsInvalid"));
        return;
      }
      segment = n;
    }

    onFillDramaInfo(
      dramaInfoFromYtdlpProbe(
        {
          source: "telegram",
          title: probe.channel,
          channel: probe.channel,
          episodes: probe.episodes,
        },
        {
          pageUrl: url.trim() || `https://t.me/${probe.channel}`,
          ingestForm: "r2",
          provider: "telegram",
          telegramChannel: probe.channel,
          episodeIndexes: selectedIndexes,
          overwriteMeta,
          ...(segment ? { segmentSeconds: segment } : {}),
        },
      ),
    );
    setApplied(true);
    setError(null);
  }

  if (!isLikelyTelegramUrl(url) && !probe) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-lg border border-line/70 bg-surface-2/25 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-body font-medium text-ink">{t("telegramPanelTitle")}</h3>
          <p className="mt-0.5 text-caption text-ink-muted">{t("telegramPanelHint")}</p>
        </div>
        <span
          className={
            ready
              ? "rounded-full bg-success-soft px-2 py-0.5 text-caption text-success"
              : "rounded-full bg-warning/15 px-2 py-0.5 text-caption text-warning"
          }
        >
          {ready
            ? t("telegramStatusReady")
            : statusQ.data?.enabled
              ? t("telegramSessionMissing")
              : t("telegramSidecarMissing")}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={mode}
          disabled={!ready || probeMut.isPending}
          onChange={(e) =>
            setMode(e.target.value === "range" ? "range" : "recent")
          }
        >
          <option value="recent">{t("telegramModeRecent")}</option>
          <option value="range">{t("telegramModeRange")}</option>
        </Select>
        {mode === "recent" ? (
          <Input
            className="w-24"
            type="number"
            min={1}
            max={500}
            value={recentN}
            disabled={!ready || probeMut.isPending}
            title={t("telegramRecentN")}
            placeholder={t("telegramRecentN")}
            onChange={(e) => setRecentN(e.target.value)}
          />
        ) : (
          <>
            <Input
              className="w-28"
              type="number"
              min={1}
              value={fromId}
              disabled={!ready || probeMut.isPending}
              placeholder={t("telegramFromId")}
              onChange={(e) => setFromId(e.target.value)}
            />
            <Input
              className="w-28"
              type="number"
              min={1}
              value={toId}
              disabled={!ready || probeMut.isPending}
              placeholder={t("telegramToId")}
              onChange={(e) => setToId(e.target.value)}
            />
          </>
        )}
        <Button
          size="sm"
          disabled={!parsed?.channel || !ready || probeMut.isPending}
          onClick={() => probeMut.mutate()}
        >
          {probeMut.isPending
            ? t("telegramProbeBusy")
            : probe
              ? t("telegramProbeDone")
              : t("telegramProbe")}
        </Button>
      </div>

      {error ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {probe ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption text-ink-muted">
              @{probe.channel} · {t("importEpisodeCount", { n: probe.episodes.length })} ·{" "}
              {t("telegramR2OnlyHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!probe.episodes.length}
                onClick={() =>
                  setSelectedIndexes(
                    selectedCount === probe.episodes.length
                      ? []
                      : probe.episodes.map((ep) => ep.index),
                  )
                }
              >
                {selectedCount === probe.episodes.length
                  ? t("ytdlpResolveDeselectAll")
                  : t("ytdlpResolveSelectAll")}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-md border border-line/60 bg-surface/40 px-3 py-2">
            <label className="space-y-1">
              <span className="block text-caption text-ink-muted">
                {t("telegramSegmentSeconds")}
              </span>
              <Input
                className="w-28"
                type="number"
                min={30}
                max={600}
                step={1}
                value={segmentSeconds}
                placeholder="—"
                title={t("telegramSegmentSecondsHint")}
                onChange={(e) => {
                  setSegmentSeconds(e.target.value);
                  setApplied(false);
                }}
              />
            </label>
            <p className="min-w-0 flex-1 text-caption text-ink-muted">
              {t("telegramSegmentSecondsHint")}
              {estimatedEpisodes != null && selectedCount > 0 ? (
                <>
                  {" "}
                  ·{" "}
                  {segmentSecNum && segmentSecNum >= 30
                    ? t("telegramSegmentEstimate", {
                        n: String(estimatedEpisodes),
                        sec: String(segmentSecNum),
                      })
                    : t("importEpisodeCount", { n: estimatedEpisodes })}
                </>
              ) : null}
            </p>
          </div>

          <ul className="grid max-h-[40rem] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
            {probe.episodes.map((ep) => {
              const meta = itemsByMessageId.get(ep.messageId);
              const checked = selectedIndexes.includes(ep.index);
              const thumb = thumbs[ep.messageId];
              const dataUrl = typeof thumb === "string" ? thumb : null;
              const partEstimate =
                segmentSecNum &&
                segmentSecNum >= 30 &&
                typeof ep.durationSec === "number" &&
                ep.durationSec > 0
                  ? Math.max(1, Math.ceil(ep.durationSec / segmentSecNum))
                  : null;
              return (
                <li key={ep.id}>
                  <div
                    className={
                      checked
                        ? "flex h-full flex-col overflow-hidden rounded-lg border border-brand/40 bg-brand/5 shadow-sm"
                        : "flex h-full flex-col overflow-hidden rounded-lg border border-line/70 bg-white shadow-sm"
                    }
                  >
                    <div className="relative flex h-[13.5rem] items-center justify-center bg-surface-2 sm:h-[15rem]">
                      <label className="absolute left-1.5 top-1.5 z-10 flex cursor-pointer items-center rounded bg-white/90 px-1 py-0.5 shadow-sm ring-1 ring-line/40">
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={checked}
                          onChange={() => toggleSelected(ep.index)}
                          aria-label={`#${ep.index}`}
                        />
                      </label>
                      {dataUrl ? (
                        <button
                          type="button"
                          className="absolute inset-0 flex h-full w-full items-center justify-center p-1.5"
                          title={t("telegramThumbPreviewHint")}
                          onClick={() => setPreview({ ep, dataUrl })}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={dataUrl}
                            alt=""
                            className="max-h-full max-w-full object-contain"
                          />
                        </button>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-caption text-ink-muted">
                          {thumb === "error"
                            ? t("telegramThumbMissing")
                            : t("loading")}
                        </div>
                      )}
                      <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                        {formatDuration(ep.durationSec ?? meta?.duration)}
                      </span>
                    </div>
                    <div className="min-w-0 space-y-1 p-2">
                      <p className="line-clamp-2 text-body-sm font-medium text-ink">
                        <span className="text-ink-muted">#{ep.index}</span>{" "}
                        {ep.title || `msg ${ep.messageId}`}
                      </p>
                      <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-caption text-ink-muted">
                        <span>ID {ep.messageId}</span>
                        <span>{formatBytes(ep.size ?? meta?.size)}</span>
                        {partEstimate != null ? (
                          <span>
                            {t("telegramCardParts", { n: String(partEstimate) })}
                          </span>
                        ) : null}
                      </p>
                      {meta?.filename ? (
                        <p className="truncate text-caption text-ink-subtle">
                          {meta.filename}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {onFillDramaInfo ? (
            <div
              className={
                applied
                  ? "flex flex-wrap items-center gap-2 rounded-md border border-success/35 bg-success-soft px-3 py-2.5"
                  : "flex flex-wrap items-center gap-2 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2.5"
              }
            >
              <label className="flex shrink-0 items-center gap-1.5 text-caption text-ink-muted">
                <input
                  type="checkbox"
                  checked={overwriteMeta}
                  onChange={(e) => setOverwriteMeta(e.target.checked)}
                />
                <span>{t("ytdlpOverwriteMetaShort")}</span>
              </label>
              <p className="min-w-0 flex-1 text-caption text-ink-muted">
                {t("telegramR2OnlyHint")}
              </p>
              <Button
                size="sm"
                variant={applied ? "secondary" : "primary"}
                disabled={
                  selectedCount === 0 ||
                  !r2Ready ||
                  !ffmpegReady ||
                  busy ||
                  probeMut.isPending
                }
                title={
                  !r2Ready
                    ? t("ytdlpNeedR2")
                    : !ffmpegReady
                      ? t("ytdlpNeedFfmpeg")
                      : t("telegramR2OnlyHint")
                }
                onClick={() => applyToMain()}
              >
                {applied
                  ? t("ytdlpApplyToMainDone")
                  : `${t("ytdlpApplyToMain")}${selectedCount ? ` (${selectedCount})` : ""}`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <GlassModal
        open={!!preview}
        onClose={() => setPreview(null)}
        size="lg"
        title={
          preview
            ? `${t("telegramThumbPreviewTitle")} · #${preview.ep.index} · msg ${preview.ep.messageId}`
            : t("telegramThumbPreviewTitle")
        }
      >
        {preview ? (
          <div className="space-y-3">
            <p className="text-caption text-ink-muted">
              {preview.ep.title || `msg ${preview.ep.messageId}`} ·{" "}
              {formatBytes(preview.ep.size)} · {formatDuration(preview.ep.durationSec)}
            </p>
            <p className="text-caption text-ink-muted">{t("telegramThumbPreviewHint")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.dataUrl}
              alt={preview.ep.title || `telegram-${preview.ep.messageId}`}
              className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md border border-line/50 object-contain"
            />
          </div>
        ) : null}
      </GlassModal>
    </section>
  );
}
