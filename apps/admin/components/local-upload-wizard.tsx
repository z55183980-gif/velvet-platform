"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateEpisodeWithUploadSmart,
  adminCreateUploadDrama,
  adminGetDrama,
  adminListCategories,
  adminListDramas,
  adminLocalImport,
  adminStorageStatus,
  adminUploadImage,
  asRows,
} from "@velvet/api-client";
import { Button, Input, Select, cn } from "@velvet/ui";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Cloud,
  HardDrive,
  LoaderCircle,
  Film,
  Server,
  Trash2,
  Upload,
} from "lucide-react";
import { DramaCoverField } from "@/components/drama-cover-field";
import { captureVideoFirstFrame } from "@/lib/capture-video-frame";
import { contentDetailHref } from "@/lib/content-href";
import { useI18n, statusLabel } from "@/lib/i18n";

type Category = { slug: string; nameZh?: string; nameEn?: string };
type DramaTarget = "new" | "existing";
type SourceMode = "files" | "server";
type ProgressStatus = "pending" | "uploading" | "done" | "error";
type ThumbStatus = "pending" | "ready" | "error";
type EpisodeDraft = {
  id: string;
  file: File;
  title: string;
  /** Local object URL for card preview (revoked on remove). */
  thumbPreviewUrl?: string;
  /** Uploaded `/api/v1/media/...` path for create-episode. */
  thumbnailUrl?: string;
  thumbStatus?: ThumbStatus;
};
type DramaOption = {
  id: string | number;
  titleZh?: string;
  titleEn?: string;
  slug?: string;
  status?: string;
  sourceType?: string;
  _count?: { episodes?: number };
  totalEpisodes?: number;
};
type ExistingDrama = {
  id: string | number;
  titleZh?: string;
  titleEn?: string;
  slug?: string;
  status?: string;
  freeEpisodeCount?: number;
  lockMode?: string | null;
  episodes?: Array<{ episodeNumber: number; isFree?: boolean; priceCredits?: number | string }>;
};
type ImportItem = {
  folder?: string;
  slug?: string;
  titleZh?: string;
  action?: string;
  dramaId?: string;
  episodes?: number;
  reason?: string;
  fromEpisode?: number;
  toEpisode?: number;
};
type ImportResult = {
  scanned?: number;
  imported?: number;
  skipped?: number;
  errors?: unknown[];
  items?: ImportItem[];
  hint?: string;
  dryRun?: boolean;
};

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

function isVideoFile(f: File) {
  return /\.(mp4|mov|mkv|webm|m4v)$/i.test(f.name) || f.type.startsWith("video/");
}

function defaultEpisodeTitle(name: string) {
  return name.replace(/\.[^.]+$/, "") || name;
}

function makeEpisodeId(file: File) {
  return `${fileKey(file)}-${Math.random().toString(36).slice(2, 9)}`;
}

function sortVideoFiles(list: File[]) {
  return [...list].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function dramaLabel(d: { titleZh?: string; titleEn?: string; slug?: string }) {
  return d.titleZh || d.titleEn || d.slug || "—";
}

function UploadSplitButton({
  busy,
  mainLabel,
  folderLabel,
  onPickFiles,
  onPickFolder,
}: {
  busy?: boolean;
  mainLabel: string;
  folderLabel: string;
  onPickFiles: () => void;
  onPickFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="upload-split" ref={rootRef}>
      <div className="upload-split__group">
        <button
          type="button"
          className="upload-split__main"
          disabled={busy}
          onClick={onPickFiles}
        >
          {mainLabel}
        </button>
        <button
          type="button"
          className="upload-split__caret"
          disabled={busy}
          aria-label={folderLabel}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {open ? (
        <div className="upload-split__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="upload-split__item"
            onClick={() => {
              setOpen(false);
              onPickFiles();
            }}
          >
            {mainLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            className="upload-split__item"
            onClick={() => {
              setOpen(false);
              onPickFolder();
            }}
          >
            {folderLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function LocalUploadWizard() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const [dramaTarget, setDramaTarget] = useState<DramaTarget>("new");
  const [existingDramaId, setExistingDramaId] = useState("");
  const [dramaSearch, setDramaSearch] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("files");
  const [titleZh, setTitleZh] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [descriptionZh, setDescriptionZh] = useState("");
  const [isFree, setIsFree] = useState(true);
  const [priceCredits, setPriceCredits] = useState(10);
  const [freeEpisodeCount, setFreeEpisodeCount] = useState(3);
  const [episodes, setEpisodes] = useState<EpisodeDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<Record<string, { status: ProgressStatus; error?: string }>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const episodesRef = useRef(episodes);
  episodesRef.current = episodes;

  useEffect(() => {
    return () => {
      for (const ep of episodesRef.current) {
        if (ep.thumbPreviewUrl) URL.revokeObjectURL(ep.thumbPreviewUrl);
      }
    };
  }, []);

  const isExisting = dramaTarget === "existing";

  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Category[]>,
    enabled: !isExisting,
  });
  const storageQ = useQuery({
    queryKey: ["admin", "storage-status"],
    queryFn: () => adminStorageStatus(),
  });
  const dramasQ = useQuery({
    queryKey: ["admin", "dramas", "picker", dramaSearch],
    queryFn: async () => {
      const data = await adminListDramas({
        q: dramaSearch.trim() || undefined,
        status: "ALL",
        sort: "latest",
        page: 1,
        pageSize: 50,
      });
      return asRows<DramaOption>(data as never);
    },
    enabled: isExisting,
  });
  const existingDramaQ = useQuery({
    queryKey: ["admin", "drama", existingDramaId],
    queryFn: () => adminGetDrama(existingDramaId) as Promise<ExistingDrama>,
    enabled: isExisting && !!existingDramaId,
  });

  const existingDrama = existingDramaQ.data;
  const maxExistingEp = useMemo(() => {
    const eps = existingDrama?.episodes ?? [];
    if (!eps.length) return 0;
    return Math.max(...eps.map((e) => e.episodeNumber || 0));
  }, [existingDrama]);
  const existingPaidCredits = useMemo(() => {
    const paid = (existingDrama?.episodes ?? []).find((e) => !e.isFree);
    const n = paid?.priceCredits != null ? Number(paid.priceCredits) : 10;
    return Number.isFinite(n) && n > 0 ? n : 10;
  }, [existingDrama]);

  const totalBytes = useMemo(() => episodes.reduce((s, ep) => s + ep.file.size, 0), [episodes]);
  const r2Enabled = !!storageQ.data?.r2Enabled;
  const r2DirectUpload =
    !!storageQ.data?.r2DirectUpload || !!storageQ.data?.r2Configured;
  const ffmpegReady = !!storageQ.data?.ffmpegReady;
  const freeCap = isFree ? episodes.length : Math.max(0, freeEpisodeCount);

  const fileBlockReason = useMemo(() => {
    if (storageQ.isLoading) return t("loading");
    if (!ffmpegReady) return t("uploadBlockFfmpeg");
    if (isExisting) {
      if (!existingDramaId) return t("localWizardPickDrama");
      if (existingDramaQ.isLoading) return t("loading");
      if (existingDramaQ.isError) return t("localWizardDramaLoadFail");
    } else {
      if (!titleZh.trim()) return t("uploadBlockTitle");
      if (!categorySlug) return t("uploadBlockCategory");
    }
    if (!episodes.length) return t("uploadBlockFiles");
    return null;
  }, [
    storageQ.isLoading,
    ffmpegReady,
    isExisting,
    existingDramaId,
    existingDramaQ.isLoading,
    existingDramaQ.isError,
    titleZh,
    categorySlug,
    episodes.length,
    t,
  ]);

  function episodeIsFreeForUpload(episodeNumber: number, indexInBatch: number) {
    if (isExisting && existingDrama) {
      const mode = existingDrama.lockMode || "FREE_FIRST_N";
      if (mode === "ALL_FREE") return true;
      if (mode === "VIP_ALL") return false;
      return episodeNumber <= Math.max(0, existingDrama.freeEpisodeCount ?? 0);
    }
    return isFree || indexInBatch < freeCap;
  }

  function revokeThumbPreview(url?: string) {
    if (url) URL.revokeObjectURL(url);
  }

  /** Capture first frame → local preview + upload thumbnail URL (silent on failure). */
  async function hydrateEpisodeThumb(id: string, file: File) {
    try {
      const blob = await captureVideoFirstFrame(file);
      const preview = URL.createObjectURL(blob);
      let kept = false;
      setEpisodes((prev) => {
        const idx = prev.findIndex((ep) => ep.id === id);
        if (idx < 0) {
          URL.revokeObjectURL(preview);
          return prev;
        }
        kept = true;
        const next = [...prev];
        revokeThumbPreview(next[idx].thumbPreviewUrl);
        // Preview is enough to leave the spinner; upload can finish after.
        next[idx] = { ...next[idx], thumbPreviewUrl: preview, thumbStatus: "ready" };
        return next;
      });
      if (!kept) return;

      const base = file.name.replace(/\.[^.]+$/, "") || "episode";
      const saved = await adminUploadImage(blob, {
        kind: "thumbnail",
        filename: `${base}-thumb.jpg`,
      });
      setEpisodes((prev) => {
        const idx = prev.findIndex((ep) => ep.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          thumbnailUrl: saved.url,
          thumbStatus: "ready",
        };
        return next;
      });
    } catch {
      setEpisodes((prev) => {
        const idx = prev.findIndex((ep) => ep.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        // Keep any local preview if capture succeeded but later steps failed.
        next[idx] = { ...next[idx], thumbStatus: "error" };
        return next;
      });
    }
  }

  function addFiles(list: File[]): number {
    const videos = sortVideoFiles(list.filter(isVideoFile));
    if (!videos.length) return 0;
    let incoming: EpisodeDraft[] = [];
    setEpisodes((prev) => {
      const known = new Set(prev.map((ep) => fileKey(ep.file)));
      incoming = videos
        .filter((f) => !known.has(fileKey(f)))
        .map((file) => ({
          id: makeEpisodeId(file),
          file,
          title: defaultEpisodeTitle(file.name),
          thumbStatus: "pending" as const,
        }));
      return incoming.length ? [...prev, ...incoming] : prev;
    });
    for (const ep of incoming) {
      void hydrateEpisodeThumb(ep.id, ep.file);
    }
    setError(null);
    setImportResult(null);
    return incoming.length;
  }

  function ingestPickedFiles(list: FileList | File[] | null | undefined, fromFolder: boolean) {
    const files = Array.from(list || []);
    if (!files.length) return;
    const added = addFiles(files);
    if (fromFolder && added === 0) {
      const hadAny = files.length > 0;
      const hadVideo = files.some(isVideoFile);
      setError(
        hadAny && !hadVideo
          ? t("localWizardFolderNoVideos")
          : hadVideo
            ? t("localWizardFolderAllDup")
            : null,
      );
    }
  }

  function moveEpisode(id: string, dir: -1 | 1) {
    setEpisodes((prev) => {
      const idx = prev.findIndex((ep) => ep.id === id);
      const nextIdx = idx + dir;
      if (idx < 0 || nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(idx, 1);
      next.splice(nextIdx, 0, row);
      return next;
    });
  }

  function updateEpisodeTitle(id: string, title: string) {
    setEpisodes((prev) => prev.map((ep) => (ep.id === id ? { ...ep, title } : ep)));
  }

  function removeEpisode(id: string) {
    setEpisodes((prev) => {
      const doomed = prev.find((ep) => ep.id === id);
      revokeThumbPreview(doomed?.thumbPreviewUrl);
      return prev.filter((ep) => ep.id !== id);
    });
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    setProgress((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAllEpisodes() {
    setSelectedIds(episodes.map((ep) => ep.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function removeSelectedEpisodes() {
    if (!selectedIds.length) return;
    const drop = new Set(selectedIds);
    setEpisodes((prev) => {
      for (const ep of prev) {
        if (drop.has(ep.id)) revokeThumbPreview(ep.thumbPreviewUrl);
      }
      return prev.filter((ep) => !drop.has(ep.id));
    });
    setProgress((prev) => {
      const next = { ...prev };
      for (const id of drop) delete next[id];
      return next;
    });
    setSelectedIds([]);
  }

  function clearAllEpisodes() {
    setEpisodes((prev) => {
      for (const ep of prev) revokeThumbPreview(ep.thumbPreviewUrl);
      return [];
    });
    setProgress({});
    setSelectedIds([]);
  }

  function afterImportSuccess(data: ImportResult) {
    setImportResult(data);
    setError(null);
    if (data.dryRun) return;
    void qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    const firstId =
      (data.items ?? []).find(
        (item) =>
          (item.action === "imported" || item.action === "appended") && item.dramaId,
      )?.dramaId || (isExisting ? existingDramaId : undefined);
    if (firstId && (data.imported ?? 0) > 0) {
      router.push(contentDetailHref(firstId, "episodes"));
      return;
    }
    router.push("/content?status=DRAFT");
  }

  async function resolveThumbnailUrl(ep: EpisodeDraft): Promise<string | undefined> {
    const read = () => episodesRef.current.find((e) => e.id === ep.id);
    let cur = read() ?? ep;
    if (cur.thumbnailUrl) return cur.thumbnailUrl;

    const stillWorking = () => {
      const c = read();
      if (!c) return false;
      if (c.thumbnailUrl) return false;
      if (c.thumbStatus === "error") return false;
      // Capturing, or captured and upload still in flight.
      return c.thumbStatus === "pending" || !!c.thumbPreviewUrl;
    };

    if (stillWorking()) {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && stillWorking()) {
        await new Promise((r) => setTimeout(r, 250));
        cur = read() ?? cur;
        if (cur.thumbnailUrl) return cur.thumbnailUrl;
      }
    }
    return read()?.thumbnailUrl;
  }

  async function uploadSequential(
    dramaId: string,
    targets: EpisodeDraft[],
    startEpisodeNumber: number,
  ) {
    for (let i = 0; i < targets.length; i++) {
      const ep = targets[i];
      const episodeNumber = startEpisodeNumber + i;
      const episodeIsFree = episodeIsFreeForUpload(episodeNumber, i);
      const credits = isExisting ? existingPaidCredits : priceCredits;
      setProgress((prev) => ({
        ...prev,
        [ep.id]: { status: "uploading", error: undefined },
      }));
      try {
        const thumbnailUrl = await resolveThumbnailUrl(ep);
        await adminCreateEpisodeWithUploadSmart(dramaId, ep.file, {
          title: ep.title.trim() || defaultEpisodeTitle(ep.file.name),
          episodeNumber,
          isFree: episodeIsFree,
          priceCredits: episodeIsFree ? 0 : credits,
          thumbnailUrl,
          preferDirect: r2DirectUpload,
        });
        setProgress((prev) => ({ ...prev, [ep.id]: { status: "done" } }));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setProgress((prev) => ({
          ...prev,
          [ep.id]: { status: "error", error: message },
        }));
        throw e;
      }
    }
  }

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (fileBlockReason) throw new Error(fileBlockReason);
      setProgress(
        Object.fromEntries(episodes.map((ep) => [ep.id, { status: "pending" as const }])),
      );

      if (isExisting) {
        const start = maxExistingEp + 1;
        await uploadSequential(existingDramaId, episodes, start);
        return { id: existingDramaId, totalEpisodes: episodes.length };
      }

      const meta = {
        titleZh: titleZh.trim(),
        categorySlug,
        coverUrl: coverUrl.trim() || undefined,
        descriptionZh: descriptionZh.trim() || undefined,
        freeEpisodeCount: isFree ? episodes.length : freeCap,
        lockMode: (isFree ? "ALL_FREE" : "FREE_FIRST_N") as "ALL_FREE" | "FREE_FIRST_N",
        status: "DRAFT" as const,
        isFree,
        priceCredits: isFree ? 0 : priceCredits,
      };
      const drama = await adminCreateUploadDrama(meta);
      await uploadSequential(drama.id, episodes, 1);
      return { id: drama.id, totalEpisodes: episodes.length };
    },
    onSuccess: async (data) => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
      router.push(contentDetailHref(data.id, "episodes"));
    },
    onError: (e: Error) => setError(e.message),
  });

  const serverMut = useMutation({
    mutationFn: (dryRun: boolean) => {
      if (isExisting && !existingDramaId) throw new Error(t("localWizardPickDrama"));
      return adminLocalImport(
        rootPath.trim() || undefined,
        dryRun,
        isExisting ? existingDramaId : undefined,
      ) as Promise<ImportResult>;
    },
    onSuccess: afterImportSuccess,
    onError: (e: Error) => setError(e.message),
  });

  const busy = uploadMut.isPending || serverMut.isPending;
  const progressRows = Object.values(progress);
  const doneCount = progressRows.filter((p) => p.status === "done").length;
  const startEpPreview = isExisting ? maxExistingEp + 1 : 1;

  const pickFiles = () => fileRef.current?.click();
  const pickFolder = () => folderRef.current?.click();
  const splitUploadBtn = (
    <UploadSplitButton
      busy={busy}
      mainLabel={t("uploadFileBtn")}
      folderLabel={t("uploadFolderBtn")}
      onPickFiles={pickFiles}
      onPickFolder={pickFolder}
    />
  );

  return (
    <div className="space-y-4">
      <p className="text-body-sm text-ink-muted">{t("localWizardHint")}</p>

      {error ? (
        <div className="content-inline-error">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="upload-panel space-y-3">
        <div className="upload-panel__head">
          <div>
            <h2>{t("localWizardTargetTitle")}</h2>
            <p>{t("localWizardTargetHint")}</p>
          </div>
        </div>
        <div className="seg-tabs w-full sm:w-auto" role="tablist" aria-label={t("localWizardTargetTitle")}>
          {(
            [
              ["new", t("localWizardTargetNew")],
              ["existing", t("localWizardTargetExisting")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={dramaTarget === key}
              className="seg-tabs__item"
              disabled={busy}
              onClick={() => {
                setDramaTarget(key);
                setError(null);
                setImportResult(null);
                if (key === "new") setExistingDramaId("");
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {isExisting ? (
          <div className="space-y-3">
            <label className="upload-field max-w-lg">
              <span>{t("localWizardSearchDrama")}</span>
              <Input
                value={dramaSearch}
                disabled={busy}
                placeholder={t("localWizardSearchDramaPh")}
                onChange={(e) => setDramaSearch(e.target.value)}
              />
            </label>
            <label className="upload-field max-w-xl">
              <span>{t("localWizardSelectDrama")}</span>
              <Select
                value={existingDramaId}
                disabled={busy || dramasQ.isLoading}
                onChange={(e) => {
                  setExistingDramaId(e.target.value);
                  setError(null);
                  setImportResult(null);
                }}
              >
                <option value="">{t("localWizardSelectDramaPh")}</option>
                {(dramasQ.data ?? []).map((d) => (
                  <option key={String(d.id)} value={String(d.id)}>
                    {dramaLabel(d)}
                    {d.status ? ` · ${statusLabel(t, d.status)}` : ""}
                    {` · ${d._count?.episodes ?? d.totalEpisodes ?? 0}${t("localWizardEpSuffix")}`}
                  </option>
                ))}
              </Select>
            </label>
            {existingDramaId && existingDrama ? (
              <p className="text-caption text-ink-muted">
                {t("localWizardExistingSummary", {
                  title: dramaLabel(existingDrama),
                  n: existingDrama.episodes?.length ?? maxExistingEp,
                  next: maxExistingEp + 1,
                })}
              </p>
            ) : null}
            {isExisting ? (
              <p className="text-caption text-ink-subtle">{t("localWizardExistingSourceNote")}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="upload-panel space-y-3">
        <div className="upload-panel__head">
          <div>
            <h2>{t("localWizardStorageTitle")}</h2>
            <p>{t("localWizardStorageHint")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={cn("upload-status-pill", r2Enabled ? "is-ok" : "is-muted")}>
            {r2Enabled ? <Cloud className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}
            {r2Enabled ? t("uploadR2CdnNote") : t("uploadR2LocalNote")}
          </span>
          {r2DirectUpload ? (
            <span className="upload-status-pill is-ok">{t("uploadR2DirectNote")}</span>
          ) : null}
          <span className={cn("upload-status-pill", ffmpegReady ? "is-ok" : "is-warn")}>
            {ffmpegReady ? t("ffmpegReady") : t("ffmpegMissing")}
          </span>
          {storageQ.data?.mediaBucket ? (
            <span className="upload-status-pill is-muted">
              {storageQ.data.storageBackend} · {storageQ.data.mediaBucket}
            </span>
          ) : null}
        </div>
        {!r2Enabled && !storageQ.isLoading ? (
          <p className="text-caption text-ink-muted">{t("uploadR2NotEnabledHint")}</p>
        ) : null}
        {r2DirectUpload ? (
          <p className="text-caption text-ink-muted">{t("uploadR2DirectHint")}</p>
        ) : (
          <p className="text-caption text-ink-muted">{t("uploadProxyFallbackHint")}</p>
        )}
      </section>

      <section className="upload-panel space-y-4">
        <div className="upload-panel__head">
          <div>
            <h2>{t("localWizardVideosTitle")}</h2>
            <p>
              {isExisting ? t("localWizardVideosHintExisting") : t("localWizardVideosHint")}
            </p>
          </div>
        </div>

        <div className="seg-tabs w-full sm:w-auto" role="tablist" aria-label={t("localWizardSourceModes")}>
          {(
            [
              ["files", t("localWizardModeFiles"), Upload],
              ["server", t("localWizardModeServer"), Server],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={sourceMode === key}
              className="seg-tabs__item inline-flex items-center gap-1.5"
              disabled={busy}
              onClick={() => {
                setSourceMode(key);
                setError(null);
                setImportResult(null);
              }}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {sourceMode === "files" ? (
          <div className="space-y-3">
            <p className="text-body-sm text-ink-muted">
              {isExisting ? t("localWizardFilesLeadExisting") : t("localWizardFilesLead")}
            </p>

            <input
              ref={fileRef}
              type="file"
              accept={VIDEO_ACCEPT}
              multiple
              className="sr-only"
              onChange={(e) => {
                ingestPickedFiles(e.target.files, false);
                e.target.value = "";
              }}
            />
            <input
              ref={folderRef}
              type="file"
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              directory=""
              multiple
              className="sr-only"
              onChange={(e) => {
                ingestPickedFiles(e.target.files, true);
                e.target.value = "";
              }}
            />

            {!episodes.length ? (
              <div
                className={cn("local-source-zone", dragOver && "local-source-zone--active")}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  ingestPickedFiles(e.dataTransfer.files, false);
                }}
              >
                <Upload className="local-source-zone__icon" />
                <p className="local-source-zone__title">
                  {dragOver ? t("uploadDropActive") : t("uploadNoFiles")}
                </p>
                <p className="local-source-zone__hint">{t("uploadVideosHint")}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">{splitUploadBtn}</div>
              </div>
            ) : (
              <div
                className={cn("ep-card-board", dragOver && "ep-card-board--active")}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  ingestPickedFiles(e.dataTransfer.files, false);
                }}
              >
                <div className="ep-card-board__toolbar">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{t("localWizardEpisodeListTitle")}</p>
                    <p className="text-caption text-ink-muted">
                      {t("uploadFilesSummary", { n: episodes.length, size: fmtSize(totalBytes) })}
                      {" · "}
                      {isExisting
                        ? t("localWizardEpisodeOrderHintExisting", { start: startEpPreview })
                        : t("localWizardEpisodeOrderHint")}
                      {selectedIds.length
                        ? ` · ${t("epCardSelected", { n: selectedIds.length })}`
                        : ""}
                    </p>
                  </div>
                  <div className="ep-card-board__toolbar-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        selectedIds.length === episodes.length ? clearSelection() : selectAllEpisodes()
                      }
                    >
                      {selectedIds.length === episodes.length
                        ? t("epCardDeselectAll")
                        : t("epCardSelectAll")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !selectedIds.length}
                      onClick={removeSelectedEpisodes}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("epCardDeleteSelected")}
                    </Button>
                    {splitUploadBtn}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={clearAllEpisodes}>
                      {t("uploadClearFiles")}
                    </Button>
                  </div>
                </div>

                <div className="ep-card-grid">
                  {episodes.map((ep, i) => {
                    const row = progress[ep.id];
                    const epNum = startEpPreview + i;
                    const episodeIsFree = episodeIsFreeForUpload(epNum, i);
                    const selected = selectedIds.includes(ep.id);
                    return (
                      <div
                        key={ep.id}
                        className={cn("ep-card", selected && "ep-card--selected", row?.status === "error" && "ep-card--error")}
                      >
                        <label className="ep-card__check">
                          <input
                            type="checkbox"
                            className="content-checkbox"
                            checked={selected}
                            disabled={busy}
                            onChange={() => toggleSelect(ep.id)}
                            aria-label={t("epCardSelectOne", { n: epNum })}
                          />
                        </label>
                        <div className="ep-card__visual">
                          {ep.thumbPreviewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={ep.thumbPreviewUrl}
                              alt=""
                              className="ep-card__thumb"
                            />
                          ) : ep.thumbStatus === "pending" ? (
                            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
                          ) : (
                            <Film className="h-5 w-5" aria-hidden />
                          )}
                          <span className="ep-card__badge">#{epNum}</span>
                        </div>
                        <Input
                          className="ep-card__title"
                          value={ep.title}
                          disabled={busy}
                          aria-label={t("onlineEpisodeTitle")}
                          placeholder={t("onlineEpisodeTitle")}
                          onChange={(e) => updateEpisodeTitle(ep.id, e.target.value)}
                        />
                        <p className="ep-card__meta truncate" title={ep.file.name}>
                          {fmtSize(ep.file.size)}
                          {(!isExisting && !isFree) ||
                          (isExisting && existingDrama?.lockMode !== "ALL_FREE") ? (
                            <span className={cn("ep-card__pay", episodeIsFree && "is-free")}>
                              {episodeIsFree
                                ? t("free")
                                : `${isExisting ? existingPaidCredits : priceCredits}`}
                            </span>
                          ) : null}
                          {row ? <span className="ep-card__status">{row.status}</span> : null}
                        </p>
                        {row?.error ? (
                          <p className="ep-card__error truncate" title={row.error}>
                            {row.error}
                          </p>
                        ) : null}
                        <div className="ep-card__ops">
                          <button
                            type="button"
                            className="ep-draft-icon-btn"
                            disabled={busy || i === 0}
                            aria-label={t("moveUp")}
                            onClick={() => moveEpisode(ep.id, -1)}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="ep-draft-icon-btn"
                            disabled={busy || i === episodes.length - 1}
                            aria-label={t("moveDown")}
                            onClick={() => moveEpisode(ep.id, 1)}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="ep-draft-icon-btn ep-draft-icon-btn--danger"
                            disabled={busy}
                            aria-label={t("onlineRemoveEpisode")}
                            onClick={() => removeEpisode(ep.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    className="ep-card ep-card--add"
                    disabled={busy}
                    onClick={pickFiles}
                  >
                    <Upload className="h-5 w-5" />
                    <span>{dragOver ? t("uploadDropActive") : t("localWizardAddEpisodes")}</span>
                  </button>
                </div>

                {progressRows.length ? (
                  <p className="ep-card-board__progress text-caption text-ink-muted">
                    {t("uploadProgressLabel", { done: doneCount, total: progressRows.length })}
                  </p>
                ) : (
                  <p className="ep-card-board__foot text-caption text-ink-subtle">
                    {t("epCardDropHint")}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}

        {sourceMode === "server" ? (
          <div className="space-y-3">
            <p className="text-body-sm text-ink-muted">
              {isExisting ? t("localWizardServerLeadExisting") : t("localWizardServerLead")}
            </p>
            <div className="local-source-zone local-source-zone--form">
              <Server className="local-source-zone__icon" />
              <label className="block w-full max-w-lg text-left">
                <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">{t("localPathTitle")}</span>
                <Input
                  placeholder={t("localWizardServerPlaceholder")}
                  value={rootPath}
                  disabled={busy}
                  onChange={(e) => setRootPath(e.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || (isExisting && !existingDramaId)}
                onClick={() => serverMut.mutate(true)}
              >
                {serverMut.isPending && serverMut.variables === true ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {t("localWizardPreviewBtn")}
              </Button>
              <Button
                size="sm"
                disabled={busy || (isExisting && !existingDramaId)}
                onClick={() => serverMut.mutate(false)}
              >
                {serverMut.isPending && serverMut.variables === false ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {isExisting ? t("localWizardAppendBtn") : t("localWizardImportBtn")}
              </Button>
            </div>
            <p className="text-caption text-ink-subtle">{t("localWizardFootNote")}</p>
          </div>
        ) : null}

        {importResult ? (
          <div className="local-import-result space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "upload-status-pill",
                  importResult.dryRun ? "is-muted" : "is-ok",
                )}
              >
                {importResult.dryRun ? t("localWizardPreviewTag") : t("localWizardImportedTag")}
              </span>
              <p className="text-body-sm text-ink">
                {t("importSummary", {
                  scanned: importResult.scanned ?? "—",
                  imported: importResult.imported ?? "—",
                  skipped: importResult.skipped ?? "—",
                })}
              </p>
            </div>
            {importResult.dryRun ? (
              <p className="text-caption text-ink-muted">{t("importDryRunNextHint")}</p>
            ) : null}
            {importResult.hint ? <p className="text-caption text-ink-muted">{importResult.hint}</p> : null}
            {Array.isArray(importResult.items) && importResult.items.length > 0 ? (
              <pre className="max-h-56 overflow-auto rounded-lg bg-surface-2 p-3 text-caption">
                {JSON.stringify(importResult.items.slice(0, 40), null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </section>

      {sourceMode === "files" && !isExisting ? (
        <>
          <section className="upload-panel space-y-3">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadSectionInfo")}</h2>
                <p>{t("uploadSectionInfoHint")}</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="upload-field">
                <span>{t("onlineTitleZh")}</span>
                <Input value={titleZh} disabled={busy} onChange={(e) => setTitleZh(e.target.value)} />
              </label>
              <label className="upload-field">
                <span>{t("onlineCategory")}</span>
                <Select
                  value={categorySlug}
                  disabled={busy}
                  onChange={(e) => setCategorySlug(e.target.value)}
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
                  rows={3}
                  value={descriptionZh}
                  disabled={busy}
                  onChange={(e) => setDescriptionZh(e.target.value)}
                />
              </label>
              <div className="md:col-span-2">
                <div className="upload-field">
                  <span>{t("uploadSectionCover")}</span>
                  <DramaCoverField
                    url={coverUrl || undefined}
                    disabled={busy}
                    videoFile={episodes[0]?.file}
                    onChange={setCoverUrl}
                    onError={setError}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="upload-panel space-y-3">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadSectionPolicy")}</h2>
                <p>{t("uploadSectionPolicyHint")}</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                className="content-checkbox"
                checked={isFree}
                disabled={busy}
                onChange={(e) => setIsFree(e.target.checked)}
              />
              {t("free")}
            </label>
            {!isFree ? (
              <div className="grid max-w-md gap-3 sm:grid-cols-2">
                <label className="upload-field">
                  <span>{t("priceCreditsPerEpisode")}</span>
                  <Input
                    type="number"
                    min={0}
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
            {!isFree && episodes.length > 0 ? (
              <p className="text-caption text-ink-muted">
                {t("localWizardPolicyPreview", {
                  free: Math.min(freeCap, episodes.length),
                  paid: Math.max(0, episodes.length - freeCap),
                })}
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {sourceMode === "files" ? (
        <div className="upload-submit-bar">
          <p className="min-w-0 flex-1 text-xs text-ink-subtle">
            {fileBlockReason ||
              (episodes.length
                ? isExisting
                  ? t("localWizardSubmitHintExisting", {
                      title: existingDrama ? dramaLabel(existingDrama) : "—",
                      n: episodes.length,
                      start: startEpPreview,
                    })
                  : t("localWizardSubmitHint", { n: episodes.length })
                : t("uploadDraftOnlyHint"))}
          </p>
          <Button
            size="sm"
            disabled={!!fileBlockReason || busy}
            onClick={() => uploadMut.mutate()}
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isExisting ? t("localWizardAppendBtn") : t("uploadSubmitDraft")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
