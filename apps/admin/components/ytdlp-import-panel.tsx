"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  adminStorageStatus,
  adminYtdlpAiExtract,
  adminYtdlpDownloadEpisode,
  adminYtdlpProbe,
  adminYtdlpResolve,
  adminYtdlpStatus,
  adminYtdlpUploadCookies,
} from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { StreamPreview } from "@/components/stream-preview";
import { GlassModal } from "@/components/glass-modal";
import { OnlineDramaForm } from "@/components/online-drama-form";
import {
  dramaInfoFromYtdlpProbe,
  type DramaInfoFillPayload,
  type OnlineIngestForm,
} from "@/lib/drama-info-fill";
import { useI18n } from "@/lib/i18n";
import { isPlayableMediaUrl } from "@/lib/playable-url";

type AiProbeResult = Awaited<ReturnType<typeof adminYtdlpAiExtract>>;
type YtProbeResult = Awaited<ReturnType<typeof adminYtdlpProbe>>;
type ProbeResult = AiProbeResult | YtProbeResult;
type FormatPreference = "best_hls" | "best_mp4" | "best";
type IngestTab = "parse" | "manual";
export type OnlineIngestTab = IngestTab;

function isAiProbe(p: ProbeResult | null): p is AiProbeResult {
  return !!p && "source" in p && p.source === "ai";
}

function episodeSourceUrl(ep: ProbeResult["episodes"][number]): string | undefined {
  return "sourceUrl" in ep && typeof ep.sourceUrl === "string"
    ? ep.sourceUrl.trim() || undefined
    : undefined;
}

function probeSelectionKey(p: ProbeResult): string {
  return `${isAiProbe(p) ? "ai" : "yt"}:${p.webpageUrl ?? ""}:${p.episodes
    .map((e) => `${e.index}:${e.id}`)
    .join("|")}`;
}

function guessHostnameFromUrl(raw: string): string {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 在线资源准备：公开页解析或手动粘贴直链。
 * 不在弹窗内创建剧集；把信息与片源配置回填主窗口，由主窗口统一提交。
 */
export function YtdlpImportPanel({
  onDirtyChange,
  embedded = false,
  onFillDramaInfo,
  ingestTab: ingestTabProp,
  onIngestTabChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  embedded?: boolean;
  onFillDramaInfo?: (payload: DramaInfoFillPayload) => void;
  /** When set with onIngestTabChange, tabs are controlled by the parent (e.g. modal title). */
  ingestTab?: IngestTab;
  onIngestTabChange?: (tab: IngestTab) => void;
} = {}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [ingestTabUncontrolled, setIngestTabUncontrolled] = useState<IngestTab>("parse");
  const ingestTab = ingestTabProp ?? ingestTabUncontrolled;
  const setIngestTab = onIngestTabChange ?? setIngestTabUncontrolled;
  const tabsInParent = ingestTabProp != null && onIngestTabChange != null;
  const [ingestForm, setIngestForm] = useState<OnlineIngestForm>("r2");
  const [manualDirty, setManualDirty] = useState(false);
  const [url, setUrl] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [epRangeStart, setEpRangeStart] = useState("");
  const [epRangeEnd, setEpRangeEnd] = useState("");
  const [formatPreference, setFormatPreference] = useState<FormatPreference>("best");
  const [error, setError] = useState<string | null>(null);
  const [engineOpen, setEngineOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [cookiesFile, setCookiesFile] = useState("");
  const [authBearer, setAuthBearer] = useState("");
  const [cookieHost, setCookieHost] = useState("");
  const [cookieUploadBusy, setCookieUploadBusy] = useState(false);
  const [previewEpIndex, setPreviewEpIndex] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [overwriteMeta, setOverwriteMeta] = useState(true);
  const [downloadingEpIndex, setDownloadingEpIndex] = useState<number | null>(null);
  const [resolveProgress, setResolveProgress] = useState<string | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [resolveQueueBusy, setResolveQueueBusy] = useState(false);
  const [downloadQueueBusy, setDownloadQueueBusy] = useState(false);
  const resolveAbortRef = useRef(false);
  const downloadAbortRef = useRef(false);
  const probeSelectKeyRef = useRef("");

  const statusQ = useQuery({
    queryKey: ["admin", "ytdlp", "status"],
    queryFn: () => adminYtdlpStatus(),
  });
  const storageQ = useQuery({
    queryKey: ["admin", "storage", "status"],
    queryFn: () => adminStorageStatus(),
  });

  const parseDirty = Boolean(url.trim() || probe || epRangeStart.trim() || epRangeEnd.trim());
  const dirty = parseDirty || manualDirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  function clearDirtyForNav() {
    setManualDirty(false);
    onDirtyChange?.(false);
  }

  function clearUrlInput() {
    setUrl("");
    setProbe(null);
    setPreviewEpIndex(null);
    setPreviewUrl(null);
    setError(null);
    setApplied(false);
    setResolveProgress(null);
    setSelectedIndexes([]);
    probeSelectKeyRef.current = "";
    resolveAbortRef.current = true;
    downloadAbortRef.current = true;
    setResolveQueueBusy(false);
    setDownloadQueueBusy(false);
    setDownloadingEpIndex(null);
  }

  function toggleEpisodeSelected(index: number) {
    setSelectedIndexes((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index].sort((a, b) => a - b),
    );
  }

  function selectAllEpisodes() {
    if (!probe) return;
    const indexes = probe.episodes.map((ep) => ep.index);
    setSelectedIndexes(indexes);
    if (indexes.length) {
      setEpRangeStart(String(indexes[0]));
      setEpRangeEnd(String(indexes[indexes.length - 1]));
    }
  }

  function clearEpisodeSelection() {
    setSelectedIndexes([]);
  }

  /** Select probe episodes whose index falls in [start, end] (blank = full span). */
  function applyEpisodeRange(startRaw: string, endRaw: string) {
    if (!probe?.episodes.length) return;
    const indexes = probe.episodes.map((ep) => ep.index);
    const lo = Math.min(...indexes);
    const hi = Math.max(...indexes);
    let start = startRaw.trim() ? Number(startRaw) : lo;
    let end = endRaw.trim() ? Number(endRaw) : hi;
    if (!Number.isFinite(start)) start = lo;
    if (!Number.isFinite(end)) end = hi;
    start = Math.max(lo, Math.min(hi, Math.trunc(start)));
    end = Math.max(lo, Math.min(hi, Math.trunc(end)));
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    setEpRangeStart(String(start));
    setEpRangeEnd(String(end));
    setSelectedIndexes(
      probe.episodes
        .filter((ep) => ep.index >= start && ep.index <= end)
        .map((ep) => ep.index),
    );
    setApplied(false);
  }

  function authPayload() {
    const file = cookiesFile.trim() || undefined;
    const bearer = authBearer.trim() || undefined;
    if (!file && !bearer) return undefined;
    return { cookiesFile: file, authBearer: bearer };
  }

  async function downloadEpisode(ep: ProbeResult["episodes"][number]) {
    setError(null);
    setDownloadingEpIndex(ep.index);
    const title = (ep.title || `ep-${ep.index}`).trim().slice(0, 60);
    const direct = episodeSourceUrl(ep);
    const downloadUrl =
      (direct && isPlayableMediaUrl(direct) ? direct : undefined) ||
      ep.webpageUrl;
    try {
      await adminYtdlpDownloadEpisode({
        url: downloadUrl,
        formatPreference:
          formatPreference === "best_hls" ? "best_mp4" : formatPreference,
        playlistIndex: ep.playlistIndex,
        filenameHint: `${String(ep.index).padStart(2, "0")}-${title}`,
        ...authPayload(),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingEpIndex(null);
    }
  }

  /** Serial browser download for checked episodes. */
  async function runDownloadQueue() {
    if (!probe?.episodes?.length) {
      setError(t("ytdlpNeedProbe"));
      return;
    }
    if (!configured) {
      setError(t("ytdlpNotConfigured"));
      return;
    }
    if (!ffmpegReady) {
      setError(t("ytdlpNeedFfmpeg"));
      return;
    }
    const selected = new Set(selectedIndexes);
    const queue = probe.episodes.filter((ep) => selected.has(ep.index));
    if (!queue.length) {
      setError(t("ytdlpResolveSelectNeed"));
      return;
    }

    downloadAbortRef.current = false;
    setDownloadQueueBusy(true);
    setError(null);
    let ok = 0;
    let fail = 0;
    let done = 0;
    const fails: { index: number; error: string }[] = [];

    for (const ep of queue) {
      if (downloadAbortRef.current) break;
      setDownloadingEpIndex(ep.index);
      setResolveProgress(
        t("ytdlpBrowserDownloadProgress", {
          done: String(done),
          total: String(queue.length),
          current: String(ep.index),
        }),
      );

      const title = (ep.title || `ep-${ep.index}`).trim().slice(0, 60);
      const direct = episodeSourceUrl(ep);
      const downloadUrl =
        (direct && isPlayableMediaUrl(direct) ? direct : undefined) ||
        ep.webpageUrl;
      if (!downloadUrl?.trim()) {
        fail += 1;
        done += 1;
        fails.push({ index: ep.index, error: "missing url" });
        continue;
      }

      try {
        await adminYtdlpDownloadEpisode({
          url: downloadUrl,
          formatPreference:
            formatPreference === "best_hls" ? "best_mp4" : formatPreference,
          playlistIndex: ep.playlistIndex,
          filenameHint: `${String(ep.index).padStart(2, "0")}-${title}`,
          ...authPayload(),
        });
        ok += 1;
      } catch (e: unknown) {
        fail += 1;
        fails.push({
          index: ep.index,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      done += 1;
      setResolveProgress(
        t("ytdlpBrowserDownloadProgress", {
          done: String(done),
          total: String(queue.length),
          current: String(ep.index),
        }),
      );
    }

    const cancelled = downloadAbortRef.current && done < queue.length;
    setDownloadQueueBusy(false);
    setDownloadingEpIndex(null);
    setResolveProgress(null);

    if (cancelled) {
      setError(
        t("ytdlpResolveQueueCancelled", {
          ok: String(ok),
          fail: String(fail),
          left: String(queue.length - done),
        }),
      );
    } else if (fail > 0) {
      setError(
        t("ytdlpBrowserDownloadPartial", {
          ok: String(ok),
          fail: String(fail),
          detail: fails
            .slice(0, 3)
            .map((f) => `#${f.index}: ${f.error}`)
            .join("; "),
        }),
      );
    } else {
      setError(null);
    }
  }

  const aiExtractMut = useMutation({
    mutationFn: () => {
      const u = url.trim();
      if (!u) throw new Error(t("ytdlpNeedUrl"));
      return adminYtdlpAiExtract(u, {
        ...authPayload(),
      });
    },
    onSuccess: (data) => {
      setError(null);
      setPreviewEpIndex(null);
      setPreviewUrl(null);
      setApplied(false);
      setResolveProgress(null);
      setProbe(data);
    },
    onError: (e: Error) => {
      setApplied(false);
      setError(e.message);
    },
  });

  const resolveMut = useMutation({
    mutationFn: async (ep: ProbeResult["episodes"][number]) => {
      const direct = episodeSourceUrl(ep);
      if (direct && isPlayableMediaUrl(direct)) {
        return { playUrl: direct, originalUrl: direct };
      }
      return adminYtdlpResolve({
        url: ep.webpageUrl,
        formatPreference,
        playlistIndex: ep.playlistIndex,
        ...authPayload(),
      });
    },
    onSuccess: (data, ep) => {
      setError(null);
      setPreviewEpIndex(ep.index);
      setPreviewUrl(data.playUrl);
      if (isPlayableMediaUrl(data.playUrl)) {
        setProbe((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            episodes: prev.episodes.map((row) =>
              row.index === ep.index
                ? {
                    ...row,
                    sourceUrl: data.playUrl,
                    candidateCount: Math.max(row.candidateCount || 0, 1),
                  }
                : row,
            ),
          } as ProbeResult;
        });
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    if (!probe) {
      setSelectedIndexes([]);
      setEpRangeStart("");
      setEpRangeEnd("");
      probeSelectKeyRef.current = "";
      return;
    }
    const key = probeSelectionKey(probe);
    if (key === probeSelectKeyRef.current) return;
    probeSelectKeyRef.current = key;
    const indexes = probe.episodes.map((ep) => ep.index);
    setSelectedIndexes(indexes);
    if (indexes.length) {
      setEpRangeStart(String(indexes[0]));
      setEpRangeEnd(String(indexes[indexes.length - 1]));
    }
  }, [probe]);

  async function onCookieFilePicked(file: File | null) {
    if (!file) return;
    const host =
      cookieHost.trim() ||
      guessHostnameFromUrl(url) ||
      file.name.replace(/\.txt$/i, "").trim();
    if (!host) {
      setError(t("ytdlpAuthNeedHostname"));
      return;
    }
    setCookieUploadBusy(true);
    setError(null);
    try {
      const saved = await adminYtdlpUploadCookies(file, host);
      setCookiesFile(saved.filename);
      setCookieHost(host.replace(/^www\./, ""));
      setAuthOpen(true);
      await qc.invalidateQueries({ queryKey: ["admin", "ytdlp", "status"] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCookieUploadBusy(false);
    }
  }

  const configured = !!statusQ.data?.configured;
  const authInfo = statusQ.data?.auth;
  const hostCookieFiles = authInfo?.hostCookieFiles ?? [];
  const authReady =
    !!cookiesFile.trim() ||
    !!authBearer.trim() ||
    !!authInfo?.globalCookiesConfigured ||
    !!authInfo?.bearerConfigured ||
    hostCookieFiles.length > 0;
  const r2Ready = !!storageQ.data?.r2Configured;
  const ffmpegReady = storageQ.data?.ffmpegReady !== false;

  async function runResolveQueue(): Promise<{
    ok: number;
    fail: number;
    cancelled: boolean;
    episodes: ProbeResult["episodes"];
  }> {
    if (!probe?.episodes?.length) {
      setError(t("ytdlpNeedProbe"));
      return { ok: 0, fail: 0, cancelled: true, episodes: [] };
    }
    if (!configured) {
      setError(t("ytdlpNotConfigured"));
      return { ok: 0, fail: 0, cancelled: true, episodes: probe.episodes };
    }
    const selected = new Set(selectedIndexes);
    const queue = probe.episodes.filter((ep) => selected.has(ep.index));
    if (!queue.length) {
      setError(t("ytdlpResolveSelectNeed"));
      return { ok: 0, fail: 0, cancelled: true, episodes: probe.episodes };
    }

    resolveAbortRef.current = false;
    setResolveQueueBusy(true);
    setError(null);
    let ok = 0;
    let fail = 0;
    let done = 0;
    const fails: { index: number; error: string }[] = [];
    let episodes = probe.episodes;

    for (const ep of queue) {
      if (resolveAbortRef.current) break;
      setResolveProgress(
        t("ytdlpResolveBatchProgress", {
          done: String(done),
          total: String(queue.length),
        }) + ` · #${ep.index}`,
      );

      const existing = episodeSourceUrl(ep);
      if (isPlayableMediaUrl(existing)) {
        ok += 1;
        done += 1;
        setResolveProgress(
          t("ytdlpResolveBatchProgress", {
            done: String(done),
            total: String(queue.length),
          }),
        );
        continue;
      }

      const pageUrl = (ep.webpageUrl || existing || "").trim();
      if (!pageUrl) {
        fail += 1;
        done += 1;
        fails.push({ index: ep.index, error: "missing url" });
        continue;
      }

      try {
        const data = await adminYtdlpResolve({
          url: pageUrl,
          formatPreference,
          playlistIndex: ep.playlistIndex,
          ...authPayload(),
        });
        episodes = episodes.map((row) =>
          row.index === ep.index
            ? {
                ...row,
                sourceUrl: data.playUrl,
                candidateCount: Math.max(row.candidateCount || 0, 1),
              }
            : row,
        ) as ProbeResult["episodes"];
        setProbe((prev) => {
          if (!prev) return prev;
          const extractor = prev.extractor.includes("+ytdlp")
            ? prev.extractor
            : `${prev.extractor}+ytdlp`;
          return {
            ...prev,
            extractor,
            episodes,
          } as ProbeResult;
        });
        ok += 1;
      } catch (e: unknown) {
        fail += 1;
        fails.push({
          index: ep.index,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      done += 1;
      setResolveProgress(
        t("ytdlpResolveBatchProgress", {
          done: String(done),
          total: String(queue.length),
        }),
      );
    }

    const cancelled = resolveAbortRef.current && done < queue.length;
    setResolveQueueBusy(false);
    setResolveProgress(null);

    if (cancelled) {
      setError(
        t("ytdlpResolveQueueCancelled", {
          ok: String(ok),
          fail: String(fail),
          left: String(queue.length - done),
        }),
      );
    } else if (fail > 0) {
      setError(
        t("ytdlpResolveBatchPartial", {
          ok: String(ok),
          fail: String(fail),
          detail: fails
            .slice(0, 3)
            .map((f) => `#${f.index}: ${f.error}`)
            .join("; "),
        }),
      );
    } else {
      setError(null);
    }

    return { ok, fail, cancelled, episodes };
  }

  /** Fill drama meta + stage selected episodes. Link: resolve playable URLs first. */
  async function applyProbeToMain() {
    if (!probe) {
      setError(t("ytdlpNeedProbe"));
      return;
    }
    if (!onFillDramaInfo) {
      setError(t("ytdlpApplyNeedMain"));
      return;
    }
    if (!selectedIndexes.length) {
      setError(t("ytdlpResolveSelectNeed"));
      return;
    }

    let working = probe;

    if (ingestForm === "link") {
      const selected = working.episodes.filter((ep) =>
        selectedIndexes.includes(ep.index),
      );
      const needResolve = selected.some(
        (ep) => !isPlayableMediaUrl(episodeSourceUrl(ep)),
      );
      if (needResolve) {
        if (!configured) {
          setError(t("ytdlpNotConfigured"));
          return;
        }
        const result = await runResolveQueue();
        if (result.cancelled) return;
        working = { ...working, episodes: result.episodes } as ProbeResult;
      }

      const after = working.episodes.filter((ep) =>
        selectedIndexes.includes(ep.index),
      );
      const unplayable = after.filter(
        (ep) => !isPlayableMediaUrl(episodeSourceUrl(ep)),
      );
      if (unplayable.length) {
        setError(
          t("ytdlpApplyNeedPlayable", {
            n: String(unplayable.length),
            total: String(after.length),
          }),
        );
        return;
      }
    } else if (ingestForm === "r2") {
      const selected = working.episodes.filter((ep) =>
        selectedIndexes.includes(ep.index),
      );
      const missing = selected.filter((ep) => {
        const src = episodeSourceUrl(ep);
        const page = (ep.webpageUrl || "").trim();
        return !src && !page;
      });
      if (missing.length) {
        setError(
          t("ytdlpApplyNeedDownloadUrl", {
            n: String(missing.length),
            total: String(selected.length),
          }),
        );
        return;
      }
    }

    const auth = authPayload();
    onFillDramaInfo(
      dramaInfoFromYtdlpProbe(working, {
        pageUrl: url.trim(),
        ingestForm,
        formatPreference,
        episodeIndexes: selectedIndexes,
        cookiesFile: auth?.cookiesFile,
        authBearer: auth?.authBearer,
        includeMeta: true,
        includeOnline: true,
        overwriteMeta,
      }),
    );
    setApplied(true);
    setError(null);
    clearDirtyForNav();
  }

  const busy =
    aiExtractMut.isPending ||
    resolveQueueBusy ||
    downloadQueueBusy ||
    resolveMut.isPending ||
    downloadingEpIndex != null ||
    cookieUploadBusy;
  const showEmpty = !probe && !error && !aiExtractMut.isPending;
  const selectedCount = selectedIndexes.length;
  const allSelected = !!probe && selectedCount === probe.episodes.length && probe.episodes.length > 0;

  const panelClass = embedded
    ? "space-y-3"
    : "upload-panel upload-panel--primary space-y-3";
  const PanelTag = embedded ? "div" : "section";

  return (
    <div className="space-y-4">
      <PanelTag className={panelClass}>
        {ingestTab === "parse" && configured ? (
          <div className="flex justify-end">
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line/60 bg-white px-2.5 py-1 text-caption text-ink-muted hover:bg-surface-2"
              onClick={() => setEngineOpen((v) => !v)}
              aria-expanded={engineOpen}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-success)" }}
                aria-hidden
              />
              {t("ytdlpEngineReady")}
              <span className="text-ink-subtle" aria-hidden>
                {engineOpen ? "▾" : "▸"}
              </span>
            </button>
          </div>
        ) : null}

        {tabsInParent ? null : (
          <div className="seg-tabs" role="tablist" aria-label={t("contentOnlineRef")}>
            {(
              [
                ["parse", t("onlineIngestTabParse")],
                ["manual", t("onlineIngestTabManual")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={ingestTab === key}
                className="seg-tabs__item"
                onClick={() => setIngestTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {ingestTab === "manual" ? (
          <OnlineDramaForm
            embedded
            fillMode
            onDirtyChange={setManualDirty}
            onFillDramaInfo={(payload) => {
              onFillDramaInfo?.(payload);
              clearDirtyForNav();
            }}
          />
        ) : (
          <>
            {!configured ? (
              <p className="text-body-sm text-danger">
                {t("ytdlpNotConfigured")}
                {statusQ.data?.lastError ? ` (${statusQ.data.lastError})` : ""}
              </p>
            ) : engineOpen ? (
              <p className="break-all text-caption text-ink-muted">
                {t("ytdlpProvider")}: {statusQ.data?.provider}
                {statusQ.data?.version ? ` ${statusQ.data.version}` : ""}
                {statusQ.data?.binSource
                  ? ` · ${t("ytdlpBinSource")}: ${statusQ.data.binSource}`
                  : ""}
                {statusQ.data?.bin ? ` · ${statusQ.data.bin}` : ""}
                {" · "}
                {t("ytdlpNoApiKey")}
              </p>
            ) : null}

            <div className="rounded-lg border border-line/70 bg-surface-2/40 px-3 py-2.5 space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setAuthOpen((v) => !v)}
                aria-expanded={authOpen}
              >
                <span className="inline-flex items-center gap-2 text-body-sm font-medium text-ink">
                  {t("ytdlpAuthTitle")}
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{
                      background: authReady
                        ? "var(--color-success)"
                        : "var(--color-ink-subtle)",
                    }}
                    aria-hidden
                  />
                  <span className="text-caption font-normal text-ink-muted">
                    {authReady ? t("ytdlpAuthReady") : t("ytdlpAuthOptional")}
                  </span>
                </span>
                <span className="text-ink-subtle" aria-hidden>
                  {authOpen ? "▾" : "▸"}
                </span>
              </button>
              {!authOpen ? (
                <p className="text-caption text-ink-muted">{t("ytdlpAuthHint")}</p>
              ) : (
                <div className="space-y-3 border-t border-line/50 pt-2.5">
                  <p className="text-caption text-ink-muted">{t("ytdlpAuthHint")}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1 text-caption text-ink-muted">
                      <span>{t("ytdlpAuthCookiesSelect")}</span>
                      <Select
                        value={cookiesFile}
                        disabled={!configured || busy}
                        onChange={(e) => setCookiesFile(e.target.value)}
                      >
                        <option value="">{t("ytdlpAuthCookiesAuto")}</option>
                        {hostCookieFiles.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                        {cookiesFile && !hostCookieFiles.includes(cookiesFile) ? (
                          <option value={cookiesFile}>{cookiesFile}</option>
                        ) : null}
                      </Select>
                    </label>
                    <label className="space-y-1 text-caption text-ink-muted">
                      <span>{t("ytdlpAuthBearer")}</span>
                      <Input
                        type="password"
                        autoComplete="off"
                        placeholder="Bearer token"
                        value={authBearer}
                        disabled={!configured || busy}
                        onChange={(e) => setAuthBearer(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[10rem] flex-1 space-y-1 text-caption text-ink-muted">
                      <span>{t("ytdlpAuthHostname")}</span>
                      <Input
                        placeholder="reelshort.com"
                        value={cookieHost}
                        disabled={!configured || busy}
                        onChange={(e) => setCookieHost(e.target.value)}
                        onFocus={() => {
                          if (!cookieHost.trim() && url.trim()) {
                            setCookieHost(guessHostnameFromUrl(url));
                          }
                        }}
                      />
                    </label>
                    <label className="inline-flex cursor-pointer items-center">
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        className="hidden"
                        disabled={!configured || busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          void onCookieFilePicked(f);
                          e.target.value = "";
                        }}
                      />
                      <span className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-body-sm text-ink hover:bg-surface-2">
                        {cookieUploadBusy
                          ? t("ytdlpAuthUploading")
                          : t("ytdlpAuthUpload")}
                      </span>
                    </label>
                  </div>
                  {authInfo ? (
                    <p className="break-all text-caption text-ink-subtle">
                      {t("ytdlpAuthStatusLine", {
                        cookies: authInfo.globalCookiesConfigured
                          ? t("ytdlpAuthYes")
                          : t("ytdlpAuthNo"),
                        bearer: authInfo.bearerConfigured
                          ? t("ytdlpAuthYes")
                          : t("ytdlpAuthNo"),
                        files: String(hostCookieFiles.length),
                      })}
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Input
                className="min-w-[20rem] flex-1"
                placeholder={t("ytdlpUrlPlaceholder")}
                value={url}
                disabled={!configured}
                onChange={(e) => {
                  setUrl(e.target.value);
                  // Do not wipe probe on every keystroke — re-extract replaces it.
                  setApplied(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url.trim() && !busy) {
                    aiExtractMut.mutate();
                  }
                }}
              />
              <Button
                size="sm"
                variant={isAiProbe(probe) ? "secondary" : "primary"}
                className={
                  isAiProbe(probe)
                    ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                    : undefined
                }
                disabled={!url.trim() || busy}
                title={t("ytdlpAiExtractHint")}
                onClick={() => aiExtractMut.mutate()}
              >
                {aiExtractMut.isPending
                  ? t("ytdlpAiExtractBusy")
                  : isAiProbe(probe)
                    ? t("ytdlpAiExtractDone")
                    : t("ytdlpAiExtract")}
              </Button>
              {url || probe ? (
                <Button size="sm" variant="ghost" onClick={clearUrlInput}>
                  {t("ytdlpClearUrl")}
                </Button>
              ) : null}
            </div>

            {showEmpty ? (
              <div className="online-empty">
                <p className="online-empty__title">{t("onlineEmptyTitle")}</p>
                <div className="online-empty__steps">
                  {(
                    [
                      ["1", t("onlineEmptyStep1"), t("onlineEmptyStep1Hint")],
                      ["2", t("onlineEmptyStep2"), t("onlineEmptyStep2Hint")],
                      ["3", t("onlineEmptyStep3"), t("onlineEmptyStep3Hint")],
                    ] as const
                  ).map(([n, title, hint]) => (
                    <div key={n} className="online-empty__step">
                      <span className="online-empty__n" aria-hidden>
                        {n}
                      </span>
                      <div>
                        <p>{title}</p>
                        <span>{hint}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </PanelTag>

      {ingestTab === "parse" && error ? (
        <p className="text-body-sm text-danger">{error}</p>
      ) : null}

      {ingestTab === "parse" && probe ? (
        <div className="upload-panel space-y-4">
          <div className="flex flex-wrap gap-3">
            {probe.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={probe.coverUrl} alt="" className="h-24 w-16 rounded object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold">{probe.title}</h4>
              <p className="text-caption text-ink-muted">
                {isAiProbe(probe)
                  ? `${t("ytdlpAiExtract")} · ${probe.model || "openai"}`
                  : `${probe.extractor} · ${probe.kind}`}{" "}
                · {t("importEpisodeCount", { n: probe.episodes.length })}
              </p>
              {isAiProbe(probe) && probe.notes ? (
                <p className="mt-1 text-caption text-ink-subtle">
                  {t("ytdlpAiNotes")}: {probe.notes}
                </p>
              ) : null}
              {probe.description ? (
                <p className="mt-1 line-clamp-3 text-body-sm text-ink-muted">{probe.description}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="text-body-sm font-medium">{t("ytdlpEpisodeList")}</h5>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-caption text-ink-muted">
                  <span className="shrink-0">{t("importEpisodeRange")}</span>
                  <Input
                    className="h-7 w-14 px-1.5 py-0 text-caption"
                    type="number"
                    min={1}
                    placeholder="1"
                    value={epRangeStart}
                    disabled={busy || !probe.episodes.length}
                    onChange={(e) => setEpRangeStart(e.target.value)}
                    onBlur={() => applyEpisodeRange(epRangeStart, epRangeEnd)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyEpisodeRange(epRangeStart, epRangeEnd);
                      }
                    }}
                  />
                  <span className="text-ink-subtle">–</span>
                  <Input
                    className="h-7 w-14 px-1.5 py-0 text-caption"
                    type="number"
                    min={1}
                    placeholder={String(
                      Math.max(...probe.episodes.map((ep) => ep.index), 1),
                    )}
                    value={epRangeEnd}
                    disabled={busy || !probe.episodes.length}
                    onChange={(e) => setEpRangeEnd(e.target.value)}
                    onBlur={() => applyEpisodeRange(epRangeStart, epRangeEnd)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyEpisodeRange(epRangeStart, epRangeEnd);
                      }
                    }}
                  />
                </label>
                <span className="text-caption text-ink-muted">
                  {t("ytdlpResolveSelectedCount", {
                    n: String(selectedCount),
                    total: String(probe.episodes.length),
                  })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !probe.episodes.length}
                  onClick={() => (allSelected ? clearEpisodeSelection() : selectAllEpisodes())}
                >
                  {allSelected ? t("ytdlpResolveDeselectAll") : t("ytdlpResolveSelectAll")}
                </Button>
              </div>
            </div>
            <ul className="grid max-h-96 grid-cols-6 gap-2 overflow-y-auto rounded border border-line/60 bg-surface-2/20 p-2">
              {probe.episodes.map((ep) => {
                const playable = isPlayableMediaUrl(episodeSourceUrl(ep));
                const checked = selectedIndexes.includes(ep.index);
                const actionsOpen =
                  downloadingEpIndex === ep.index ||
                  (previewUrl != null && previewEpIndex === ep.index);
                const durationLabel = ep.durationSec
                  ? `${Math.floor(ep.durationSec / 60)}:${String(ep.durationSec % 60).padStart(2, "0")}`
                  : null;
                return (
                  <li key={`${ep.id}-${ep.index}`}>
                    <div
                      className={
                        checked
                          ? "group relative flex min-h-[4.5rem] flex-col rounded-md border border-brand/40 bg-brand/5 p-2 shadow-sm transition hover:border-brand/55"
                          : "group relative flex min-h-[4.5rem] flex-col rounded-md border border-line/70 bg-white p-2 shadow-sm transition hover:border-line hover:bg-surface-2/40"
                      }
                    >
                      <label className="flex min-w-0 cursor-pointer items-start gap-1.5">
                        <input
                          type="checkbox"
                          className="mt-0.5 shrink-0"
                          checked={checked}
                          disabled={resolveQueueBusy}
                          onChange={() => toggleEpisodeSelected(ep.index)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-body-sm font-medium text-ink">
                            <span className="text-ink-muted">#{ep.index}</span>{" "}
                            {ep.title || `EP${ep.index}`}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
                            {durationLabel ? <span>{durationLabel}</span> : null}
                            {playable ? (
                              <span className="text-success">{t("ytdlpResolveEpPlayable")}</span>
                            ) : null}
                          </span>
                        </span>
                      </label>
                      <div
                        className={
                          actionsOpen
                            ? "absolute bottom-1 right-1 z-10 flex items-center gap-0.5 rounded bg-white/95 p-0.5 opacity-100 shadow-sm ring-1 ring-line/50 transition-opacity"
                            : "pointer-events-none absolute bottom-1 right-1 z-10 flex items-center gap-0.5 rounded bg-white/95 p-0.5 opacity-0 shadow-sm ring-1 ring-line/50 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
                        }
                      >
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-6 min-h-0 px-1.5 py-0 text-[11px] leading-none"
                          disabled={busy}
                          onClick={() => resolveMut.mutate(ep)}
                        >
                          {resolveMut.isPending && previewEpIndex === ep.index
                            ? t("loading")
                            : t("ytdlpPreviewEp")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 min-h-0 px-1.5 py-0 text-[11px] leading-none"
                          disabled={busy || !ffmpegReady}
                          title={
                            !ffmpegReady ? t("ytdlpNeedFfmpeg") : t("ytdlpBrowserDownloadHint")
                          }
                          onClick={() => void downloadEpisode(ep)}
                        >
                          {downloadingEpIndex === ep.index
                            ? t("ytdlpBrowserDownloading")
                            : t("ytdlpDownloadLocal")}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-3 border-t border-line/50 pt-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="seg-tabs" role="tablist" aria-label={t("ytdlpChooseIngest")}>
                  {(
                    [
                      ["r2", t("ytdlpIngestFormR2")],
                      ["link", t("ytdlpIngestFormLink")],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={ingestForm === key}
                      className="seg-tabs__item"
                      disabled={busy}
                      title={
                        key === "r2"
                          ? t("ytdlpIngestFormR2Hint")
                          : t("ytdlpIngestFormLinkHint")
                      }
                      onClick={() => {
                        setIngestForm(key);
                        setFormatPreference(key === "link" ? "best_hls" : "best");
                        setApplied(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="text-caption text-ink-muted">
                  {t("ytdlpFormat")}
                  <Select
                    className="mt-1 w-36"
                    value={formatPreference}
                    disabled={busy}
                    onChange={(e) => {
                      setFormatPreference(e.target.value as FormatPreference);
                      setApplied(false);
                    }}
                  >
                    <option value="best">{t("ytdlpFormatBest")}</option>
                    <option value="best_mp4">{t("ytdlpFormatMp4")}</option>
                    <option value="best_hls">{t("ytdlpFormatHls")}</option>
                  </Select>
                </label>
              </div>
              {ingestForm === "r2" && (!r2Ready || !ffmpegReady) ? (
                <p className="text-caption text-warning">
                  {!r2Ready ? t("ytdlpNeedR2") : t("ytdlpNeedFfmpeg")}
                </p>
              ) : null}
            </div>

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
                    disabled={busy}
                    onChange={(e) => setOverwriteMeta(e.target.checked)}
                  />
                  <span>{t("ytdlpOverwriteMetaShort")}</span>
                </label>
                <div className="min-w-0 flex-1">
                  {resolveProgress ? (
                    <p className="text-caption text-ink-muted">{resolveProgress}</p>
                  ) : (
                    <p className="text-caption text-ink-muted">
                      {ingestForm === "link"
                        ? t("ytdlpApplyCompactHintLink")
                        : t("ytdlpApplyCompactHintR2")}
                    </p>
                  )}
                </div>
                {resolveQueueBusy || downloadQueueBusy ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (resolveQueueBusy) resolveAbortRef.current = true;
                      if (downloadQueueBusy) downloadAbortRef.current = true;
                    }}
                  >
                    {t("ytdlpResolveQueueCancel")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    busy ||
                    selectedCount === 0 ||
                    !configured ||
                    !ffmpegReady
                  }
                  title={!ffmpegReady ? t("ytdlpNeedFfmpeg") : t("ytdlpDownloadSelectedHint")}
                  onClick={() => void runDownloadQueue()}
                >
                  {downloadQueueBusy
                    ? t("ytdlpBrowserDownloading")
                    : `${t("ytdlpDownloadSelected")}${selectedCount ? ` (${selectedCount})` : ""}`}
                </Button>
                <Button
                  size="sm"
                  variant={applied ? "secondary" : "primary"}
                  className={
                    applied
                      ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                      : undefined
                  }
                  disabled={
                    busy ||
                    selectedCount === 0 ||
                    (ingestForm === "r2" && (!r2Ready || !ffmpegReady)) ||
                    (ingestForm === "link" && !configured)
                  }
                  onClick={() => void applyProbeToMain()}
                >
                  {resolveQueueBusy
                    ? t("ytdlpResolveBatchBusy")
                    : applied
                      ? t("ytdlpApplyToMainDone")
                      : `${t("ytdlpApplyToMain")}${selectedCount ? ` (${selectedCount})` : ""}`}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <GlassModal
        open={!!previewUrl}
        onClose={() => {
          setPreviewUrl(null);
          setPreviewEpIndex(null);
        }}
        size="xl"
        title={
          previewEpIndex != null
            ? `${t("ytdlpPreviewTitle")} · #${previewEpIndex}`
            : t("ytdlpPreviewTitle")
        }
      >
        <p className="mb-2 text-caption text-ink-muted">{t("ytdlpPreviewCorsHint")}</p>
        {previewUrl ? (
          <StreamPreview
            src={previewUrl}
            poster={probe?.coverUrl}
            failHint={t("ytdlpPreviewCorsFail")}
            className="aspect-video w-full overflow-hidden rounded-lg bg-black"
          />
        ) : null}
      </GlassModal>
    </div>
  );
}
