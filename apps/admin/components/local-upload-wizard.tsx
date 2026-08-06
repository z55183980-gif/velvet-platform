"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminGetDrama,
  adminListCategories,
  adminListDramas,
  adminStorageProbe,
  adminStorageStatus,
  adminUploadImage,
  asRows,
} from "@velvet/api-client";
import { Button, Input, Select, cn } from "@velvet/ui";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  HardDrive,
  LoaderCircle,
  Film,
  Trash2,
  Upload,
  X,
  Save,
  Archive,
} from "lucide-react";
import { DramaCoverField } from "@/components/drama-cover-field";
import { GlassModal } from "@/components/glass-modal";
import {
  captureVideoFirstFrameWithMeta,
  probeLocalVideoDuration,
} from "@/lib/capture-video-frame";
import {
  DEFAULT_COMPLETION,
  DEFAULT_CONTENT_TYPE,
  MAX_DRAMA_TAGS,
  composeDramaSourceTags,
  normalizeCompletion,
  normalizeContentType,
  parseDramaTags,
  type DramaCompletion,
  type DramaContentType,
} from "@/lib/drama-tags";
import { useI18n, statusLabel } from "@/lib/i18n";
import { useUploadQueue } from "@/lib/upload-queue";
import { VIDEO_ACCEPT, isVideoFile } from "@/lib/video-formats";

type Category = { slug: string; nameZh?: string; nameEn?: string };
type DramaTarget = "new" | "existing";
type DraftRecord = {
  id: string;
  titleZh: string;
  titleEn?: string;
  categorySlug: string;
  tags: string[];
  descriptionZh: string;
  coverUrl: string;
  contentType: string;
  completion: string;
  totalEpisodes: number;
  /** Staged video count at save time (File objects are not persisted). */
  episodeFileCount?: number;
  dramaTarget?: DramaTarget;
  existingDramaId?: string;
  existingDramaLabel?: string;
  updatedAt: string;
  freeRangeStart?: string;
  freeRangeEnd?: string;
  priceCredits?: number;
  allowPreview?: boolean;
  previewSeconds?: number;
};

function draftDisplayTitle(draft: DraftRecord) {
  if (draft.dramaTarget === "existing") {
    return draft.existingDramaLabel || draft.titleZh || draft.titleEn || "—";
  }
  return draft.titleZh || draft.titleEn || "—";
}

/** Empty locale titles resolve to the English title at submit time (API expects zh/en). */
function resolveLocaleTitle(localeTitle: string, englishTitle: string) {
  return localeTitle.trim() || englishTitle.trim();
}
const LOCAL_DRAFTS_KEY = "velvet-admin-drama-drafts";
type ProgressStatus = "pending" | "uploading" | "done" | "error";
type ThumbStatus = "pending" | "ready" | "error";
/** pending → probing; ready → known seconds; unknown → demuxer gave no finite duration. */
type DurationStatus = "pending" | "ready" | "unknown";

function UploadMetaChips<T extends string>({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  ariaLabel: string;
  onChange: (next: T) => void;
}) {
  return (
    <div className="upload-meta-chips" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            className={cn("upload-meta-chips__btn", active && "is-active")}
            aria-pressed={active}
            onClick={() => {
              if (!active) onChange(opt.value);
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function isFileDrag(e: DragEvent) {
  return Array.from(e.dataTransfer.types).includes("Files");
}

type EpisodeDraft = {
  id: string;
  file: File;
  title: string;
  isFree: boolean;
  previewSeconds: number;
  /** Local object URL for card preview (revoked on remove). */
  thumbPreviewUrl?: string;
  /** Uploaded `/api/v1/media/...` path for create-episode. */
  thumbnailUrl?: string;
  thumbStatus?: ThumbStatus;
  /** Browser-probed length in seconds (undefined while pending / unknown). */
  durationSec?: number;
  durationStatus?: DurationStatus;
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
  coverUrl?: string | null;
  descriptionZh?: string | null;
  tags?: string[];
  totalEpisodes?: number;
  freeEpisodeCount?: number;
  lockMode?: string | null;
  category?: { slug?: string; nameZh?: string; nameEn?: string };
  episodes?: Array<{ episodeNumber: number; isFree?: boolean; priceCredits?: number | string }>;
};

function fmtSize(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format seconds as m:ss or h:mm:ss for episode cards. */
function fmtDuration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function episodeDurationLabel(ep: EpisodeDraft) {
  if (ep.durationStatus === "ready" && ep.durationSec != null) {
    return fmtDuration(ep.durationSec);
  }
  if (ep.durationStatus === "unknown") return "—";
  return "…";
}

function fileKey(f: File) {
  return `${f.name}:${f.size}:${f.lastModified}`;
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

function dramaOptionMeta(
  d: DramaOption,
  tFn: (key: string, vars?: Record<string, string | number>) => string,
) {
  const parts = [
    d.status ? statusLabel(tFn, d.status) : null,
    `${d._count?.episodes ?? d.totalEpisodes ?? 0}${tFn("localWizardEpSuffix")}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Case-insensitive includes match on title / slug / id; multi-token ANDed. */
function matchesDramaQuery(d: DramaOption, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [d.titleZh, d.titleEn, d.slug, String(d.id)]
    .filter(Boolean)
    .join("\0")
    .toLowerCase();
  return needle.split(/\s+/).every((tok) => hay.includes(tok));
}

function DramaPickerCombobox({
  value,
  query,
  selectedLabel,
  onQueryChange,
  onSelect,
  onClear,
  options,
  loading,
  disabled,
  label,
  placeholder,
  noMatchLabel,
  clearLabel,
  metaFor,
}: {
  value: string;
  query: string;
  selectedLabel?: string;
  onQueryChange: (q: string) => void;
  onSelect: (d: DramaOption) => void;
  onClear: () => void;
  options: DramaOption[];
  loading?: boolean;
  disabled?: boolean;
  label: string;
  placeholder: string;
  noMatchLabel: string;
  clearLabel: string;
  metaFor: (d: DramaOption) => string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = useMemo(
    () => options.filter((d) => matchesDramaQuery(d, query)),
    [options, query],
  );

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

  useEffect(() => {
    setHighlight(0);
  }, [query, open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const displayValue = open || !value ? query : selectedLabel || query;

  const pick = (d: DramaOption) => {
    onSelect(d);
    onQueryChange(dramaLabel(d));
    setOpen(false);
  };

  return (
    <div className="upload-field max-w-xl" ref={rootRef}>
      <span id="drama-picker-label">{label}</span>
      <div className="drama-combobox">
        <div className="drama-combobox__control">
          <Input
            role="combobox"
            aria-expanded={open}
            aria-controls="drama-picker-listbox"
            aria-labelledby="drama-picker-label"
            aria-autocomplete="list"
            disabled={disabled}
            value={displayValue}
            placeholder={placeholder}
            autoComplete="off"
            onFocus={() => {
              setOpen(true);
              if (value) onQueryChange("");
            }}
            onChange={(e) => {
              const next = e.target.value;
              onQueryChange(next);
              setOpen(true);
              if (value) onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter" && open && filtered[highlight]) {
                e.preventDefault();
                pick(filtered[highlight]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {value ? (
            <button
              type="button"
              className="drama-combobox__icon-btn"
              disabled={disabled}
              aria-label={clearLabel}
              onClick={() => {
                onClear();
                onQueryChange("");
                setOpen(true);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              className="drama-combobox__icon-btn"
              disabled={disabled}
              aria-label={label}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
            </button>
          )}
        </div>
        {open ? (
          <ul
            id="drama-picker-listbox"
            ref={listRef}
            role="listbox"
            className="drama-combobox__list scrollbar-thin"
          >
            {loading ? (
              <li className="drama-combobox__empty" role="presentation">
                <LoaderCircle className="mx-auto h-4 w-4 animate-spin text-ink-muted" />
              </li>
            ) : filtered.length === 0 ? (
              <li className="drama-combobox__empty" role="presentation">
                {noMatchLabel}
              </li>
            ) : (
              filtered.map((d, idx) => {
                const id = String(d.id);
                const isSelected = value === id;
                const isActive = idx === highlight;
                return (
                  <li key={id} role="option" aria-selected={isSelected} data-idx={idx}>
                    <button
                      type="button"
                      className={cn(
                        "drama-combobox__option",
                        isActive && "is-active",
                        isSelected && "is-selected",
                      )}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => pick(d)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{dramaLabel(d)}</span>
                        <span className="block truncate text-caption text-ink-muted">
                          {[d.slug || id, metaFor(d)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {isSelected ? <Check className="h-3.5 w-3.5 shrink-0 text-brand" /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
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
  const qc = useQueryClient();
  const { enqueueJob } = useUploadQueue();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const [dramaTarget, setDramaTarget] = useState<DramaTarget>("new");
  const [existingDramaId, setExistingDramaId] = useState("");
  const [dramaQuery, setDramaQuery] = useState("");
  const [dramaSearch, setDramaSearch] = useState("");
  const [dramaCommittedLabel, setDramaCommittedLabel] = useState("");
  const [titleZh, setTitleZh] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [categorySlug, setCategorySlug] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [descriptionZh, setDescriptionZh] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [contentType, setContentType] = useState<DramaContentType>(DEFAULT_CONTENT_TYPE);
  const [completion, setCompletion] = useState<DramaCompletion>(DEFAULT_COMPLETION);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [totalEpisodesDirty, setTotalEpisodesDirty] = useState(false);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [priceCredits, setPriceCredits] = useState(10);
  const [allowPreview, setAllowPreview] = useState(false);
  const [previewSeconds, setPreviewSeconds] = useState(10);
  const [freeRangeStart, setFreeRangeStart] = useState("1");
  const [freeRangeEnd, setFreeRangeEnd] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, { status: ProgressStatus; error?: string }>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  /** Dialog choice: false = admin-only draft; true = publish after transcode. */
  const [submitPublishChoice, setSubmitPublishChoice] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const episodesRef = useRef(episodes);
  episodesRef.current = episodes;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_DRAFTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      setDrafts(
        parsed.filter(
          (item): item is DraftRecord =>
            Boolean(item && typeof item === "object" && typeof (item as DraftRecord).id === "string"),
        ),
      );
    } catch { /* ignore malformed local drafts */ }
  }, []);

  // Auto-fill 总集数 from uploaded episode count until the user overrides (or clears).
  useEffect(() => {
    if (!totalEpisodesDirty) setTotalEpisodes(episodes.length);
  }, [episodes.length, totalEpisodesDirty]);

  function persistDrafts(next: DraftRecord[]) {
    const capped = next.slice(0, 20);
    setDrafts(capped);
    try {
      window.localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify(capped));
    } catch {
      /* quota / private mode — keep in-memory list */
    }
  }

  function saveLocalDraft() {
    const en = titleEn.trim();
    const zh = titleZh.trim();
    const id = editingDraftId || `${Date.now()}`;
    const record: DraftRecord = {
      id,
      titleZh: zh || en || "未命名剧集",
      titleEn: en || undefined,
      categorySlug,
      tags,
      descriptionZh,
      coverUrl,
      contentType,
      completion,
      totalEpisodes,
      episodeFileCount: episodes.length,
      dramaTarget,
      existingDramaId: dramaTarget === "existing" ? existingDramaId || undefined : undefined,
      existingDramaLabel: dramaTarget === "existing" ? dramaCommittedLabel || undefined : undefined,
      updatedAt: new Date().toISOString(),
      freeRangeStart,
      freeRangeEnd,
      priceCredits,
      allowPreview,
      previewSeconds,
    };
    persistDrafts([record, ...drafts.filter((item) => item.id !== id)]);
    setEditingDraftId(id);
    setError(null);
    setSuccess(null);
    setShowDrafts(true);
  }

  function restoreDraft(record: DraftRecord) {
    const target = record.dramaTarget === "existing" ? "existing" : "new";
    setDramaTarget(target);
    setExistingDramaId(target === "existing" ? record.existingDramaId || "" : "");
    setDramaCommittedLabel(target === "existing" ? record.existingDramaLabel || "" : "");
    setDramaQuery("");
    setDramaSearch("");
    setTitleZh(record.titleZh === "未命名剧集" ? "" : record.titleZh);
    setTitleEn(record.titleEn || "");
    setTitleTouched(Boolean(record.titleEn?.trim() || (record.titleZh && record.titleZh !== "未命名剧集")));
    setCategorySlug(record.categorySlug || "");
    setTags(record.tags || []);
    setDescriptionZh(record.descriptionZh || "");
    setCoverUrl(record.coverUrl || "");
    setContentType(normalizeContentType(record.contentType));
    setCompletion(normalizeCompletion(record.completion));
    setFreeRangeStart(record.freeRangeStart || "1");
    setFreeRangeEnd(record.freeRangeEnd || "");
    setPriceCredits(record.priceCredits || 10);
    setAllowPreview(record.allowPreview ?? false);
    setPreviewSeconds(record.previewSeconds || 10);
    // Videos must be re-picked; keep planned 总集数 if operator had overridden it.
    setEpisodes((prev) => {
      for (const ep of prev) {
        if (ep.thumbPreviewUrl) URL.revokeObjectURL(ep.thumbPreviewUrl);
      }
      return [];
    });
    setSelectedIds([]);
    setProgress({});
    const planned = Number(record.totalEpisodes) || 0;
    const staged = Number(record.episodeFileCount) || 0;
    if (planned > staged) {
      setTotalEpisodesDirty(true);
      setTotalEpisodes(planned);
    } else {
      setTotalEpisodesDirty(false);
      setTotalEpisodes(0);
    }
    setEditingDraftId(record.id);
    setShowDrafts(false);
    setError(t("draftRestoreVideosHint"));
  }

  function deleteDraft(id: string) {
    persistDrafts(drafts.filter((item) => item.id !== id));
    if (editingDraftId === id) setEditingDraftId(null);
  }

  function validateInfo() {
    const en = titleEn.trim();
    if (!en) return t("uploadBlockTitleEn");
    if (en.length > 40) return t("dramaTitleTooLong");
    if (titleZh.trim().length > 40) return t("dramaTitleTooLong");
    if (!categorySlug) return t("uploadBlockCategory");
    if (descriptionZh.trim().length > 300) return t("dramaDescriptionTooLong");
    if (tags.length > MAX_DRAMA_TAGS) return t("dramaTagsTooMany");
    if (episodes.length < 1) return t("uploadBlockFiles");
    if (episodes.some((episode) => !episode.isFree) && priceCredits <= 0) return t("policyPriceInvalid");
    // Only validate when the operator manually overrode 总集数 (empty/auto remains allowed).
    if (totalEpisodesDirty) {
      if (!Number.isInteger(totalEpisodes)) return t("totalEpisodesMustBeInteger");
      if (totalEpisodes <= episodes.length) {
        return t("totalEpisodesMustExceedUploaded", { n: episodes.length });
      }
    }
    return null;
  }

  useEffect(() => {
    return () => {
      for (const ep of episodesRef.current) {
        if (ep.thumbPreviewUrl) URL.revokeObjectURL(ep.thumbPreviewUrl);
      }
    };
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setDramaSearch(dramaQuery.trim()), 220);
    return () => window.clearTimeout(id);
  }, [dramaQuery]);

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
  const r2ProbeEnabled =
    !!storageQ.data?.r2Enabled && !!storageQ.data?.r2Configured;
  const probeQ = useQuery({
    queryKey: ["admin", "storage-probe"],
    queryFn: () => adminStorageProbe(),
    enabled: r2ProbeEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
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
  const infoLocked = isExisting;
  /** Tags / content type / completion stay editable for append-to-existing flow. */
  const tagsLocked = false;
  const showInfoPanel = !isExisting || !!existingDramaId;

  useEffect(() => {
    if (!isExisting || !existingDrama) return;
    const meta = parseDramaTags(existingDrama.tags);
    setTags(meta.displayTags);
    setContentType(meta.contentType);
    setCompletion(meta.completion);
  }, [isExisting, existingDramaId, existingDrama?.tags]);

  const infoTitleEn = infoLocked ? (existingDrama?.titleEn ?? "") : titleEn;
  const infoTitleZh = infoLocked ? (existingDrama?.titleZh ?? "") : titleZh;
  const infoCategoryLabel = infoLocked
    ? (existingDrama?.category?.nameZh ||
        existingDrama?.category?.nameEn ||
        existingDrama?.category?.slug ||
        "—")
    : "";
  const infoTags = tags;
  const infoContentType = contentType;
  const infoCompletion = completion;
  const infoDescriptionZh = infoLocked
    ? (existingDrama?.descriptionZh ?? "")
    : descriptionZh;
  const infoCoverUrl = infoLocked ? (existingDrama?.coverUrl ?? "") : coverUrl;
  const infoTotalEpisodes = infoLocked
    ? (existingDrama?.totalEpisodes ?? existingDrama?.episodes?.length ?? 0)
    : totalEpisodes;
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
  const totalDurationSec = useMemo(() => {
    let sum = 0;
    let known = 0;
    for (const ep of episodes) {
      if (ep.durationStatus === "ready" && ep.durationSec != null) {
        sum += ep.durationSec;
        known += 1;
      }
    }
    return known > 0 ? sum : undefined;
  }, [episodes]);
  const storageChecking = storageQ.isLoading;
  const storageFailed = storageQ.isError;
  const r2Enabled = !!storageQ.data?.r2Enabled;
  const r2Configured = !!storageQ.data?.r2Configured;
  const r2Misconfigured = r2Enabled && !r2Configured;
  const r2DirectUpload =
    !!storageQ.data?.r2DirectUpload || r2Configured;
  const ffmpegReady = !!storageQ.data?.ffmpegReady;
  const probe = probeQ.data?.probe;
  const probeChecking =
    r2ProbeEnabled && !probe && (probeQ.isLoading || probeQ.isFetching);
  const probeFailed =
    r2ProbeEnabled &&
    (probeQ.isError || (!!probe && !probe.skipped && !probe.ok));
  const probeErrorMessage =
    probeQ.error instanceof Error && probeQ.error.message.trim()
      ? probeQ.error.message
      : probe?.error?.trim() || t("uploadR2ProbeFailedGeneric");
  const probeOk =
    r2ProbeEnabled && !!probe && !probe.skipped && probe.ok && !probeQ.isError;
  const mediaBucketName =
    probe?.mediaBucket || storageQ.data?.mediaBucket || "—";
  const uploadBucketName =
    probe?.uploadBucket || storageQ.data?.uploadBucket || "—";
  const probeLatencyMs =
    probeOk && probe?.latencyMs != null ? probe.latencyMs : null;
  /** API→R2 probe latency: <800 ok, 800–2000 warn, >2000 error. */
  const latencyPillTone =
    probeLatencyMs == null
      ? "is-muted"
      : probeLatencyMs < 800
        ? "is-ok"
        : probeLatencyMs <= 2000
          ? "is-warn"
          : "is-error";
  const r2UnreachableLabel = (() => {
    const mediaBad = probe?.mediaReachable === false;
    const uploadBad = probe?.uploadReachable === false;
    if (mediaBad && uploadBad) return t("uploadR2UnreachableBoth");
    if (mediaBad) return t("uploadR2UnreachableMedia");
    if (uploadBad) return t("uploadR2UnreachableUpload");
    return t("uploadR2Unreachable");
  })();
  const storageErrorMessage =
    storageQ.error instanceof Error && storageQ.error.message.trim()
      ? storageQ.error.message
      : t("uploadStorageCheckFailed");
  const storageBytes =
    typeof probe?.storageBytes === "number" && Number.isFinite(probe.storageBytes)
      ? probe.storageBytes
      : null;
  const storageSizeLabel =
    storageBytes == null
      ? t("uploadR2SizeUnknown")
      : probe?.storageApprox
        ? t("uploadR2SizeApproxMark", { size: fmtSize(storageBytes) })
        : fmtSize(storageBytes);
  const storageSizeTitleExtra =
    storageBytes == null && probe?.mediaBytes == null && probe?.uploadBytes == null
      ? ""
      : t("uploadR2StorageSizeHint", {
          size: storageSizeLabel,
          mediaSize:
            typeof probe?.mediaBytes === "number"
              ? fmtSize(probe.mediaBytes)
              : t("uploadR2SizeUnknown"),
          uploadSize:
            typeof probe?.uploadBytes === "number"
              ? fmtSize(probe.uploadBytes)
              : t("uploadR2SizeUnknown"),
          approx: probe?.storageApprox ? t("uploadR2StorageApproxNote") : "",
        });
  const useDirectPath =
    r2DirectUpload && !r2Misconfigured && !storageFailed && !probeFailed;
  const destPillTone =
    storageChecking || (r2Enabled && r2Configured && probeChecking)
      ? "is-loading"
      : storageFailed || r2Misconfigured || probeFailed
        ? "is-error"
        : r2Enabled
          ? probeOk
            ? "is-ok"
            : r2Configured
              ? "is-loading"
              : "is-error"
          : "is-muted";
  const destPillTitle = storageChecking
    ? t("uploadStorageChecking")
    : storageFailed
      ? storageErrorMessage
      : r2Misconfigured
        ? t("uploadR2MisconfiguredHint")
        : !r2Enabled
          ? t("uploadR2NotEnabledHint")
          : probeChecking
            ? t("uploadR2ProbeChecking")
            : probeFailed
              ? t("uploadR2ProbeFailed", { error: probeErrorMessage })
              : probeOk
                ? [
                    t("uploadR2ProbeOkHint", {
                      ms: probe?.latencyMs ?? "—",
                      host: probe?.endpointHost || "—",
                      region: probe?.region || "—",
                      media: mediaBucketName,
                      upload: uploadBucketName,
                      size: storageSizeLabel,
                    }),
                    useDirectPath
                      ? t("uploadR2DirectHint")
                      : t("uploadProxyFallbackHint"),
                    storageSizeTitleExtra,
                  ]
                    .filter(Boolean)
                    .join("\n")
                : useDirectPath
                  ? t("uploadR2DirectHint")
                  : t("uploadProxyFallbackHint");
  const destPillLabel = (() => {
    if (storageChecking) return t("uploadStorageChecking");
    if (r2Enabled && r2Configured && probeChecking) return t("uploadR2ProbeChecking");
    if (!r2Enabled) return t("uploadR2LocalNote");
    if (probeFailed) return r2UnreachableLabel;
    const sizedDirect = () =>
      storageBytes == null
        ? t("uploadR2PillDirectBare")
        : t("uploadR2PillDirect", { size: storageSizeLabel });
    const sizedProxy = () =>
      storageBytes == null
        ? t("uploadR2PillProxyBare")
        : t("uploadR2PillProxy", { size: storageSizeLabel });
    if (r2Misconfigured || storageFailed) return sizedProxy();
    if (probeOk) return useDirectPath ? sizedDirect() : sizedProxy();
    if (r2Configured) return t("uploadR2ProbeChecking");
    return sizedProxy();
  })();
  const ffmpegPillTone = storageChecking
    ? "is-loading"
    : storageFailed
      ? "is-error"
      : ffmpegReady
        ? "is-ok"
        : "is-error";
  const ffmpegPillTitle = storageChecking
    ? t("ffmpegChecking")
    : storageFailed
      ? storageErrorMessage
      : ffmpegReady
        ? undefined
        : t("uploadBlockFfmpeg");
  const ffmpegPillLabel = storageChecking
    ? t("ffmpegChecking")
    : ffmpegReady
      ? t("ffmpegReady")
      : t("ffmpegMissing");
  const fileBlockReason = useMemo(() => {
    if (storageQ.isLoading) return t("loading");
    if (storageQ.isError) return storageErrorMessage;
    if (!ffmpegReady) return t("uploadBlockFfmpeg");
    if (isExisting) {
      if (!existingDramaId) return t("localWizardPickDrama");
      if (existingDramaQ.isLoading) return t("loading");
      if (existingDramaQ.isError) return t("localWizardDramaLoadFail");
    } else {
      const infoError = validateInfo();
      if (infoError) return infoError;
    }
    if (!episodes.length) return t("uploadBlockFiles");
    return null;
  }, [
    storageQ.isLoading,
    storageQ.isError,
    storageErrorMessage,
    ffmpegReady,
    isExisting,
    existingDramaId,
    existingDramaQ.isLoading,
    existingDramaQ.isError,
    titleZh,
    titleEn,
    categorySlug,
    descriptionZh,
    tags,
    episodes,
    priceCredits,
    t,
  ]);

  function episodeIsFreeForUpload(episodeNumber: number, indexInBatch: number) {
    if (isExisting && existingDrama) {
      const mode = existingDrama.lockMode || "FREE_FIRST_N";
      if (mode === "ALL_FREE") return true;
      if (mode === "VIP_ALL") return false;
      return episodeNumber <= Math.max(0, existingDrama.freeEpisodeCount ?? 0);
    }
    // New drama: free/paid comes only from playback policy range (1-based draft order).
    if (!freeRangeStart && !freeRangeEnd) return true;
    const start = Number(freeRangeStart);
    const end = Number(freeRangeEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return true;
    const n = indexInBatch + 1;
    return n >= start && n <= end;
  }

  function freeEpisodeCountFromPolicy() {
    if (!episodes.length) return 0;
    if (!freeRangeStart && !freeRangeEnd) return episodes.length;
    const start = Number(freeRangeStart);
    const end = Number(freeRangeEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return episodes.length;
    }
    const lo = Math.max(1, start);
    const hi = Math.min(episodes.length, end);
    return Math.max(0, hi - lo + 1);
  }

  function revokeThumbPreview(url?: string) {
    if (url) URL.revokeObjectURL(url);
  }

  /** Capture first frame → local preview + upload thumbnail URL (silent on failure).
   * Duration is read from the same demux pass when available.
   * thumbStatus stays "pending" until the server URL is ready — local preview may show earlier. */
  async function hydrateEpisodeThumb(id: string, file: File) {
    const applyDuration = (durationSec: number | undefined) => {
      setEpisodes((prev) => {
        const idx = prev.findIndex((ep) => ep.id === id);
        if (idx < 0) return prev;
        if (prev[idx].durationStatus === "ready") return prev;
        const next = [...prev];
        next[idx] =
          durationSec != null
            ? { ...next[idx], durationSec, durationStatus: "ready" }
            : { ...next[idx], durationStatus: "unknown" };
        return next;
      });
    };

    try {
      const { blob, durationSec } = await captureVideoFirstFrameWithMeta(file);
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
        // Preview can render immediately; keep status pending until URL is uploaded.
        next[idx] = {
          ...next[idx],
          thumbPreviewUrl: preview,
          thumbStatus: "pending",
          ...(durationSec != null
            ? { durationSec, durationStatus: "ready" as const }
            : next[idx].durationStatus === "ready"
              ? {}
              : { durationStatus: "unknown" as const }),
        };
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
      // Thumbnail failed — still try a lightweight duration probe.
      try {
        const durationSec = await probeLocalVideoDuration(file);
        applyDuration(durationSec);
      } catch {
        applyDuration(undefined);
      }
    }
  }

  async function uploadThumbBlob(ep: EpisodeDraft, blob: Blob): Promise<string | undefined> {
    const base = ep.file.name.replace(/\.[^.]+$/, "") || "episode";
    const saved = await adminUploadImage(blob, {
      kind: "thumbnail",
      filename: `${base}-thumb.jpg`,
    });
    setEpisodes((prev) => {
      const idx = prev.findIndex((e) => e.id === ep.id);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], thumbnailUrl: saved.url, thumbStatus: "ready" };
      return next;
    });
    return saved.url;
  }

  function addFiles(list: File[]): number {
    // Natural filename sort for the new batch only (existing cards keep order).
    const videos = sortVideoFiles(list.filter(isVideoFile));
    if (!videos.length) return 0;
    // Build drafts outside setState — updater must stay pure (React Strict Mode
    // double-invokes it; Math.random ids inside would desync hydrate targets).
    const known = new Set(episodesRef.current.map((ep) => fileKey(ep.file)));
    const incoming: EpisodeDraft[] = videos
      .filter((f) => !known.has(fileKey(f)))
      .map((file) => ({
        id: makeEpisodeId(file),
        file,
        title: defaultEpisodeTitle(file.name),
        isFree: true,
        previewSeconds: 0,
        thumbStatus: "pending" as const,
        durationStatus: "pending" as const,
      }));
    if (!incoming.length) return 0;
    if (!freeRangeEnd) setFreeRangeEnd(String(episodesRef.current.length + incoming.length));
    setEpisodes((prev) => [...prev, ...incoming]);
    for (const ep of incoming) {
      void hydrateEpisodeThumb(ep.id, ep.file);
    }
    setError(null);
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
      return moveItem(prev, idx, idx + dir);
    });
  }

  function onEpisodeDragStart(id: string) {
    setDragId(id);
  }

  function onEpisodeDragOver(e: DragEvent, overId: string) {
    if (isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (overId !== dropId) setDropId(overId);
  }

  function onEpisodeDrop(overId: string) {
    if (!dragId || dragId === overId) {
      setDragId(null);
      setDropId(null);
      return;
    }
    setEpisodes((prev) => {
      const from = prev.findIndex((ep) => ep.id === dragId);
      const to = prev.findIndex((ep) => ep.id === overId);
      return moveItem(prev, from, to);
    });
    setDragId(null);
    setDropId(null);
  }

  function onEpisodeDragEnd() {
    setDragId(null);
    setDropId(null);
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

  function resetWizardAfterEnqueue(mode: "new" | "append") {
    clearAllEpisodes();
    setEditingDraftId(null);
    setProgress({});
    if (mode === "new") {
      setTitleZh("");
      setTitleEn("");
      setTitleTouched(false);
      setCoverUrl("");
      setDescriptionZh("");
      setTags([]);
      setTagInput("");
      setContentType(DEFAULT_CONTENT_TYPE);
      setCompletion(DEFAULT_COMPLETION);
      setTotalEpisodes(0);
      setTotalEpisodesDirty(false);
      setFreeRangeStart("1");
      setFreeRangeEnd("");
      setPriceCredits(10);
      setAllowPreview(false);
      setPreviewSeconds(10);
    }
  }

  function prepareEpisodesForSubmit() {
    const total = episodes.length;
    if (!total) return episodes;

    // Empty free range → all free. Otherwise only episodes in [start, end] are free;
    // everything else is paid (policy is the sole access control after per-card toggle removal).
    let freeStart = 1;
    let freeEnd = total;
    if (freeRangeStart || freeRangeEnd) {
      freeStart = Number(freeRangeStart);
      freeEnd = Number(freeRangeEnd);
      if (
        !Number.isInteger(freeStart) ||
        !Number.isInteger(freeEnd) ||
        freeStart < 1 ||
        freeEnd < freeStart ||
        freeEnd > total
      ) {
        throw new Error(t("policyRangeInvalid", { total }));
      }
    }

    const next = episodes.map((episode, index) => {
      const isFree = index + 1 >= freeStart && index + 1 <= freeEnd;
      return {
        ...episode,
        isFree,
        previewSeconds: isFree ? 0 : allowPreview ? previewSeconds : 0,
      };
    });

    if (next.some((episode) => !episode.isFree) && priceCredits <= 0) {
      throw new Error(t("policyPriceInvalid"));
    }
    return next;
  }

  const uploadMut = useMutation({
    mutationFn: async (opts?: { publishWhenReady?: boolean }) => {
      const publishWhenReady = !!opts?.publishWhenReady && !isExisting;
      if (fileBlockReason) throw new Error(fileBlockReason);
      const preparedEpisodes = isExisting ? episodes : prepareEpisodesForSubmit();
      if (!preparedEpisodes.length) throw new Error(t("localWizardAddEpisodes"));

      setProgress(
        Object.fromEntries(preparedEpisodes.map((ep) => [ep.id, { status: "pending" as const }])),
      );

      const start = isExisting ? maxExistingEp + 1 : 1;
      const credits = isExisting ? existingPaidCredits : priceCredits;

      // Hand Files to the queue immediately — drama create + thumbs run inside the job.
      const queueEpisodes = preparedEpisodes.map((ep, i) => {
        const episodeNumber = start + i;
        const episodeIsFree = isExisting ? episodeIsFreeForUpload(episodeNumber, i) : ep.isFree;
        const live = episodesRef.current.find((e) => e.id === ep.id) ?? ep;
        return {
          id: ep.id,
          file: ep.file,
          title: ep.title.trim() || defaultEpisodeTitle(ep.file.name),
          episodeNumber,
          isFree: episodeIsFree,
          previewSeconds: episodeIsFree ? 0 : ep.previewSeconds,
          priceCredits: episodeIsFree ? 0 : credits,
          // Only pass a URL that's already on the server; capture/upload happens in the queue.
          thumbnailUrl: live.thumbnailUrl || undefined,
        };
      });

      const sourceTags = composeDramaSourceTags(tags, contentType, completion);

      if (isExisting) {
        const displayTitle = existingDrama
          ? dramaLabel(existingDrama)
          : dramaCommittedLabel || existingDramaId;
        enqueueJob({
          title: displayTitle,
          dramaId: existingDramaId,
          mode: "append",
          preferDirect: r2DirectUpload,
          publishWhenReady: false,
          appendSourceTags: sourceTags,
          episodes: queueEpisodes,
        });
        return {
          id: existingDramaId,
          totalEpisodes: preparedEpisodes.length,
          mode: "append" as const,
          publishWhenReady: false,
        };
      }

      const englishTitle = titleEn.trim();
      const titleZhResolved = resolveLocaleTitle(titleZh, englishTitle);
      const titleDisplay = titleZhResolved || englishTitle || "—";
      const createDrama = {
        titleZh: titleZhResolved,
        titleEn: englishTitle,
        categorySlug,
        coverUrl: coverUrl.trim() || undefined,
        descriptionZh: descriptionZh.trim() || undefined,
        freeEpisodeCount: preparedEpisodes.every((episode) => episode.isFree)
          ? preparedEpisodes.length
          : 0,
        lockMode: (preparedEpisodes.every((episode) => episode.isFree)
          ? "ALL_FREE"
          : "VIP_ALL") as "ALL_FREE" | "VIP_ALL",
        status: "DRAFT" as const,
        sourceTags,
        ...(totalEpisodesDirty ? { totalEpisodes } : {}),
      };

      enqueueJob({
        title: titleDisplay,
        mode: "new",
        preferDirect: r2DirectUpload,
        publishWhenReady,
        createDrama,
        episodes: queueEpisodes,
      });

      return {
        id: "",
        totalEpisodes: preparedEpisodes.length,
        mode: "new" as const,
        publishWhenReady,
      };
    },
    onSuccess: async (data) => {
      setError(null);
      setSuccess(
        data.publishWhenReady
          ? t("uploadTaskEnqueuedPublish", { n: data.totalEpisodes })
          : data.mode === "append"
            ? t("uploadTaskEnqueuedAppend", { n: data.totalEpisodes })
            : t("uploadTaskEnqueued", { n: data.totalEpisodes }),
      );
      resetWizardAfterEnqueue(data.mode);
      // Dramas list refreshes when the queue finishes creating the shell.
      if (data.id) {
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
      }
    },
    onError: (e: Error) => {
      setSuccess(null);
      setError(e.message);
    },
  });

  const busy = uploadMut.isPending;
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-ink-muted">
          {showDrafts ? t("draftBoxHint") : t("localWizardHint")}
        </p>
        <Button size="sm" variant="secondary" onClick={() => setShowDrafts((value) => !value)}>
          {showDrafts ? (
            t("draftBackToWizard")
          ) : (
            <>
              <Archive className="h-4 w-4" />
              {t("draftBox")}
              {drafts.length ? ` (${drafts.length})` : ""}
            </>
          )}
        </Button>
      </div>

      {showDrafts ? (
        <section className="upload-panel space-y-3">
          <div className="upload-panel__head">
            <div>
              <h2>{t("draftBox")}</h2>
              <p>{t("draftBoxListHint")}</p>
            </div>
            {drafts.length ? (
              <Button size="sm" variant="ghost" onClick={() => { persistDrafts([]); setEditingDraftId(null); }}>
                <Trash2 className="h-4 w-4" />
                {t("draftClearAll")}
              </Button>
            ) : null}
          </div>
          {!drafts.length ? (
            <p className="py-8 text-center text-body-sm text-ink-muted">{t("draftBoxEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              {drafts.map((draft) => {
                const modeLabel =
                  draft.dramaTarget === "existing" ? t("draftModeAppend") : t("draftModeNew");
                const fileCount = draft.episodeFileCount ?? draft.totalEpisodes ?? 0;
                return (
                  <li
                    key={draft.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <div className="h-14 w-11 shrink-0 overflow-hidden rounded bg-surface">
                      {draft.coverUrl ? (
                        <img src={draft.coverUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Film className="m-3 h-5 w-5 text-ink-subtle" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{draftDisplayTitle(draft)}</p>
                      <p className="text-caption text-ink-muted">
                        {modeLabel}
                        {" · "}
                        {t("draftEpisodeFilesHint", { n: fileCount })}
                        {draft.totalEpisodes > fileCount
                          ? ` · ${t("totalEpisodes")} ${draft.totalEpisodes}`
                          : ""}
                        {" · "}
                        {new Date(draft.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => restoreDraft(draft)}>
                      {t("draftRestore")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteDraft(draft.id)}>
                      <Trash2 className="h-4 w-4" />
                      {t("delete")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <>
      {error ? (
        <div className="content-inline-error">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-success/20 bg-success-soft px-3 py-2 text-body-sm text-ink">
          {success}
        </div>
      ) : null}

      <section className="upload-panel space-y-3">
        <div className="upload-panel__head">
          <div>
            <h2>{t("localWizardTargetTitle")}</h2>
            <p>{t("localWizardTargetHint")}</p>
          </div>
          <div
            className="flex max-w-full flex-wrap items-center justify-end gap-1.5"
            aria-label={t("localWizardStorageTitle")}
            title={t("localWizardStorageHint")}
          >
            <span className={cn("upload-status-pill", destPillTone)} title={destPillTitle}>
              {storageChecking || probeChecking || r2Enabled ? (
                <Cloud className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <HardDrive className="h-3.5 w-3.5" aria-hidden />
              )}
              {destPillLabel}
            </span>
            <span className={cn("upload-status-pill", ffmpegPillTone)} title={ffmpegPillTitle}>
              {ffmpegPillLabel}
            </span>
            {probeOk && probeLatencyMs != null ? (
              <span
                className={cn("upload-status-pill", latencyPillTone)}
                title={t("uploadR2LatencyHint", {
                  ms: probeLatencyMs,
                  media: mediaBucketName,
                  upload: uploadBucketName,
                })}
              >
                {t("uploadR2BucketsLatency", {
                  media: mediaBucketName,
                  upload: uploadBucketName,
                  ms: probeLatencyMs,
                })}
              </span>
            ) : null}
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
                if (key === "new") {
                  setExistingDramaId("");
                  setDramaQuery("");
                  setDramaSearch("");
                  setDramaCommittedLabel("");
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {isExisting ? (
          <div className="space-y-3">
            <DramaPickerCombobox
              value={existingDramaId}
              query={dramaQuery}
              selectedLabel={dramaCommittedLabel}
              onQueryChange={setDramaQuery}
              onSelect={(d) => {
                setExistingDramaId(String(d.id));
                setDramaCommittedLabel(dramaLabel(d));
                setError(null);
              }}
              onClear={() => {
                setExistingDramaId("");
                setDramaCommittedLabel("");
                setError(null);
              }}
              options={dramasQ.data ?? []}
              loading={dramasQ.isLoading && !dramasQ.data}
              disabled={busy}
              label={t("localWizardSelectDrama")}
              placeholder={t("localWizardSearchDramaPh")}
              noMatchLabel={t("localWizardDramaNoMatch")}
              clearLabel={t("localWizardClearDrama")}
              metaFor={(d) => dramaOptionMeta(d, t)}
            />
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

      {showInfoPanel ? (
          <section className="upload-panel upload-panel--info">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadSectionInfo")}</h2>
                <p>
                  {infoLocked
                    ? existingDramaQ.isLoading
                      ? t("loading")
                      : existingDramaQ.isError
                        ? t("localWizardDramaLoadFail")
                        : t("uploadSectionInfoHintExisting")
                    : t("uploadSectionInfoHint")}
                </p>
              </div>
            </div>
            {infoLocked && (existingDramaQ.isLoading || existingDramaQ.isError || !existingDrama) ? null : (
            <div className="upload-info-layout">
              <div className="upload-info-layout__fields">
                <div className="upload-field upload-field--title-stack">
                  <div className="upload-locale-titles">
                    <div className="upload-locale-titles__head">
                      <strong>{t("localeTitlesLabel")}</strong>
                      {!infoLocked ? <small>{t("localeTitleFallbackHint")}</small> : null}
                    </div>
                    <label className="upload-locale-titles__row">
                      <span className="upload-locale-titles__lang">
                        {t("contentTitleLocaleEn")} {!infoLocked ? <b className="text-danger">*</b> : null}
                      </span>
                      <div className="upload-locale-titles__input">
                        <Input
                          required={!infoLocked}
                          maxLength={40}
                          value={infoTitleEn}
                          disabled={busy || infoLocked}
                          readOnly={infoLocked}
                          aria-required={!infoLocked}
                          aria-invalid={!infoLocked && titleTouched && !titleEn.trim()}
                          aria-label={t("contentTitleLocaleEn")}
                          onBlur={() => {
                            if (!infoLocked) setTitleTouched(true);
                          }}
                          onChange={(e) => {
                            if (!infoLocked) setTitleEn(e.target.value);
                          }}
                        />
                        {!infoLocked ? (
                          <em className="upload-locale-titles__count">{titleEn.length}/40</em>
                        ) : null}
                      </div>
                    </label>
                    {!infoLocked && titleTouched && !titleEn.trim() ? (
                      <small className="upload-locale-titles__error text-danger">
                        {t("requiredField")}
                      </small>
                    ) : null}
                    <label className="upload-locale-titles__row">
                      <span className="upload-locale-titles__lang">{t("contentTitleLocaleZh")}</span>
                      <div className="upload-locale-titles__input">
                        <Input
                          maxLength={40}
                          value={infoTitleZh}
                          disabled={busy || infoLocked}
                          readOnly={infoLocked}
                          placeholder={
                            infoLocked
                              ? undefined
                              : titleEn.trim() || t("localeTitleFallbackPlaceholder")
                          }
                          onChange={(e) => {
                            if (!infoLocked) setTitleZh(e.target.value);
                          }}
                          aria-label={t("contentTitleLocaleZh")}
                        />
                        {!infoLocked ? (
                          <em className="upload-locale-titles__count">{titleZh.length}/40</em>
                        ) : null}
                      </div>
                    </label>
                  </div>
                </div>

                <div className="upload-info-row upload-info-row--meta">
                  <div className="upload-field upload-field--tags">
                    <span>
                      {t("dramaTags")}
                      {!tagsLocked ? (
                        <em className="float-right not-italic text-ink-subtle">{tags.length}/{MAX_DRAMA_TAGS}</em>
                      ) : null}
                    </span>
                    <div className="flex flex-wrap gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5">
                      {infoTags.length ? (
                        infoTags.map((tag) =>
                          tagsLocked ? (
                            <span
                              key={tag}
                              className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand"
                            >
                              {tag}
                            </span>
                          ) : (
                            <button
                              type="button"
                              key={tag}
                              className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand"
                              onClick={() => setTags((items) => items.filter((item) => item !== tag))}
                            >
                              {tag} ×
                            </button>
                          ),
                        )
                      ) : tagsLocked ? (
                        <span className="text-sm text-ink-subtle">—</span>
                      ) : null}
                      {!tagsLocked ? (
                        <input
                          className="min-w-24 flex-1 bg-transparent text-sm outline-none"
                          value={tagInput}
                          maxLength={12}
                          placeholder={t("dramaTagsPlaceholder")}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              const tag = tagInput.trim();
                              if (tag && !tags.includes(tag) && tags.length < MAX_DRAMA_TAGS) {
                                setTags((items) => [...items, tag]);
                              }
                              setTagInput("");
                            }
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                  <label className="upload-field upload-field--compact upload-field--category">
                    <span>
                      {t("onlineCategory")} {!infoLocked ? <b className="text-danger">*</b> : null}
                    </span>
                    {infoLocked ? (
                      <Input value={infoCategoryLabel} disabled readOnly />
                    ) : (
                      <Select
                        required
                        value={categorySlug}
                        disabled={busy}
                        aria-required="true"
                        onChange={(e) => setCategorySlug(e.target.value)}
                      >
                        <option value="">{t("selectCategory")}</option>
                        {(categoriesQ.data ?? []).map((c) => (
                          <option key={c.slug} value={c.slug}>
                            {c.nameZh || c.nameEn || c.slug}
                          </option>
                        ))}
                      </Select>
                    )}
                  </label>
                  <label className="upload-field upload-field--episodes">
                    <span>{t("totalEpisodes")}</span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      disabled={busy || infoLocked}
                      readOnly={infoLocked}
                      value={infoTotalEpisodes}
                      aria-label={t("totalEpisodes")}
                      onChange={(e) => {
                        if (infoLocked) return;
                        const raw = e.target.value;
                        if (raw === "") {
                          setTotalEpisodesDirty(false);
                          setTotalEpisodes(episodes.length);
                          return;
                        }
                        // Reject non-integers explicitly (e.g. 12.5) instead of silently floor-ing.
                        const asNumber = Number(raw);
                        if (!Number.isFinite(asNumber) || !Number.isInteger(asNumber)) return;
                        const next = Math.max(0, asNumber);
                        setTotalEpisodesDirty(true);
                        setTotalEpisodes(next);
                      }}
                    />
                  </label>
                  <div className="upload-field upload-field--compact upload-field--content-type">
                    <span>
                      {t("contentType")} <b className="text-danger">*</b>
                    </span>
                    <UploadMetaChips
                      value={infoContentType}
                      disabled={busy || tagsLocked}
                      ariaLabel={t("contentType")}
                      onChange={(value) => {
                        if (!tagsLocked) setContentType(normalizeContentType(value));
                      }}
                      options={[
                        { value: "漫剧", label: t("contentTypeComic") },
                        { value: "真人短剧", label: t("contentTypeLive") },
                        { value: "AI短剧", label: t("contentTypeAi") },
                      ]}
                    />
                  </div>
                  <div className="upload-field upload-field--compact upload-field--completion">
                    <span>
                      {t("completionStatus")} <b className="text-danger">*</b>
                    </span>
                    <UploadMetaChips
                      value={infoCompletion}
                      disabled={busy || tagsLocked}
                      ariaLabel={t("completionStatus")}
                      onChange={(value) => {
                        if (!tagsLocked) setCompletion(value);
                      }}
                      options={[
                        { value: "连载中", label: t("completionOngoing") },
                        { value: "已完结", label: t("completionFinished") },
                      ]}
                    />
                  </div>
                </div>

                <label className="upload-field">
                  <span>
                    {t("onlineDescZh")}
                    {!infoLocked ? (
                      <em className="float-right not-italic text-ink-subtle">
                        {descriptionZh.length}/300
                      </em>
                    ) : null}
                  </span>
                  <textarea
                    className="content-textarea upload-info-desc"
                    rows={3}
                    maxLength={300}
                    value={infoDescriptionZh}
                    disabled={busy || infoLocked}
                    readOnly={infoLocked}
                    onChange={(e) => {
                      if (!infoLocked) setDescriptionZh(e.target.value);
                    }}
                  />
                </label>
              </div>

              <div className="upload-info-layout__cover">
                <div className="upload-field">
                  <span>{t("uploadSectionCover")}</span>
                  <DramaCoverField
                    url={infoCoverUrl || undefined}
                    disabled={busy || infoLocked}
                    videoFile={infoLocked ? undefined : episodes[0]?.file}
                    showAdvancedUrl={!infoLocked}
                    onChange={(url) => {
                      if (!infoLocked) setCoverUrl(url);
                    }}
                    onError={setError}
                  />
                </div>
              </div>
            </div>
            )}
          </section>
      ) : null}

      <section className="upload-panel space-y-4">
        <div className="upload-panel__head">
          <div>
            <h2>{t("localWizardVideosTitle")}</h2>
          </div>
        </div>

        <div className="space-y-3">
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
                  if (!isFileDrag(e)) return;
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  if (!isFileDrag(e)) return;
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
                      {totalDurationSec != null ? ` · ${fmtDuration(totalDurationSec)}` : ""}
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
                    const dragging = dragId === ep.id;
                    const dropTarget = dropId === ep.id && dragId && dragId !== ep.id;
                    return (
                      <div
                        key={ep.id}
                        draggable={!busy}
                        title={t("epCardDragHint")}
                        onDragStart={(e) => {
                          // Don't start card drag from interactive controls.
                          const target = e.target as HTMLElement | null;
                          if (target?.closest("label,input,button,textarea,a")) {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", ep.id);
                          onEpisodeDragStart(ep.id);
                        }}
                        onDragOver={(e) => onEpisodeDragOver(e, ep.id)}
                        onDrop={(e) => {
                          if (isFileDrag(e)) return;
                          e.preventDefault();
                          e.stopPropagation();
                          onEpisodeDrop(ep.id);
                        }}
                        onDragEnd={onEpisodeDragEnd}
                        className={cn(
                          "ep-card",
                          selected && "ep-card--selected",
                          row?.status === "error" && "ep-card--error",
                          dragging && "ep-card--dragging",
                          dropTarget && "ep-card--drop-target",
                        )}
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
                              draggable={false}
                              className="ep-card__thumb"
                            />
                          ) : ep.thumbStatus === "pending" ? (
                            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
                          ) : (
                            <Film className="h-5 w-5" aria-hidden />
                          )}
                          <span
                            className="ep-card__badge"
                            title={t("localWizardEpisodeNumLabel", { n: epNum })}
                            aria-label={t("localWizardEpisodeNumLabel", { n: epNum })}
                          >
                            #{epNum}
                          </span>
                        </div>
                        <Input
                          className="ep-card__title"
                          value={ep.title}
                          disabled={busy}
                          aria-label={t("onlineEpisodeTitle")}
                          placeholder={t("onlineEpisodeTitle")}
                          onChange={(e) => updateEpisodeTitle(ep.id, e.target.value)}
                        />
                        <p
                          className="ep-card__meta"
                          title={`${ep.file.name} · ${fmtSize(ep.file.size)} · ${episodeDurationLabel(ep)}`}
                        >
                          <span>{fmtSize(ep.file.size)}</span>
                          <span className="ep-card__dot" aria-hidden>
                            ·
                          </span>
                          <span
                            className={cn(
                              "ep-card__duration",
                              ep.durationStatus !== "ready" && "is-pending",
                            )}
                            title={t("localWizardEpisodeDuration")}
                          >
                            {episodeDurationLabel(ep)}
                          </span>
                          {(!isExisting && !episodeIsFree) ||
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
                            title={t("moveUpToEp", { n: epNum - 1 })}
                            aria-label={t("moveUpToEp", { n: epNum - 1 })}
                            onClick={() => moveEpisode(ep.id, -1)}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="ep-draft-icon-btn"
                            disabled={busy || i === episodes.length - 1}
                            title={t("moveDownToEp", { n: epNum + 1 })}
                            aria-label={t("moveDownToEp", { n: epNum + 1 })}
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
      </section>

      {!isExisting ? (
          <section className="upload-panel space-y-3">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadSectionPolicy")}</h2>
                <p>{t("uploadSectionPolicyHint")}</p>
              </div>
            </div>
            <div className="policy-mode-grid" aria-label={t("uploadSectionPolicy")}>
              <div className="policy-mode-card">
                <div className="policy-mode-card__body">
                  <strong>{t("policyAllFree")}</strong>
                  <small>{t("policyModeHint")}</small>
                  <div className="policy-range-grid">
                    <label className="upload-field">
                      <span>{t("policyRangeStart")}</span>
                      <Input type="number" min={1} max={episodes.length || undefined} value={freeRangeStart} disabled={busy || !episodes.length} onChange={(e) => setFreeRangeStart(e.target.value)} />
                    </label>
                    <label className="upload-field">
                      <span>{t("policyRangeEnd")}</span>
                      <Input type="number" min={1} max={episodes.length || undefined} value={freeRangeEnd} disabled={busy || !episodes.length} onChange={(e) => setFreeRangeEnd(e.target.value)} />
                    </label>
                  </div>
                </div>
              </div>
              <div className="policy-mode-card">
                <div className="policy-mode-card__body">
                  <strong>{t("policyPartialFree")}</strong>
                  <small>{t("policyMemberHint")}</small>
                  <label className="upload-field">
                    <span>{t("priceCreditsPerEpisode")}</span>
                    <Input type="number" min={1} value={priceCredits} disabled={busy} onChange={(e) => setPriceCredits(Number(e.target.value) || 0)} />
                  </label>
                  <div className="policy-preview-options">
                    <div className="policy-preview-choices" role="radiogroup" aria-label={t("policyAllowPreview")}>
                      <label className="policy-preview-toggle">
                        <input type="radio" name="member-preview-policy" checked={!allowPreview} disabled={busy} onChange={() => setAllowPreview(false)} />
                        <span>{t("policyPreviewDisabled")}</span>
                      </label>
                      <label className="policy-preview-toggle">
                        <input type="radio" name="member-preview-policy" checked={allowPreview} disabled={busy} onChange={() => setAllowPreview(true)} />
                        <span>{t("policyAllowPreview")}</span>
                      </label>
                    </div>
                    {allowPreview ? (
                      <label className="upload-field">
                        <span>{t("policyPreviewSeconds")}</span>
                        <Input type="number" min={1} value={previewSeconds} disabled={busy} onChange={(e) => setPreviewSeconds(Math.max(1, Number(e.target.value) || 10))} />
                      </label>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            {episodes.length > 0 ? (
              <div className="policy-preview is-partial">
                <span className="policy-preview__dot" aria-hidden />
                <p>
                  {t("policyPreviewPartial", {
                    total: episodes.length,
                    free: freeEpisodeCountFromPolicy(),
                    price: priceCredits,
                  })}
                </p>
              </div>
            ) : null}
          </section>
      ) : null}

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
          <Button size="sm" variant="secondary" disabled={busy} onClick={saveLocalDraft}>
            <Save className="h-4 w-4" />{t("saveDraft")}
          </Button>
          <Button
            size="sm"
            disabled={!!fileBlockReason || busy}
            onClick={() => {
              if (isExisting) {
                uploadMut.mutate({ publishWhenReady: false });
                return;
              }
              setSubmitPublishChoice(false);
              setSubmitOpen(true);
            }}
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isExisting ? t("localWizardAppendBtn") : t("nextStep")}
          </Button>
        </div>

        <GlassModal
          open={submitOpen}
          onClose={() => {
            if (!busy) setSubmitOpen(false);
          }}
          title={t("submitDramaDialogTitle")}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-body-sm text-ink-muted">{t("submitDramaDialogHint", { n: episodes.length })}</p>
            <div className="space-y-2" role="radiogroup" aria-label={t("submitDramaDialogTitle")}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                  !submitPublishChoice ? "border-brand bg-brand/5" : "border-line hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  className="mt-1"
                  name="submit-publish-choice"
                  checked={!submitPublishChoice}
                  disabled={busy}
                  onChange={() => setSubmitPublishChoice(false)}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{t("submitChoiceKeepPrivate")}</span>
                  <span className="mt-0.5 block text-caption text-ink-muted">{t("submitChoiceKeepPrivateHint")}</span>
                </span>
              </label>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                  submitPublishChoice ? "border-brand bg-brand/5" : "border-line hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  className="mt-1"
                  name="submit-publish-choice"
                  checked={submitPublishChoice}
                  disabled={busy}
                  onChange={() => setSubmitPublishChoice(true)}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{t("submitChoiceGoPublic")}</span>
                  <span className="mt-0.5 block text-caption text-ink-muted">{t("submitChoiceGoPublicHint")}</span>
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSubmitOpen(false)}>
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  uploadMut.mutate(
                    { publishWhenReady: submitPublishChoice },
                    {
                      onSuccess: () => setSubmitOpen(false),
                    },
                  );
                }}
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t("confirmSubmitDrama")}
              </Button>
            </div>
          </div>
        </GlassModal>
        </>
      )}
    </div>
  );
}
