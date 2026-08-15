"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  adminStorageStatus,
  adminYtdlpTransfer,
  adminTelegramStatus,
  adminYtdlpAppendTransfer,
  adminYtdlpAiExtract,
  adminYtdlpCatalog,
  adminYtdlpDownloadEpisode,
  adminYtdlpPreviewFrame,
  adminYtdlpProbe,
  adminYtdlpResolve,
  adminYtdlpResolveBatch,
  adminYtdlpStatus,
  adminYtdlpUploadCookies,
} from "@velvet/api-client";
import { Button, Input, Select } from "@velvet/ui";
import { StreamPreview } from "@/components/stream-preview";
import { GlassModal } from "@/components/glass-modal";
import {
  LocalUploadWizard,
  type LocalUploadWizardHandle,
} from "@/components/local-upload-wizard";
import { OnlineDramaForm } from "@/components/online-drama-form";
import {
  dramaInfoFromYtdlpProbe,
  type DramaInfoFillPayload,
  type OnlineIngestForm,
} from "@/lib/drama-info-fill";
import { useI18n } from "@/lib/i18n";
import { useUploadQueue } from "@/lib/upload-queue";
import { composeDramaSourceTags } from "@/lib/drama-tags";
import { isPlayableMediaUrl } from "@/lib/playable-url";
import {
  WatermarkPositionEditor,
  DEFAULT_PLACEMENT,
  type WatermarkPlacement,
} from "@/components/watermark-position-editor";
import {
  isLikelyTelegramUrl,
  TelegramImportPanel,
} from "@/components/telegram-import-panel";

type AiProbeResult = Awaited<ReturnType<typeof adminYtdlpAiExtract>>;
type CatalogResult = Awaited<ReturnType<typeof adminYtdlpCatalog>>;
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

function episodePlaylistIndex(
  ep: ProbeResult["episodes"][number],
): number | undefined {
  return "playlistIndex" in ep && typeof ep.playlistIndex === "number"
    ? ep.playlistIndex
    : undefined;
}

function probeSelectionKey(p: ProbeResult): string {
  const kind = isAiProbe(p) ? "ai" : "yt";
  return `${kind}:${p.webpageUrl ?? ""}:${p.episodes
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

function isReelshortCatalogUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return (
      /(^|\.)reelshort\.com$/i.test(parsed.hostname) &&
      /^\/(?:[a-z]{2}\/)?tags(?:\/|$)/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

type CatalogItem = CatalogResult["items"][number];
const RS_CATALOG_CACHE_KEY = "velvet-admin-rs-catalog-v1";
// v2 invalidates earlier caches that were populated with translated metadata.
const RS_DRAMA_INFO_CACHE_KEY = "velvet-admin-rs-drama-info-v2";
const RS_DRAMA_INFO_CACHE_LIMIT = 24;

type RsDramaInfoCacheEntry = {
  webpageUrl: string;
  probe: ProbeResult;
  cachedAt: number;
};

function readRsDramaInfoCache(): RsDramaInfoCacheEntry[] {
  try {
    const raw = window.localStorage.getItem(RS_DRAMA_INFO_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RsDramaInfoCacheEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as RsDramaInfoCacheEntry).webpageUrl === "string" &&
        Array.isArray((entry as RsDramaInfoCacheEntry).probe?.episodes),
    );
  } catch {
    window.localStorage.removeItem(RS_DRAMA_INFO_CACHE_KEY);
    return [];
  }
}

function readCachedRsDramaInfo(webpageUrl: string): ProbeResult | null {
  return (
    readRsDramaInfoCache().find((entry) => entry.webpageUrl === webpageUrl)
      ?.probe ?? null
  );
}

function readCachedRsDramaInfoUpdatedAt(webpageUrl: string): number | null {
  const entry = readRsDramaInfoCache().find(
    (value) => value.webpageUrl === webpageUrl,
  );
  return entry && Number.isFinite(entry.cachedAt) ? entry.cachedAt : null;
}

function formatRefreshTime(timestamp: number | null, locale: "zh" | "en") {
  if (!timestamp) return null;
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function cacheRsDramaInfo(webpageUrl: string, probe: ProbeResult) {
  try {
    const entries = readRsDramaInfoCache().filter(
      (entry) => entry.webpageUrl !== webpageUrl,
    );
    entries.unshift({ webpageUrl, probe, cachedAt: Date.now() });
    window.localStorage.setItem(
      RS_DRAMA_INFO_CACHE_KEY,
      JSON.stringify(entries.slice(0, RS_DRAMA_INFO_CACHE_LIMIT)),
    );
  } catch {
    // The current detail remains usable when browser storage is unavailable.
  }
}

function CatalogDramaEditor({
  item,
  probe,
  ingestForm,
  formatPreference,
  cookiesFile,
  authBearer,
  watermark,
  onTransferQueued,
}: {
  item: CatalogItem;
  probe: ProbeResult;
  ingestForm: OnlineIngestForm;
  formatPreference: FormatPreference;
  cookiesFile?: string;
  authBearer?: string;
  watermark: WatermarkPlacement;
  onTransferQueued?: () => void;
}) {
  const wizardRef = useRef<LocalUploadWizardHandle>(null);

  useEffect(() => {
    // ReelShort's catalog payload contains the synopsis, while the fast detail
    // probe may omit it. Merge the catalog fallback before mapping into the
    // shared wizard so the description is filled even from cached/fast probes.
    const probeDescription =
      "description" in probe && typeof probe.description === "string"
        ? probe.description.trim()
        : "";
    const probeWithCatalogDescription =
      probeDescription || !item.description?.trim()
        ? probe
        : { ...probe, description: item.description.trim() };
    const probeCompletion =
      "completion" in probe &&
      (probe.completion === "已完结" || probe.completion === "连载中")
        ? probe.completion
        : undefined;
    const probeWithCatalogMeta =
      probeCompletion || !item.completion
        ? probeWithCatalogDescription
        : { ...probeWithCatalogDescription, completion: item.completion };
    wizardRef.current?.applyDramaInfo(
      dramaInfoFromYtdlpProbe(probeWithCatalogMeta, {
        pageUrl: item.webpageUrl,
        ingestForm,
        provider: "ytdlp",
        formatPreference,
        episodeIndexes: probe.episodes.map((episode) => episode.index),
        cookiesFile,
        authBearer,
        watermarkEnabled: ingestForm === "r2" ? watermark.enabled : false,
        watermarkX: watermark.x,
        watermarkY: watermark.y,
        watermarkScale: watermark.scale,
        includeMeta: true,
        includeOnline: true,
        overwriteMeta: true,
      }),
    );
  }, [
    authBearer,
    cookiesFile,
    formatPreference,
    ingestForm,
    item.completion,
    item.description,
    item.webpageUrl,
    probe,
    watermark.enabled,
    watermark.scale,
    watermark.x,
    watermark.y,
  ]);

  return (
    <LocalUploadWizard
      ref={wizardRef}
      presentation="info-policy"
      onTransferQueued={onTransferQueued ? () => onTransferQueued() : undefined}
    />
  );
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
  initialUrl = "",
  autoLoadInitialUrl = false,
  enableCatalogMultiSelect = false,
  catalogCardsOpenEditor = false,
  dedicatedCatalogMode = false,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  embedded?: boolean;
  onFillDramaInfo?: (payload: DramaInfoFillPayload) => void;
  /** When set with onIngestTabChange, tabs are controlled by the parent (e.g. modal title). */
  ingestTab?: IngestTab;
  onIngestTabChange?: (tab: IngestTab) => void;
  initialUrl?: string;
  /** Discover a supplied catalog URL once when the panel opens. */
  autoLoadInitialUrl?: boolean;
  enableCatalogMultiSelect?: boolean;
  /** RS sync only: clicking a catalog card opens drama info + playback policy. */
  catalogCardsOpenEditor?: boolean;
  /** RS sync only: parse-only UI, compact auth control, explicit catalog start. */
  dedicatedCatalogMode?: boolean;
} = {}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { enqueueTransferJob, jobs: uploadJobs } = useUploadQueue();
  const [ingestTabUncontrolled, setIngestTabUncontrolled] = useState<IngestTab>("parse");
  const ingestTab = dedicatedCatalogMode
    ? "parse"
    : ingestTabProp ?? ingestTabUncontrolled;
  const setIngestTab = onIngestTabChange ?? setIngestTabUncontrolled;
  const tabsInParent = ingestTabProp != null && onIngestTabChange != null;
  const [ingestForm, setIngestForm] = useState<OnlineIngestForm>("r2");
  const [manualDirty, setManualDirty] = useState(false);
  const [url, setUrl] = useState(initialUrl);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [catalogItem, setCatalogItem] = useState<
    CatalogResult["items"][number] | null
  >(null);
  const [catalogDetailError, setCatalogDetailError] = useState<string | null>(null);
  const [catalogSyncNotice, setCatalogSyncNotice] = useState<string | null>(null);
  const [catalogLastRefreshedAt, setCatalogLastRefreshedAt] = useState<number | null>(null);
  const [catalogDetailLastRefreshedAt, setCatalogDetailLastRefreshedAt] =
    useState<number | null>(null);
  const [transferCandidates, setTransferCandidates] = useState<
    CatalogResult["items"]
  >([]);
  const [catalogBatchBusy, setCatalogBatchBusy] = useState(false);
  const [autoPublishAfterTransfer, setAutoPublishAfterTransfer] = useState(true);
  const catalogSelectedIds = transferCandidates.map((item) => item.id);
  const [epRangeStart, setEpRangeStart] = useState("");
  const [epRangeEnd, setEpRangeEnd] = useState("");
  const [formatPreference, setFormatPreference] = useState<FormatPreference>("best");
  const [watermark, setWatermark] = useState<WatermarkPlacement>(DEFAULT_PLACEMENT);
  const [watermarkFrame, setWatermarkFrame] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const [watermarkFrameBusy, setWatermarkFrameBusy] = useState(false);
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
  const [tgProbeRequestKey, setTgProbeRequestKey] = useState(0);
  const resolveAbortRef = useRef(false);
  const downloadAbortRef = useRef(false);
  const probeSelectKeyRef = useRef("");
  const initialLoadStartedRef = useRef(false);
  const catalogCacheRestoredRef = useRef(false);
  const probeRef = useRef<ProbeResult | null>(null);
  probeRef.current = probe;

  function activeTransferJobForCatalogItem(
    item: CatalogResult["items"][number],
  ) {
    return uploadJobs.find((job) => {
      if (
        job.kind !== "ytdlp-transfer" ||
        (job.status !== "queued" && job.status !== "running")
      ) {
        return false;
      }
      if (item.syncedDramaId) return job.dramaId === item.syncedDramaId;
      return job.title.trim().toLowerCase() === item.title.trim().toLowerCase();
    });
  }

  function isCatalogItemTransferring(
    item: CatalogResult["items"][number],
  ) {
    return !!item.transferring || !!activeTransferJobForCatalogItem(item);
  }

  function catalogItemTransferProgress(
    item: CatalogResult["items"][number],
  ) {
    const job = activeTransferJobForCatalogItem(item);
    if (!job) return Math.max(0, Math.min(99, Number(item.transferProgress) || 0));
    const total = Math.max(1, Number(job.transferProgress?.total) || 0);
    const transferred = Math.min(
      total,
      Math.max(0, Number(job.transferProgress?.transferred) || 0),
    );
    const transcoded = Math.min(
      total,
      Math.max(0, Number(job.transcodeProgress?.completed) || 0),
    );
    return Math.min(99, Math.max(0, Math.round(((transferred + transcoded) / (total * 2)) * 100)));
  }

  useEffect(() => {
    setTransferCandidates((prev) => {
      const next = prev.filter((item) => !isCatalogItemTransferring(item));
      return next.length === prev.length ? prev : next;
    });
  }, [uploadJobs]);

  const statusQ = useQuery({
    queryKey: ["admin", "ytdlp", "status"],
    queryFn: () => adminYtdlpStatus(),
  });
  const telegramStatusQ = useQuery({
    queryKey: ["admin", "telegram", "status"],
    queryFn: () => adminTelegramStatus(),
  });
  const storageQ = useQuery({
    queryKey: ["admin", "storage", "status"],
    queryFn: () => adminStorageStatus(),
  });

  const urlLooksTelegram = isLikelyTelegramUrl(url);
  const telegramReady =
    !!telegramStatusQ.data?.enabled &&
    !!telegramStatusQ.data?.health?.authorized;

  const parseDirty = Boolean(
    url.trim() || catalog || probe || epRangeStart.trim() || epRangeEnd.trim(),
  );
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
    setCatalog(null);
    setCatalogItem(null);
    setCatalogDetailError(null);
    setTransferCandidates([]);
    setProbe(null);
    setPreviewEpIndex(null);
    setPreviewUrl(null);
    setError(null);
    setApplied(false);
    setResolveProgress(null);
    setSelectedIndexes([]);
    setWatermarkFrame(null);
    setWatermarkFrameBusy(false);
    setTgProbeRequestKey(0);
    probeSelectKeyRef.current = "";
    resolveAbortRef.current = true;
    downloadAbortRef.current = true;
    setResolveQueueBusy(false);
    setDownloadQueueBusy(false);
    setDownloadingEpIndex(null);
  }

  // Switching into TG mode: drop yt-dlp/ai probe UI state.
  useEffect(() => {
    if (!urlLooksTelegram) return;
    setCatalog(null);
    setCatalogItem(null);
    setCatalogDetailError(null);
    setProbe(null);
    setPreviewEpIndex(null);
    setPreviewUrl(null);
    setResolveProgress(null);
    setSelectedIndexes([]);
    setWatermarkFrame(null);
    setApplied(false);
  }, [urlLooksTelegram]);

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

  /** Pull a real video first frame for watermark placement (never cover art). */
  useEffect(() => {
    if (ingestForm !== "r2" || !probe?.episodes?.length) {
      setWatermarkFrame(null);
      setWatermarkFrameBusy(false);
      return;
    }
    if (!watermark.enabled) {
      setWatermarkFrame(null);
      setWatermarkFrameBusy(false);
      return;
    }

    const selected = probe.episodes.filter((ep) => selectedIndexes.includes(ep.index));
    const pool = selected.length ? selected : probe.episodes;
    const pick =
      pool.find((ep) => isPlayableMediaUrl(episodeSourceUrl(ep))) ||
      pool.find((ep) => {
        const src = episodeSourceUrl(ep);
        const page = (ep.webpageUrl || "").trim();
        return !!(src || page);
      }) ||
      null;
    const direct = pick ? episodeSourceUrl(pick) : undefined;
    const targetUrl =
      (direct && isPlayableMediaUrl(direct) ? direct : undefined) ||
      (pick?.webpageUrl || "").trim() ||
      (direct || "").trim();

    if (!/^https?:\/\//i.test(targetUrl)) {
      setWatermarkFrame(null);
      setWatermarkFrameBusy(false);
      return;
    }

    let cancelled = false;
    setWatermarkFrameBusy(true);
    const auth = authPayload();
    void adminYtdlpPreviewFrame({
      url: targetUrl,
      formatPreference: formatPreference === "best_hls" ? "best_mp4" : formatPreference,
      playlistIndex: pick ? episodePlaylistIndex(pick) : undefined,
      cookiesFile: auth?.cookiesFile,
      authBearer: auth?.authBearer,
    })
      .then((frame) => {
        if (cancelled) return;
        setWatermarkFrame({
          url: frame.url,
          width: frame.width,
          height: frame.height,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setWatermarkFrame(null);
      })
      .finally(() => {
        if (!cancelled) setWatermarkFrameBusy(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auth strings are read when deps fire
  }, [
    ingestForm,
    watermark.enabled,
    probe,
    selectedIndexes,
    formatPreference,
    cookiesFile,
    authBearer,
  ]);

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
        playlistIndex: episodePlaylistIndex(ep),
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
          playlistIndex: episodePlaylistIndex(ep),
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

  const aiExtractMut = useMutation<
    AiProbeResult | CatalogResult,
    Error,
    string | undefined
  >({
    mutationFn: (targetUrl?: string) => {
      const u = (targetUrl ?? url).trim();
      if (!u) throw new Error(t("ytdlpNeedUrl"));
      if (isReelshortCatalogUrl(u)) {
        return adminYtdlpCatalog(u, {
          ...authPayload(),
        });
      }
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
      if (data.source === "catalog") {
        setCatalogLastRefreshedAt(Date.now());
        setCatalog(data);
        setCatalogItem(null);
        setCatalogDetailError(null);
        setProbe(null);
      } else {
        setCatalog(null);
        setProbe(data);
      }
    },
    onError: (e: Error) => {
      setApplied(false);
      setError(e.message);
    },
  });

  const catalogDetailMut = useMutation({
    mutationFn: (input: {
      item: CatalogResult["items"][number];
      fast?: boolean;
    }) =>
      adminYtdlpAiExtract(input.item.webpageUrl, {
        ...authPayload(),
        skipAi: input.fast,
        sourceLanguage: dedicatedCatalogMode ? "en" : undefined,
      }),
    onSuccess: (data, input) => {
      setCatalogDetailError(null);
      setProbe(data);
      setCatalogDetailLastRefreshedAt(Date.now());
      if (dedicatedCatalogMode) {
        cacheRsDramaInfo(input.item.webpageUrl, data);
      }
      setPreviewEpIndex(null);
      setPreviewUrl(null);
      setApplied(false);
      setResolveProgress(null);
    },
    onError: (e: Error) => {
      if (!probeRef.current) setProbe(null);
      setCatalogDetailError(e.message);
    },
  });

  const catalogUpdateMut = useMutation({
    mutationFn: (item: CatalogResult["items"][number]) =>
      adminYtdlpAppendTransfer({
        dramaId: item.syncedDramaId || "",
        url: item.webpageUrl,
        formatPreference,
        ...authPayload(),
      }),
    onSuccess: (data, item) => {
      if (data.jobId && data.addedEpisodes > 0) {
        enqueueTransferJob({
          title: item.title,
          dramaId: data.dramaId,
          transferJobId: data.jobId,
          totalEpisodes: data.addedEpisodes,
          episodeTitles: data.episodeTitles,
        });
        setCatalogSyncNotice(
          t("ytdlpCatalogUpdateQueued", { n: String(data.addedEpisodes) }),
        );
      } else {
        setCatalogSyncNotice(t("ytdlpCatalogNoUpdates"));
      }
      setCatalog((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((value) =>
                value.id === item.id
                  ? {
                      ...value,
                      synced: true,
                      syncedEpisodes: data.totalEpisodes,
                      updateAvailable: false,
                    }
                  : value,
              ),
            }
          : prev,
      );
    },
    onError: (e: Error) => {
      setCatalogSyncNotice(null);
      setError(e.message);
    },
  });

  useEffect(() => {
    const sourceUrl = initialUrl.trim();
    if (
      !autoLoadInitialUrl ||
      !sourceUrl ||
      initialLoadStartedRef.current
    ) {
      return;
    }
    initialLoadStartedRef.current = true;
    aiExtractMut.mutate(sourceUrl);
  }, [aiExtractMut, autoLoadInitialUrl, initialUrl]);

  useEffect(() => {
    if (!dedicatedCatalogMode || catalogCacheRestoredRef.current) return;
    catalogCacheRestoredRef.current = true;
    try {
      const raw = window.localStorage.getItem(RS_CATALOG_CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as {
        url?: unknown;
        catalog?: Partial<CatalogResult>;
        cachedAt?: unknown;
      };
      if (
        cached.catalog?.source !== "catalog" ||
        !Array.isArray(cached.catalog.items)
      ) {
        return;
      }
      setCatalog(cached.catalog as CatalogResult);
      setCatalogLastRefreshedAt(
        typeof cached.cachedAt === "number" ? cached.cachedAt : null,
      );
      if (typeof cached.url === "string" && cached.url.trim()) {
        setUrl(cached.url);
      }
    } catch {
      window.localStorage.removeItem(RS_CATALOG_CACHE_KEY);
    }
  }, [dedicatedCatalogMode]);

  useEffect(() => {
    if (!dedicatedCatalogMode || !catalog) return;
    try {
      window.localStorage.setItem(
        RS_CATALOG_CACHE_KEY,
        JSON.stringify({
          url: catalog.webpageUrl,
          catalog,
          cachedAt: Date.now(),
        }),
      );
    } catch {
      // The live catalog remains usable when browser storage is unavailable.
    }
  }, [catalog, dedicatedCatalogMode, url]);

  function openCatalogDrama(item: CatalogResult["items"][number]) {
    setCatalogItem(item);
    setCatalogDetailError(null);
    const cached = dedicatedCatalogMode
      ? readCachedRsDramaInfo(item.webpageUrl)
      : null;
    setCatalogDetailLastRefreshedAt(
      dedicatedCatalogMode
        ? readCachedRsDramaInfoUpdatedAt(item.webpageUrl)
        : null,
    );
    setProbe(cached);
    probeRef.current = cached;
    if (cached) return;
    catalogDetailMut.mutate({ item, fast: true });
  }

  function refreshCatalogDrama() {
    if (!catalogItem || catalogDetailMut.isPending) return;
    setCatalogDetailError(null);
    catalogDetailMut.mutate({ item: catalogItem, fast: false });
  }

  function toggleCatalogDrama(item: CatalogResult["items"][number]) {
    if (isCatalogItemTransferring(item)) return;
    setTransferCandidates((prev) =>
      prev.some((value) => value.id === item.id)
        ? prev.filter((value) => value.id !== item.id)
        : [...prev, item],
    );
  }

  function toggleCatalogPageSelection() {
    if (!catalog) return;
    const selectableItems = catalog.items.filter(
      (item) => !isCatalogItemTransferring(item),
    );
    const pageIds = selectableItems.map((item) => item.id);
    if (!pageIds.length) return;
    const allSelected = pageIds.every((id) => catalogSelectedIds.includes(id));
    setTransferCandidates((prev) => {
      if (allSelected) {
        const pageIdSet = new Set(pageIds);
        return prev.filter((item) => !pageIdSet.has(item.id));
      }
      const byId = new Map(prev.map((item) => [item.id, item]));
      for (const item of selectableItems) byId.set(item.id, item);
      return [...byId.values()];
    });
  }

  async function queueCatalogCandidates() {
    if (busy || catalogBatchBusy || !transferCandidates.length) return;
    const candidates = transferCandidates.filter(
      (item) => !isCatalogItemTransferring(item),
    );
    if (!candidates.length) return;
    setCatalogBatchBusy(true);
    setError(null);
    setCatalogSyncNotice(null);
    let queued = 0;
    const failures: string[] = [];

    for (const [index, item] of candidates.entries()) {
      setCatalogSyncNotice(
        t("ytdlpCatalogBatchProgress", {
          done: String(index + 1),
          total: String(candidates.length),
          title: item.title,
        }),
      );
      try {
        const detail = await adminYtdlpAiExtract(item.webpageUrl, {
          ...authPayload(),
          skipAi: true,
          sourceLanguage: dedicatedCatalogMode ? "en" : undefined,
        });
        const episodes = detail.episodes
          .map((episode) => ({
            episodeNumber: episode.index,
            title: episode.title,
            webpageUrl: episode.webpageUrl,
            sourceUrl: episodeSourceUrl(episode),
            playlistIndex: episodePlaylistIndex(episode),
            durationSec: episode.durationSec,
          }))
          .filter((episode) => episode.webpageUrl || episode.sourceUrl);
        if (!episodes.length) throw new Error(t("ytdlpCatalogNoEpisodes"));

        const data = await adminYtdlpTransfer({
          url: item.webpageUrl,
          target: "r2",
          titleEn: item.title,
          coverUrl: item.coverUrl,
          descriptionEn: item.description,
          sourceTags: composeDramaSourceTags(
            detail.tags || [],
            "真人短剧",
            detail.completion || item.completion || "连载中",
          ),
          lockMode: null,
          autoPublish: autoPublishAfterTransfer,
          formatPreference: formatPreference === "best_hls" ? "best" : formatPreference,
          cookiesFile: cookiesFile.trim() || undefined,
          authBearer: authBearer.trim() || undefined,
          watermarkEnabled: watermark.enabled,
          watermarkX: watermark.x,
          watermarkY: watermark.y,
          watermarkScale: watermark.scale,
          episodes,
        });
        enqueueTransferJob({
          title: item.title,
          dramaId: data.id,
          transferJobId: data.jobId,
          totalEpisodes: data.totalEpisodes,
          publishWhenReady: autoPublishAfterTransfer,
          episodeTitles: episodes.map((episode) => ({
            episodeNumber: episode.episodeNumber,
            title: episode.title,
          })),
        });
        queued += 1;
        setTransferCandidates((prev) => prev.filter((candidate) => candidate.id !== item.id));
      } catch (e: unknown) {
        failures.push(`${item.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    setCatalogBatchBusy(false);
    setCatalogItem(null);
    setCatalogDetailError(null);
    setProbe(null);
    if (failures.length) {
      setError(
        t("ytdlpCatalogBatchPartial", {
          ok: String(queued),
          fail: String(failures.length),
          detail: failures.slice(0, 3).join("；"),
        }),
      );
      setCatalogSyncNotice(null);
    } else {
      setCatalogSyncNotice(t("ytdlpCatalogBatchQueued", { n: String(queued) }));
    }
  }

  function handleCatalogTransferQueued() {
    const currentId = catalogItem?.id;
    if (!currentId) return;
    setTransferCandidates((prev) => prev.filter((item) => item.id !== currentId));
    setCatalogItem(null);
    setCatalogDetailError(null);
    setProbe(null);
  }

  const resolveMut = useMutation({
    mutationFn: async (ep: ProbeResult["episodes"][number]) => {
      const direct = episodeSourceUrl(ep);
      if (direct && isPlayableMediaUrl(direct)) {
        return { playUrl: direct, originalUrl: direct };
      }
      return adminYtdlpResolve({
        url: ep.webpageUrl,
        formatPreference,
        playlistIndex: episodePlaylistIndex(ep),
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

    const unresolved: Array<{ ep: ProbeResult["episodes"][number]; url: string }> = [];
    for (const ep of queue) {
      const existing = episodeSourceUrl(ep);
      if (isPlayableMediaUrl(existing)) {
        ok += 1;
        done += 1;
        continue;
      }
      const pageUrl = (ep.webpageUrl || existing || "").trim();
      if (!pageUrl) {
        fail += 1;
        done += 1;
        fails.push({ index: ep.index, error: "missing url" });
        continue;
      }
      unresolved.push({ ep, url: pageUrl });
    }

    for (let offset = 0; offset < unresolved.length; offset += 20) {
      if (resolveAbortRef.current) break;
      const chunk = unresolved.slice(offset, offset + 20);
      setResolveProgress(
        t("ytdlpResolveBatchProgress", {
          done: String(done),
          total: String(queue.length),
        }) + ` · #${chunk[0]?.ep.index ?? ""}`,
      );
      try {
        const data = await adminYtdlpResolveBatch({
          episodes: chunk.map(({ ep, url }) => ({
            index: ep.index,
            url,
            playlistIndex: episodePlaylistIndex(ep),
          })),
          formatPreference,
          ...authPayload(),
        });
        const resolvedByIndex = new Map(data.resolved.map((item) => [item.index, item]));
        const failedByIndex = new Map(data.failed.map((item) => [item.index, item.error]));
        episodes = episodes.map((row) => {
          const resolved = resolvedByIndex.get(row.index);
          return resolved
            ? {
                ...row,
                sourceUrl: resolved.playUrl,
                candidateCount: Math.max(row.candidateCount || 0, 1),
              }
            : row;
        }) as ProbeResult["episodes"];
        for (const { ep } of chunk) {
          if (resolvedByIndex.has(ep.index)) ok += 1;
          else {
            fail += 1;
            fails.push({ index: ep.index, error: failedByIndex.get(ep.index) || "resolve failed" });
          }
          done += 1;
        }
        setProbe((prev) => {
          if (!prev) return prev;
          const extractor = prev.extractor.includes("+ytdlp")
            ? prev.extractor
            : `${prev.extractor}+ytdlp`;
          return { ...prev, extractor, episodes } as ProbeResult;
        });
      } catch (e: unknown) {
        fail += chunk.length;
        done += chunk.length;
        const error = e instanceof Error ? e.message : String(e);
        fails.push(...chunk.map(({ ep }) => ({ index: ep.index, error })));
      }
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
        provider: "ytdlp",
        formatPreference,
        episodeIndexes: selectedIndexes,
        cookiesFile: auth?.cookiesFile,
        authBearer: auth?.authBearer,
        watermarkEnabled: ingestForm === "r2" ? watermark.enabled : false,
        watermarkX: watermark.x,
        watermarkY: watermark.y,
        watermarkScale: watermark.scale,
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
    catalogDetailMut.isPending ||
    resolveQueueBusy ||
    downloadQueueBusy ||
    resolveMut.isPending ||
    downloadingEpIndex != null ||
    cookieUploadBusy ||
    catalogBatchBusy ||
    catalogUpdateMut.isPending;
  const selectableCatalogItems =
    catalog?.items.filter((item) => !isCatalogItemTransferring(item)) || [];
  const allSelectableCatalogItemsSelected =
    selectableCatalogItems.length > 0 &&
    selectableCatalogItems.every((item) => catalogSelectedIds.includes(item.id));
  const showEmpty =
    !urlLooksTelegram && !catalog && !probe && !error && !aiExtractMut.isPending;
  const selectedCount = selectedIndexes.length;
  const allSelected = !!probe && selectedCount === probe.episodes.length && probe.episodes.length > 0;

  const authSettingsContent = (
    <div className="space-y-3">
      {dedicatedCatalogMode ? (
        <label className="block space-y-1 text-caption text-ink-muted">
          <span>{t("ytdlpSourceUrlLabel")}</span>
          <Input
            value={url}
            disabled={!configured || busy}
            placeholder={t("ytdlpUrlPlaceholder")}
            onChange={(e) => {
              setUrl(e.target.value);
              setApplied(false);
            }}
          />
        </label>
      ) : null}
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
            {cookieUploadBusy ? t("ytdlpAuthUploading") : t("ytdlpAuthUpload")}
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
  );

  const panelClass = embedded
    ? "space-y-3"
    : "upload-panel upload-panel--primary space-y-3";
  const PanelTag = embedded ? "div" : "section";

  return (
    <div className="space-y-4">
      <PanelTag className={panelClass}>
        {ingestTab === "parse" && (configured || dedicatedCatalogMode) ? (
          <div className="flex justify-end gap-2">
            {dedicatedCatalogMode ? (
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line/60 bg-white px-2.5 py-1 text-caption text-ink-muted hover:bg-surface-2"
                onClick={() => setAuthOpen(true)}
                title={authReady ? t("ytdlpAuthReady") : t("ytdlpAuthOptional")}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: authReady
                      ? "var(--color-success)"
                      : "var(--color-ink-subtle)",
                  }}
                  aria-hidden
                />
                {t("ytdlpAuthTitle")}
              </button>
            ) : null}
            {configured ? (
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
            ) : null}
            {dedicatedCatalogMode ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand/30 bg-brand px-3 py-1 text-caption font-medium text-white shadow-sm transition hover:-translate-y-px hover:bg-brand-strong hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!url.trim() || busy || !configured}
                  onClick={() => aiExtractMut.mutate(undefined)}
                >
                  <RefreshCw
                    className={aiExtractMut.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
                    aria-hidden
                  />
                  {aiExtractMut.isPending
                    ? t("ytdlpCatalogRefreshBusy")
                    : t("ytdlpCatalogRefresh")}
                </button>
                {formatRefreshTime(catalogLastRefreshedAt, locale) ? (
                  <span className="text-caption text-ink-subtle">
                    {t("ytdlpLastRefresh", {
                      time: formatRefreshTime(catalogLastRefreshedAt, locale)!,
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {tabsInParent || dedicatedCatalogMode ? null : (
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

            {dedicatedCatalogMode ? (
              <GlassModal
                open={authOpen}
                onClose={() => setAuthOpen(false)}
                title={t("ytdlpAuthTitle")}
                size="md"
              >
                {authSettingsContent}
              </GlassModal>
            ) : (
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
                  {authSettingsContent}
                </div>
              )}
            </div>
            )}

            {dedicatedCatalogMode ? null : (
            <div className="flex flex-wrap items-end gap-2">
              <Input
                className="min-w-[20rem] flex-1"
                placeholder={
                  urlLooksTelegram
                    ? t("telegramUrlPlaceholder")
                    : t("ytdlpUrlPlaceholder")
                }
                value={url}
                disabled={!configured && !telegramReady}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setApplied(false);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !url.trim() || busy) return;
                  if (urlLooksTelegram) {
                    if (telegramReady) setTgProbeRequestKey((k) => k + 1);
                    return;
                  }
                  aiExtractMut.mutate(undefined);
                }}
              />
              {urlLooksTelegram ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!url.trim() || busy || !telegramReady}
                  title={t("telegramProbeHint")}
                  onClick={() => setTgProbeRequestKey((k) => k + 1)}
                >
                  {t("telegramProbe")}
                </Button>
              ) : dedicatedCatalogMode ? null : (
                <Button
                  size="sm"
                  variant={isAiProbe(probe) ? "secondary" : "primary"}
                  className={
                    isAiProbe(probe)
                      ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                      : undefined
                  }
                  disabled={!url.trim() || busy || !configured}
                  title={t("ytdlpAiExtractHint")}
                  onClick={() => aiExtractMut.mutate(undefined)}
                >
                  {aiExtractMut.isPending
                    ? isReelshortCatalogUrl(url)
                      ? t("ytdlpCatalogBusy")
                      : t("ytdlpAiExtractBusy")
                    : catalog
                      ? t("ytdlpCatalogDone")
                    : isAiProbe(probe)
                      ? t("ytdlpAiExtractDone")
                      : t("ytdlpAiExtract")}
                </Button>
              )}
              {url || probe ? (
                <Button size="sm" variant="ghost" onClick={clearUrlInput}>
                  {t("ytdlpClearUrl")}
                </Button>
              ) : null}
            </div>
            )}

            {urlLooksTelegram ? (
              <TelegramImportPanel
                url={url}
                probeRequestKey={tgProbeRequestKey}
                onDirtyChange={onDirtyChange}
                onFillDramaInfo={onFillDramaInfo}
              />
            ) : null}

            {!configured && !telegramReady ? (
              <p className="text-body-sm text-ink-muted">{t("ytdlpNotConfigured")}</p>
            ) : !configured && telegramReady && !urlLooksTelegram ? (
              <p className="text-body-sm text-ink-muted">{t("telegramOnlyReady")}</p>
            ) : null}

            {urlLooksTelegram && !telegramReady ? (
              <p className="text-caption text-warning">
                {telegramStatusQ.data?.enabled
                  ? t("telegramSessionMissing")
                  : t("telegramSidecarMissing")}
              </p>
            ) : null}

            {!dedicatedCatalogMode && showEmpty ? (
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

      {ingestTab === "parse" && !urlLooksTelegram && catalog ? (
        <section className="upload-panel space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-semibold">
                {t("ytdlpCatalogTitle", { title: catalog.title })}
              </h4>
              <p className="text-caption text-ink-muted">
                {t("ytdlpCatalogSummary", {
                  page: String(catalog.page),
                  pages: String(catalog.totalPages),
                  count: String(catalog.items.length),
                  total: String(catalog.totalItems),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {enableCatalogMultiSelect ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !selectableCatalogItems.length}
                    onClick={toggleCatalogPageSelection}
                  >
                    {allSelectableCatalogItemsSelected
                      ? t("ytdlpCatalogClearPage")
                      : t("ytdlpCatalogSelectPage")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={busy || !transferCandidates.length}
                    onClick={() => void queueCatalogCandidates()}
                  >
                    {t("ytdlpCatalogTransfer", {
                      n: String(transferCandidates.length),
                    })}
                  </Button>
                </>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !catalog.prevPageUrl}
                onClick={() => {
                  if (!catalog.prevPageUrl) return;
                  setUrl(catalog.prevPageUrl);
                  aiExtractMut.mutate(catalog.prevPageUrl);
                }}
              >
                {t("ytdlpCatalogPrev")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !catalog.nextPageUrl}
                onClick={() => {
                  if (!catalog.nextPageUrl) return;
                  setUrl(catalog.nextPageUrl);
                  aiExtractMut.mutate(catalog.nextPageUrl);
                }}
              >
                {t("ytdlpCatalogNext")}
              </Button>
            </div>
          </div>

          {enableCatalogMultiSelect && transferCandidates.length ? (
            <div className="rounded-xl border border-brand/25 bg-brand-soft/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <h5 className="text-body-sm font-semibold text-ink">
                    {t("ytdlpCatalogCandidateTitle")}
                  </h5>
                  <span className="text-caption text-ink-muted">
                    {t("ytdlpCatalogCandidateCount", {
                      n: String(transferCandidates.length),
                    })}
                  </span>
                </div>
                <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-caption text-ink">
                  <input
                    type="checkbox"
                    checked={autoPublishAfterTransfer}
                    disabled={busy || catalogBatchBusy}
                    onChange={(event) => setAutoPublishAfterTransfer(event.target.checked)}
                  />
                  <span>{t("submitChoiceGoPublic")}</span>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {transferCandidates.map((item) => (
                  <div
                    key={item.id}
                    className="inline-flex w-44 max-w-full items-center overflow-hidden rounded-lg border border-line/70 bg-white"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-caption font-medium text-ink hover:text-brand"
                      title={item.title}
                      disabled={busy}
                      onClick={() => openCatalogDrama(item)}
                    >
                      {item.title}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 border-l border-line/70 px-2 py-1.5 text-caption text-ink-muted hover:bg-danger-soft hover:text-danger"
                      aria-label={t("ytdlpCatalogRemoveCandidate", {
                        title: item.title,
                      })}
                      onClick={() =>
                        setTransferCandidates((prev) =>
                          prev.filter((candidate) => candidate.id !== item.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {catalogSyncNotice ? (
            <p className="rounded-lg border border-success/25 bg-success-soft px-3 py-2 text-body-sm text-success">
              {catalogSyncNotice}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {catalog.items.map((item) => {
              const selected = catalogSelectedIds.includes(item.id);
              const transferring = isCatalogItemTransferring(item);
              const transferProgress = catalogItemTransferProgress(item);
              const staged = transferCandidates.some(
                (candidate) => candidate.id === item.id,
              );
              return (
              <article
                key={item.id}
                className={[
                  "relative flex min-w-0 gap-3 overflow-hidden rounded-xl border bg-surface-1 p-3 text-left transition",
                  transferring
                    ? "border-success/45 ring-1 ring-success/15"
                    : selected
                      ? "border-brand ring-1 ring-brand/20 hover:border-brand/50 hover:bg-surface-2"
                      : "border-line/70 hover:border-brand/40 hover:bg-surface-2",
                ].join(" ")}
              >
                {transferring ? (
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-success-soft/70 transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.max(2, transferProgress)}%` }}
                    aria-hidden
                  />
                ) : null}
                {enableCatalogMultiSelect ? (
                  <label
                    className={[
                      "absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-caption shadow-sm",
                      transferring
                        ? "cursor-not-allowed text-ink-subtle opacity-80"
                        : "cursor-pointer text-ink-muted",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={busy || transferring}
                      onChange={() => toggleCatalogDrama(item)}
                    />
                    {transferring
                      ? t("ytdlpCatalogTransferring")
                      : staged
                      ? t("ytdlpCatalogCandidateAdded")
                      : t("ytdlpCatalogSelect")}
                  </label>
                ) : null}
                <button
                  type="button"
                  className="relative z-[1] flex min-w-0 flex-1 gap-3 text-left disabled:opacity-60"
                  disabled={busy}
                  onClick={() => openCatalogDrama(item)}
                >
                  {item.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.coverUrl}
                      alt=""
                      className="h-24 w-16 shrink-0 rounded-lg object-cover"
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col pr-20">
                    <h5 className="line-clamp-2 text-body-sm font-semibold">
                      {item.title}
                    </h5>
                    {item.completion || transferring || item.synced ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption">
                        {item.completion ? (
                          <span
                            className={[
                              "rounded-full px-2 py-0.5 font-medium",
                              item.completion === "已完结"
                                ? "border border-line bg-panel text-ink-muted"
                                : "bg-brand-soft text-brand",
                            ].join(" ")}
                          >
                            {item.completion === "已完结"
                              ? t("completionFinished")
                              : t("completionOngoing")}
                          </span>
                        ) : null}
                        {transferring ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 font-medium text-success">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                            {t("ytdlpCatalogTransferring")} {transferProgress}%
                          </span>
                        ) : item.synced ? (
                          <span className="rounded-full bg-success-soft px-2 py-0.5 font-medium text-success">
                            {t("ytdlpCatalogSynced")}
                          </span>
                        ) : null}
                        {!transferring && item.synced && item.syncedEpisodes ? (
                          <span className="text-ink-subtle">
                            {t("ytdlpCatalogSyncedEpisodes", {
                              n: String(item.syncedEpisodes),
                            })}
                          </span>
                        ) : null}
                        {!transferring && item.synced && item.updateAvailable ? (
                          <span className="rounded-full bg-warning-soft px-2 py-0.5 font-medium text-warning">
                            {t("ytdlpCatalogUpdateAvailable")}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {item.chapterCount ? (
                      <p className="text-caption text-ink-subtle">
                        {t("importEpisodeCount", { n: item.chapterCount })}
                      </p>
                    ) : null}
                    {item.description ? (
                      <p className="mt-1 line-clamp-2 text-caption text-ink-muted">
                        {item.description}
                      </p>
                    ) : null}
                    <span className="mt-auto pt-2 text-caption font-medium text-brand">
                      {catalogCardsOpenEditor
                        ? t("ytdlpCatalogConfigureDrama")
                        : t("ytdlpCatalogViewEpisodes")}
                    </span>
                  </div>
                </button>
                {!transferring && item.synced && item.completion === "连载中" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="absolute bottom-3 right-3 z-10 h-8 px-2 text-caption"
                    disabled={busy || catalogUpdateMut.isPending}
                    onClick={() => catalogUpdateMut.mutate(item)}
                  >
                    {catalogUpdateMut.isPending &&
                    catalogUpdateMut.variables?.id === item.id
                      ? t("ytdlpCatalogCheckingUpdate")
                      : t("ytdlpCatalogCheckUpdate")}
                  </Button>
                ) : null}
              </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {ingestTab === "parse" && error ? (
        <p className="text-body-sm text-danger">{error}</p>
      ) : null}

      {ingestTab === "parse" && !urlLooksTelegram && !catalog && probe ? (
        <div className="upload-panel space-y-4">
          <div className="flex flex-wrap gap-3">
            {"coverUrl" in probe && probe.coverUrl ? (
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
                {isAiProbe(probe) &&
                Array.isArray(probe.tags) &&
                probe.tags.length
                  ? ` · ${t("dramaTags")}: ${probe.tags.slice(0, 4).join(", ")}`
                  : null}
              </p>
              {isAiProbe(probe) && probe.notes ? (
                <p className="mt-1 text-caption text-ink-subtle">
                  {t("ytdlpAiNotes")}: {probe.notes}
                </p>
              ) : null}
              {"description" in probe && probe.description ? (
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
                              !ffmpegReady
                                ? t("ytdlpNeedFfmpeg")
                                : t("ytdlpBrowserDownloadHint")
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
                        if (key === "link") setWatermark(DEFAULT_PLACEMENT);
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

            {ingestForm === "r2" ? (
              <div className="space-y-2">
                {watermarkFrameBusy ? (
                  <p className="text-caption text-ink-muted">{t("watermarkLoadingFrame")}</p>
                ) : null}
                <WatermarkPositionEditor
                  frameUrl={watermarkFrame?.url || null}
                  frameWidth={watermarkFrame?.width}
                  frameHeight={watermarkFrame?.height}
                  value={watermark}
                  busy={busy || watermarkFrameBusy}
                  onChange={(next) => {
                    setWatermark(next);
                    setApplied(false);
                  }}
                />
              </div>
            ) : null}

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
        open={!!catalogItem}
        onClose={() => {
          setCatalogItem(null);
          setCatalogDetailError(null);
          setProbe(null);
        }}
        size="xl"
        title={catalogItem?.title || t("ytdlpCatalogEpisodeModalTitle")}
      >
        {catalogDetailMut.isPending && !probe ? (
          <div className="py-10 text-center text-body-sm text-ink-muted">
            {t("ytdlpCatalogEpisodeLoading")}
          </div>
        ) : catalogDetailError && !probe ? (
          <p className="rounded-lg bg-danger-soft p-3 text-body-sm text-danger">
            {catalogDetailError}
          </p>
        ) : probe && catalogItem && catalogCardsOpenEditor ? (
          <div className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              {catalogDetailError ? (
                <p className="mr-auto text-caption text-danger">
                  {catalogDetailError}
                </p>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={catalogDetailMut.isPending}
                onClick={refreshCatalogDrama}
              >
                <RefreshCw
                  className={
                    catalogDetailMut.isPending
                      ? "h-3.5 w-3.5 animate-spin"
                      : "h-3.5 w-3.5"
                  }
                  aria-hidden
                />
                {catalogDetailMut.isPending
                  ? t("ytdlpCatalogRefreshBusy")
                  : t("ytdlpCatalogRefreshDrama")}
              </Button>
              {formatRefreshTime(catalogDetailLastRefreshedAt, locale) ? (
                <span className="text-caption text-ink-subtle">
                  {t("ytdlpLastRefresh", {
                    time: formatRefreshTime(catalogDetailLastRefreshedAt, locale)!,
                  })}
                </span>
              ) : null}
            </div>
            <CatalogDramaEditor
              key={catalogItem.id}
              item={catalogItem}
              probe={probe}
              ingestForm={ingestForm}
              formatPreference={formatPreference}
              cookiesFile={cookiesFile.trim() || undefined}
              authBearer={authBearer.trim() || undefined}
              watermark={watermark}
              onTransferQueued={handleCatalogTransferQueued}
            />
          </div>
        ) : probe && catalogItem ? (
          <div className="space-y-4">
            <div className="flex gap-3">
              {"coverUrl" in probe && probe.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={probe.coverUrl}
                  alt=""
                  className="h-28 w-20 shrink-0 rounded-lg object-cover"
                />
              ) : catalogItem.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={catalogItem.coverUrl}
                  alt=""
                  className="h-28 w-20 shrink-0 rounded-lg object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <h4 className="font-semibold">{probe.title}</h4>
                <p className="text-caption text-ink-muted">
                  {t("importEpisodeCount", { n: probe.episodes.length })}
                </p>
                {"description" in probe && probe.description ? (
                  <p className="mt-2 line-clamp-3 text-body-sm text-ink-muted">
                    {probe.description}
                  </p>
                ) : null}
              </div>
            </div>

            <div>
              <h5 className="mb-2 text-body-sm font-medium">
                {t("ytdlpCatalogEpisodeModalTitle")}
              </h5>
              <div className="grid max-h-[24rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {probe.episodes.map((ep) => (
                  <div
                    key={`${ep.index}:${ep.id}`}
                    className="flex min-w-0 items-center gap-3 rounded-lg border border-line/70 bg-surface-1 px-3 py-2.5"
                  >
                    <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft px-1 text-caption font-semibold text-brand">
                      {ep.index}
                    </span>
                    <span className="min-w-0 truncate text-body-sm" title={ep.title}>
                      {ep.title || `EP${ep.index}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line/60 pt-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCatalogItem(null);
                  setCatalogDetailError(null);
                  setProbe(null);
                }}
              >
                {t("close")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setUrl(catalogItem.webpageUrl);
                  setCatalog(null);
                  setCatalogItem(null);
                  setCatalogDetailError(null);
                }}
              >
                {t("ytdlpCatalogUseDrama")}
              </Button>
            </div>
          </div>
        ) : null}
      </GlassModal>

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
            poster={
              probe && "coverUrl" in probe ? probe.coverUrl || undefined : undefined
            }
            failHint={t("ytdlpPreviewCorsFail")}
            className="aspect-video w-full overflow-hidden rounded-lg bg-black"
          />
        ) : null}
      </GlassModal>
    </div>
  );
}
