"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateOnlineDrama,
  adminListCreators,
  adminListSettings,
  adminStorageProbe,
  adminStorageStatus,
  adminTranslateTitles,
  adminUploadImage,
  adminYtdlpPreviewFrame,
  adminYtdlpTransfer,
  adminTelegramTransfer,
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
  Link2,
  Trash2,
  Upload,
  Save,
  Archive,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { DramaCoverField } from "@/components/drama-cover-field";
import { DramaPlaybackPolicyForm } from "@/components/drama-playback-policy-form";
import { GlassModal } from "@/components/glass-modal";
import {
  WatermarkPositionEditor,
  DEFAULT_PLACEMENT,
  type WatermarkPlacement,
} from "@/components/watermark-position-editor";
import {
  captureVideoFirstFrameWithMeta,
  probeLocalVideoDuration,
} from "@/lib/capture-video-frame";
import { contentDetailHref } from "@/lib/content-href";
import { mediaUrl } from "@/lib/media-url";
import {
  DEFAULT_COMPLETION,
  DEFAULT_CONTENT_TYPE,
  MAX_DRAMA_TAGS,
  composeDramaSourceTags,
  normalizeCompletion,
  normalizeContentType,
  type DramaCompletion,
  type DramaContentType,
} from "@/lib/drama-tags";
import { DramaTagPicker } from "@/components/drama-tag-picker";
import type {
  DramaInfoFillPayload,
  OnlineSourcePackage,
} from "@/lib/drama-info-fill";
import {
  calcBuyoutCredits,
  freeCountWhenInheriting,
  freeThruWhenInheriting,
  parseLockMode,
  resolveCustomFreePolicy,
  stampFreeCountWhenInheriting,
} from "@/lib/drama-playback-policy";
import { useI18n } from "@/lib/i18n";
import { isPlayableMediaUrl } from "@/lib/playable-url";
import { useUploadQueue } from "@/lib/upload-queue";
import { VIDEO_ACCEPT, isVideoFile } from "@/lib/video-formats";

type CreatorOption = { id: string | number; displayName?: string };
type DraftRecord = {
  id: string;
  titleZh: string;
  titleEn?: string;
  titleFr?: string;
  categorySlug: string;
  creatorId?: string;
  tags: string[];
  /** Primary synopsis (English). Legacy drafts may only have descriptionZh. */
  descriptionEn?: string;
  descriptionZh?: string;
  coverUrl: string;
  contentType: string;
  completion: string;
  totalEpisodes: number;
  /** Staged video count at save time (File objects are not persisted). */
  episodeFileCount?: number;
  updatedAt: string;
  freeRangeStart?: string;
  freeRangeEnd?: string;
  allFree?: boolean;
  priceCredits?: number;
  buyoutDiscountPercent?: number;
  allowPreview?: boolean;
  previewSeconds?: number;
  inheritGlobal?: boolean;
};

/** Prefer English for draft list labels (viewer primary title). */
function draftDisplayTitle(draft: DraftRecord) {
  return draft.titleEn || draft.titleZh || draft.titleFr || "—";
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
  /** Local file upload vs online playable / page URL resource. */
  kind: "file" | "link";
  file?: File;
  /** Direct playable URL (manual paste or resolved). */
  sourceUrl?: string;
  /** Public page URL for a probe item (may need server resolve). */
  webpageUrl?: string;
  /** Telegram message id when staged from Telethon probe. */
  messageId?: number;
  /** yt-dlp playlist entry index when applicable. */
  playlistIndex?: number;
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

/** Page-level ingest preference from 在线入库 apply (executed on main submit). */
type OnlineIngestMeta = {
  pageUrl: string;
  ingestForm: OnlineSourcePackage["ingestForm"];
  provider?: OnlineSourcePackage["provider"];
  telegramChannel?: string;
  formatPreference?: OnlineSourcePackage["formatPreference"];
  maxEpisodes?: number;
  cookiesFile?: string;
  authBearer?: string;
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
  segmentSeconds?: number;
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

function makeLinkEpisodeId(url: string, index: number) {
  return `link:${index}:${url.slice(0, 120)}:${Math.random().toString(36).slice(2, 9)}`;
}

function sortVideoFiles(list: File[]) {
  return [...list].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
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

export type LocalUploadWizardHandle = {
  applyDramaInfo: (payload: DramaInfoFillPayload) => void;
};

export const LocalUploadWizard = forwardRef<
  LocalUploadWizardHandle,
  {
    /** 打开「在线入库」弹窗（由 ContentAddPanel 托管） */
    onRequestOnline?: () => void;
  }
>(function LocalUploadWizard({ onRequestOnline }, ref) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { enqueueJob, enqueueTransferJob } = useUploadQueue();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const [titleZh, setTitleZh] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleFr, setTitleFr] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [translateBusy, setTranslateBusy] = useState(false);
  const [categorySlug, setCategorySlug] = useState("");
  const [creatorId, setCreatorId] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [contentType, setContentType] = useState<DramaContentType>(DEFAULT_CONTENT_TYPE);
  const [completion, setCompletion] = useState<DramaCompletion>(DEFAULT_COMPLETION);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [totalEpisodesDirty, setTotalEpisodesDirty] = useState(false);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [priceCredits, setPriceCredits] = useState(10);
  const [buyoutDiscountPercent, setBuyoutDiscountPercent] = useState(70);
  const [allowPreview, setAllowPreview] = useState(false);
  const [previewSeconds, setPreviewSeconds] = useState(10);
  const [freeRangeStart, setFreeRangeStart] = useState("1");
  const [freeRangeEnd, setFreeRangeEnd] = useState("");
  /** Explicit ALL_FREE lock mode — not freeEnd === episode total. */
  const [allFree, setAllFree] = useState(false);
  /** Default ON — drama follows platform global lock policy on create. */
  const [inheritGlobal, setInheritGlobal] = useState(true);
  const [episodes, setEpisodes] = useState<EpisodeDraft[]>([]);
  /** Page-level online ingest preference (R2 transfer / parse-import); episodes live in `episodes`. */
  const [onlineIngest, setOnlineIngest] = useState<OnlineIngestMeta | null>(null);
  const [watermark, setWatermark] = useState<WatermarkPlacement>(DEFAULT_PLACEMENT);
  const [watermarkFrame, setWatermarkFrame] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const [watermarkFrameBusy, setWatermarkFrameBusy] = useState(false);
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
  const onlineIngestRef = useRef(onlineIngest);
  onlineIngestRef.current = onlineIngest;
  /** Set after hydrate helpers are defined — used from applyDramaInfo. */
  const queueLinkThumbHydrationRef = useRef<(eps: EpisodeDraft[]) => void>(() => {});

  useImperativeHandle(
    ref,
    () => ({
      applyDramaInfo(payload) {
        setShowDrafts(false);
        const overwrite = payload.overwriteMeta === true;
        const hasMeta =
          payload.titleEn !== undefined ||
          payload.titleZh !== undefined ||
          payload.titleFr !== undefined ||
          payload.coverUrl !== undefined ||
          payload.descriptionEn !== undefined ||
          payload.descriptionZh !== undefined ||
          payload.categorySlug !== undefined ||
          payload.tags !== undefined ||
          payload.completion !== undefined ||
          payload.totalEpisodes !== undefined;

        if (payload.titleEn !== undefined) {
          setTitleEn((prev) =>
            !overwrite && prev.trim() ? prev : payload.titleEn!.slice(0, 40),
          );
          setTitleTouched(true);
        }
        if (payload.titleZh !== undefined) {
          setTitleZh((prev) =>
            !overwrite && prev.trim() ? prev : payload.titleZh!.slice(0, 40),
          );
        }
        if (payload.titleFr !== undefined) {
          setTitleFr((prev) =>
            !overwrite && prev.trim() ? prev : payload.titleFr!.slice(0, 40),
          );
        }
        if (payload.coverUrl !== undefined) {
          setCoverUrl((prev) =>
            !overwrite && prev.trim() ? prev : payload.coverUrl!,
          );
        }
        if (payload.descriptionEn !== undefined) {
          setDescriptionEn((prev) =>
            !overwrite && prev.trim()
              ? prev
              : payload.descriptionEn!.slice(0, 300),
          );
        } else if (payload.descriptionZh !== undefined) {
          // Legacy fill payloads used descriptionZh for the primary synopsis.
          setDescriptionEn((prev) =>
            !overwrite && prev.trim()
              ? prev
              : payload.descriptionZh!.slice(0, 300),
          );
        }
        if (payload.categorySlug !== undefined && payload.categorySlug) {
          setCategorySlug((prev) =>
            !overwrite && prev.trim() ? prev : payload.categorySlug!,
          );
        }
        if (payload.tags !== undefined && payload.tags.length) {
          setTags((prev) => {
            if (!overwrite && prev.length) return prev;
            return payload.tags!.map((t) => t.trim()).filter(Boolean).slice(0, MAX_DRAMA_TAGS);
          });
        }
        if (payload.completion !== undefined) {
          setCompletion((prev) =>
            !overwrite && prev !== DEFAULT_COMPLETION ? prev : payload.completion!,
          );
        }
        if (payload.totalEpisodes !== undefined && payload.totalEpisodes >= 0) {
          setTotalEpisodes((prev) =>
            !overwrite && prev > 0 ? prev : payload.totalEpisodes!,
          );
          setTotalEpisodesDirty(true);
        }
        if (payload.online) {
          const nextOnline = {
            pageUrl: payload.online.pageUrl.trim(),
            ingestForm: payload.online.ingestForm,
            provider: payload.online.provider || "ytdlp",
            telegramChannel: payload.online.telegramChannel,
            formatPreference: payload.online.formatPreference,
            maxEpisodes: payload.online.maxEpisodes,
            cookiesFile: payload.online.cookiesFile,
            authBearer: payload.online.authBearer,
            watermarkEnabled: payload.online.watermarkEnabled,
            watermarkX: payload.online.watermarkX,
            watermarkY: payload.online.watermarkY,
            watermarkScale: payload.online.watermarkScale,
            segmentSeconds: payload.online.segmentSeconds,
          };
          onlineIngestRef.current = nextOnline;
          const incoming: EpisodeDraft[] = payload.online.episodes.map((ep, i) => {
            const sourceUrl = ep.sourceUrl?.trim() || undefined;
            const webpageUrl = ep.webpageUrl?.trim() || undefined;
            const title =
              (ep.title || "").trim() ||
              defaultEpisodeTitle(sourceUrl || webpageUrl || `ep-${ep.episodeNumber || i + 1}`);
            const hasFrameSource = !!(
              (sourceUrl && /^https?:\/\//i.test(sourceUrl)) ||
              (webpageUrl && /^https?:\/\//i.test(webpageUrl))
            );
            // R2 transfer extracts permanent first frames after download — do not
            // preview-frame all episodes here (yt-dlp+ffmpeg×N is extremely slow).
            const stageThumbs = nextOnline.ingestForm !== "r2";
            return {
              id: makeLinkEpisodeId(sourceUrl || webpageUrl || title, i),
              kind: "link" as const,
              sourceUrl,
              webpageUrl,
              messageId: ep.messageId,
              playlistIndex: ep.playlistIndex,
              title: title.slice(0, 80),
              isFree: true,
              previewSeconds: 0,
              // Episode covers come from each video's first frame — never the drama poster.
              thumbStatus: stageThumbs
                ? hasFrameSource
                  ? ("pending" as const)
                  : ("error" as const)
                : undefined,
              durationSec: ep.durationSec,
              durationStatus:
                ep.durationSec != null ? ("ready" as const) : ("unknown" as const),
            };
          });
          setOnlineIngest(nextOnline);
          setWatermark({
            enabled: !!payload.online.watermarkEnabled,
            x: payload.online.watermarkX ?? DEFAULT_PLACEMENT.x,
            y: payload.online.watermarkY ?? DEFAULT_PLACEMENT.y,
            scale: payload.online.watermarkScale ?? DEFAULT_PLACEMENT.scale,
          });
          if (incoming.length) {
            setEpisodes((prev) => {
              // Online apply replaces prior link rows so only the latest selection is staged.
              for (const ep of prev) {
                if (ep.kind === "link") revokeThumbPreview(ep.thumbPreviewUrl);
              }
              const keptFiles = prev.filter((ep) => ep.kind === "file");
              const next = [...keptFiles, ...incoming];
              episodesRef.current = next;
              if (!freeRangeEnd) setFreeRangeEnd(String(next.length));
              return next;
            });
            if (nextOnline.ingestForm !== "r2") {
              queueLinkThumbHydrationRef.current(
                incoming.filter((ep) => ep.thumbStatus === "pending"),
              );
            }
          } else {
            setEpisodes((prev) => {
              for (const ep of prev) {
                if (ep.kind === "link") revokeThumbPreview(ep.thumbPreviewUrl);
              }
              const next = prev.filter((ep) => ep.kind === "file");
              episodesRef.current = next;
              return next;
            });
          }
        }
        setError(null);
        setSuccess(
          payload.online
            ? t("ytdlpFillDramaInfoDone")
            : hasMeta
              ? t("ytdlpFillMetaDone")
              : t("ytdlpFillDramaInfoDone"),
        );
      },
    }),
    [t, freeRangeEnd],
  );

  /** Watermark preview: online R2 uses server first-frame; local files use browser capture. */
  useEffect(() => {
    if (!watermark.enabled) {
      setWatermarkFrame((prev) => {
        if (prev?.url?.startsWith("blob:")) URL.revokeObjectURL(prev.url);
        return null;
      });
      setWatermarkFrameBusy(false);
      return;
    }

    const onlineR2 = onlineIngest?.ingestForm === "r2";
    if (onlineR2) {
      const linkEps = episodes.filter((ep) => ep.kind === "link");
      const pick =
        linkEps.find((ep) => isPlayableMediaUrl(ep.sourceUrl?.trim())) ||
        linkEps.find((ep) => (ep.sourceUrl || ep.webpageUrl || "").trim()) ||
        null;
      const direct = pick?.sourceUrl?.trim();
      const targetUrl =
        (direct && isPlayableMediaUrl(direct) ? direct : undefined) ||
        pick?.webpageUrl?.trim() ||
        direct ||
        "";
      if (!/^https?:\/\//i.test(targetUrl)) {
        setWatermarkFrame((prev) => {
          if (prev?.url?.startsWith("blob:")) URL.revokeObjectURL(prev.url);
          return null;
        });
        setWatermarkFrameBusy(false);
        return;
      }

      let cancelled = false;
      setWatermarkFrameBusy(true);
      void adminYtdlpPreviewFrame({
        url: targetUrl,
        formatPreference:
          onlineIngest.formatPreference === "best_hls"
            ? "best_mp4"
            : onlineIngest.formatPreference || "best_mp4",
        playlistIndex: pick?.playlistIndex,
        cookiesFile: onlineIngest.cookiesFile,
        authBearer: onlineIngest.authBearer,
      })
        .then((frame) => {
          if (cancelled) return;
          setWatermarkFrame((prev) => {
            if (prev?.url?.startsWith("blob:")) URL.revokeObjectURL(prev.url);
            return {
              url: frame.url,
              width: frame.width,
              height: frame.height,
            };
          });
        })
        .catch(() => {
          if (!cancelled) {
            setWatermarkFrame((prev) => {
              if (prev?.url?.startsWith("blob:")) URL.revokeObjectURL(prev.url);
              return null;
            });
          }
        })
        .finally(() => {
          if (!cancelled) setWatermarkFrameBusy(false);
        });

      return () => {
        cancelled = true;
      };
    }

    const firstFile = episodes.find((ep) => ep.kind === "file" && ep.file)?.file;
    if (!firstFile) {
      setWatermarkFrame((prev) => {
        if (prev?.url?.startsWith("blob:")) URL.revokeObjectURL(prev.url);
        return null;
      });
      setWatermarkFrameBusy(false);
      return;
    }

    let cancelled = false;
    setWatermarkFrameBusy(true);
    void captureVideoFirstFrameWithMeta(firstFile)
      .then(async ({ blob }) => {
        const url = URL.createObjectURL(blob);
        const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () =>
            resolve({ width: img.naturalWidth || 1280, height: img.naturalHeight || 720 });
          img.onerror = () => reject(new Error("frame image decode failed"));
          img.src = url;
        });
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setWatermarkFrame((prev) => {
          if (prev?.url?.startsWith("blob:")) URL.revokeObjectURL(prev.url);
          return { url, ...dims };
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWatermarkFrame((prev) => {
            if (prev?.url?.startsWith("blob:")) URL.revokeObjectURL(prev.url);
            return null;
          });
        }
      })
      .finally(() => {
        if (!cancelled) setWatermarkFrameBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onlineIngest, watermark.enabled, episodes]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_DRAFTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      setDrafts(
        parsed
          .filter((item): item is DraftRecord => {
            if (!item || typeof item !== "object" || typeof (item as DraftRecord).id !== "string") {
              return false;
            }
            // Legacy "append to existing" drafts are no longer supported on this page.
            if ((item as { dramaTarget?: string }).dramaTarget === "existing") return false;
            return true;
          })
          .map((item) => {
            const {
              dramaTarget: _dt,
              existingDramaId: _id,
              existingDramaLabel: _label,
              ...rest
            } = item as DraftRecord & {
              dramaTarget?: string;
              existingDramaId?: string;
              existingDramaLabel?: string;
            };
            return rest as DraftRecord;
          }),
      );
    } catch { /* ignore malformed local drafts */ }
  }, []);

  // Auto-fill 总集数 from staged episode count until the user overrides (or clears).
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
    const fr = titleFr.trim();
    const id = editingDraftId || `${Date.now()}`;
    const record: DraftRecord = {
      id,
      titleZh: zh || en || "未命名剧集",
      titleEn: en || undefined,
      titleFr: fr || undefined,
      categorySlug,
      creatorId: creatorId || undefined,
      tags,
      descriptionEn,
      coverUrl,
      contentType,
      completion,
      totalEpisodes,
      episodeFileCount: episodes.length,
      updatedAt: new Date().toISOString(),
      freeRangeStart,
      freeRangeEnd,
      allFree,
      priceCredits,
      buyoutDiscountPercent,
      allowPreview,
      previewSeconds,
      inheritGlobal,
    };
    persistDrafts([record, ...drafts.filter((item) => item.id !== id)]);
    setEditingDraftId(id);
    setError(null);
    setSuccess(null);
    setShowDrafts(true);
  }

  function restoreDraft(record: DraftRecord) {
    setTitleZh(record.titleZh === "未命名剧集" ? "" : record.titleZh);
    setTitleEn(record.titleEn || "");
    setTitleFr(record.titleFr || "");
    setTitleTouched(Boolean(record.titleEn?.trim() || (record.titleZh && record.titleZh !== "未命名剧集")));
    setCategorySlug(record.categorySlug || "");
    setCreatorId(record.creatorId || "");
    setTags(record.tags || []);
    setDescriptionEn(record.descriptionEn || record.descriptionZh || "");
    setCoverUrl(record.coverUrl || "");
    setContentType(normalizeContentType(record.contentType));
    setCompletion(normalizeCompletion(record.completion));
    setFreeRangeStart(record.freeRangeStart || "1");
    setFreeRangeEnd(record.freeRangeEnd || "");
    setAllFree(record.allFree ?? false);
    setPriceCredits(record.priceCredits || 10);
    setBuyoutDiscountPercent(
      record.buyoutDiscountPercent != null
        ? Math.min(100, Math.max(0, Math.floor(Number(record.buyoutDiscountPercent) || 0)))
        : 70,
    );
    setAllowPreview(record.allowPreview ?? false);
    setPreviewSeconds(record.previewSeconds || 10);
    setInheritGlobal(record.inheritGlobal ?? true);
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

  async function completeTitleTranslation() {
    const en = titleEn.trim();
    if (!en) {
      setError(t("translateTitlesNeedOne"));
      return;
    }
    setTranslateBusy(true);
    setError(null);
    try {
      const res = await adminTranslateTitles({ titleEn: en });
      const nextZh = String(res.titleZh || "").trim();
      const nextFr = String(res.titleFr || "").trim();
      setTitleEn(String(res.titleEn || en).trim());
      if (nextZh) setTitleZh(nextZh);
      if (nextFr) setTitleFr(nextFr);
      setTitleTouched(true);
      if (!nextFr) {
        setError(t("translateTitlesFailed") + " (Français)");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("translateTitlesFailed"));
    } finally {
      setTranslateBusy(false);
    }
  }

  const validateInfo = useCallback(() => {
    const en = titleEn.trim();
    if (!en) return t("uploadBlockTitleEn");
    if (en.length > 40) return t("dramaTitleTooLong");
    if (titleZh.trim().length > 40) return t("dramaTitleTooLong");
    if (descriptionEn.trim().length > 300) return t("dramaDescriptionTooLong");
    if (tags.length > MAX_DRAMA_TAGS) return t("dramaTagsTooMany");
    if (episodes.length < 1) return t("uploadBlockFiles");
    const fileEps = episodes.filter((ep) => ep.kind === "file");
    const linkEps = episodes.filter((ep) => ep.kind === "link");
    if (onlineIngest?.ingestForm === "r2" && !fileEps.length) {
      if (onlineIngest.provider === "telegram") {
        const hasMsg = linkEps.some((ep) => ep.messageId != null && ep.messageId > 0);
        if (!hasMsg && !onlineIngest.telegramChannel?.trim() && !onlineIngest.pageUrl.trim()) {
          return t("telegramNeedProbe");
        }
        const missing = linkEps.filter(
          (ep) => !(ep.messageId != null && ep.messageId > 0),
        );
        if (linkEps.length && missing.length) {
          return t("onlineNeedDownloadEpisodes", {
            n: String(missing.length),
            total: String(linkEps.length),
          });
        }
      } else {
      const pageUrl = onlineIngest.pageUrl.trim();
      const hasDownloadable = linkEps.some(
        (ep) =>
          isPlayableMediaUrl(ep.sourceUrl?.trim()) ||
          !!(ep.webpageUrl || ep.sourceUrl)?.trim(),
      );
      if (!pageUrl && !hasDownloadable) return t("ytdlpNeedUrl");
      const missing = linkEps.filter((ep) => {
        const src = ep.sourceUrl?.trim();
        const page = ep.webpageUrl?.trim();
        return !src && !page;
      });
      if (linkEps.length && missing.length) {
        return t("onlineNeedDownloadEpisodes", {
          n: String(missing.length),
          total: String(linkEps.length),
        });
      }
      }
    } else if (!fileEps.length && linkEps.length) {
      const unplayable = linkEps.filter(
        (ep) => !isPlayableMediaUrl(ep.sourceUrl?.trim()),
      );
      if (unplayable.length) {
        return t("onlineNeedPlayableEpisodes", {
          n: String(unplayable.length),
          total: String(linkEps.length),
        });
      }
    }
    if (fileEps.some((episode) => !episode.isFree) && priceCredits <= 0) {
      return t("policyPriceInvalid");
    }
    // Only validate when the operator manually overrode 总集数 (empty/auto remains allowed).
    if (totalEpisodesDirty) {
      if (!Number.isInteger(totalEpisodes)) return t("totalEpisodesMustBeInteger");
      if (totalEpisodes < episodes.length) {
        return t("totalEpisodesMustExceedUploaded", { n: episodes.length });
      }
    }
    return null;
  }, [
    categorySlug,
    descriptionEn,
    episodes,
    onlineIngest,
    priceCredits,
    t,
    tags,
    titleEn,
    titleZh,
    totalEpisodes,
    totalEpisodesDirty,
  ]);

  useEffect(() => {
    return () => {
      for (const ep of episodesRef.current) {
        if (ep.thumbPreviewUrl) URL.revokeObjectURL(ep.thumbPreviewUrl);
      }
    };
  }, []);

  const creatorsQ = useQuery({
    queryKey: ["admin", "creators", "picker"],
    queryFn: async () => {
      const result = await adminListCreators({ page: 1, pageSize: 100 });
      return asRows<CreatorOption>(result);
    },
    staleTime: 60_000,
  });
  const settingsQ = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const result = (await adminListSettings()) as {
        items?: Array<{ key: string; value: unknown }>;
      };
      return result.items ?? [];
    },
    staleTime: 60_000,
  });
  const appliedPreviewDefaultRef = useRef(false);
  useEffect(() => {
    if (!settingsQ.data || appliedPreviewDefaultRef.current || editingDraftId) return;
    appliedPreviewDefaultRef.current = true;
    const raw = Number(
      settingsQ.data.find((item) => item.key === "defaultPreviewSeconds")?.value,
    );
    const n = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    setAllowPreview(n > 0);
    if (n > 0) setPreviewSeconds(n);
    const priceRaw = Number(
      settingsQ.data.find((item) => item.key === "defaultPriceCredits")?.value,
    );
    if (Number.isFinite(priceRaw) && priceRaw >= 1) setPriceCredits(Math.floor(priceRaw));
    const discountRaw = Number(
      settingsQ.data.find((item) => item.key === "defaultBuyoutDiscountPercent")?.value,
    );
    if (Number.isFinite(discountRaw)) {
      setBuyoutDiscountPercent(Math.min(100, Math.max(0, Math.floor(discountRaw))));
    }
  }, [settingsQ.data, editingDraftId]);

  const globalMode = useMemo(() => {
    const raw = settingsQ.data?.find((item) => item.key === "episodeLockMode")?.value;
    return parseLockMode(raw);
  }, [settingsQ.data]);
  const globalFreeCount = useMemo(() => {
    const n = Number(settingsQ.data?.find((item) => item.key === "defaultFreeEpisodes")?.value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3;
  }, [settingsQ.data]);
  const globalPreviewSeconds = useMemo(() => {
    const n = Number(settingsQ.data?.find((item) => item.key === "defaultPreviewSeconds")?.value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }, [settingsQ.data]);

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

  const totalBytes = useMemo(
    () => episodes.reduce((s, ep) => s + (ep.file?.size ?? 0), 0),
    [episodes],
  );
  const fileEpisodeCount = episodes.filter((ep) => ep.kind === "file").length;
  const linkEpisodeCount = episodes.filter((ep) => ep.kind === "link").length;
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
    const needsFfmpeg = episodes.some((ep) => ep.kind === "file") || onlineIngest?.ingestForm === "r2";
    if (needsFfmpeg && !ffmpegReady) return t("uploadBlockFfmpeg");
    const infoError = validateInfo();
    if (infoError) return infoError;
    if (!episodes.length) return t("uploadBlockFiles");
    return null;
  }, [
    storageQ.isLoading,
    storageQ.isError,
    storageErrorMessage,
    ffmpegReady,
    onlineIngest,
    episodes,
    t,
    validateInfo,
  ]);

  function resolvePolicyForTotal(total: number) {
    const discount = Math.min(100, Math.max(0, Math.floor(Number(buyoutDiscountPercent) || 0)));
    if (inheritGlobal) {
      const freeThru = freeThruWhenInheriting({
        total,
        globalMode,
        globalFreeCount,
      });
      const freeForBuyout = freeCountWhenInheriting({
        total,
        globalMode,
        globalFreeCount,
      });
      const credits = Math.max(1, priceCredits || 10);
      return {
        createLockMode: null as null,
        freeThru,
        // Always stamp global freeCount when Follow Global (matches API resolveForDrama).
        freeCount: stampFreeCountWhenInheriting(globalFreeCount),
        previewSec: globalPreviewSeconds > 0 ? globalPreviewSeconds : 0,
        credits,
        buyoutCredits: calcBuyoutCredits({
          episodeTotal: total,
          freeCount: freeForBuyout,
          priceCredits: credits,
          discountPercent: discount,
        }),
      };
    }

    let custom: ReturnType<typeof resolveCustomFreePolicy>;
    try {
      custom = resolveCustomFreePolicy(total, freeRangeStart, freeRangeEnd, allFree);
    } catch {
      throw new Error(t("policyRangeInvalid", { total: total || 1 }));
    }
    const credits = Math.max(1, priceCredits || 10);
    const freeForBuyout =
      custom.lockMode === "ALL_FREE"
        ? total
        : custom.lockMode === "VIP_ALL"
          ? 0
          : Math.min(total, custom.freeCount);
    return {
      createLockMode: custom.lockMode,
      freeThru: custom.lockMode === "ALL_FREE" ? Number.POSITIVE_INFINITY : custom.freeThru,
      freeCount: custom.freeCount,
      previewSec: allowPreview ? Math.max(1, Math.floor(Number(previewSeconds) || 10)) : 0,
      credits,
      buyoutCredits: calcBuyoutCredits({
        episodeTotal: total,
        freeCount: freeForBuyout,
        priceCredits: credits,
        discountPercent: discount,
      }),
    };
  }

  function episodeIsFreeForUpload(_episodeNumber: number, indexInBatch: number) {
    const n = indexInBatch + 1;
    try {
      const policy = resolvePolicyForTotal(Math.max(episodes.length, n));
      if (policy.createLockMode === "ALL_FREE") return true;
      return n <= policy.freeThru;
    } catch {
      return true;
    }
  }

  function revokeThumbPreview(url?: string) {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  /**
   * Online link (外链) episodes: server first-frame → preview + permanent thumbnailUrl.
   * Skipped for R2 ingest — transfer job extracts frames after download.
   * Soft-fail so staging still works if ffmpeg/resolve is unavailable.
   */
  async function hydrateLinkEpisodeThumb(seed: EpisodeDraft) {
    if (onlineIngestRef.current?.ingestForm === "r2") return;
    const id = seed.id;
    const live = episodesRef.current.find((ep) => ep.id === id);
    if (live && live.kind !== "link") return;
    if (live?.thumbnailUrl && live.thumbStatus === "ready") return;

    const ep = live?.kind === "link" ? live : seed;
    const online = onlineIngestRef.current;
    const direct = ep.sourceUrl?.trim();
    const targetUrl =
      (direct && isPlayableMediaUrl(direct) ? direct : undefined) ||
      ep.webpageUrl?.trim() ||
      direct ||
      "";
    if (!/^https?:\/\//i.test(targetUrl)) {
      setEpisodes((prev) => {
        const idx = prev.findIndex((e) => e.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], thumbStatus: "error" };
        return next;
      });
      return;
    }

    try {
      const frame = await adminYtdlpPreviewFrame({
        url: targetUrl,
        formatPreference:
          online?.formatPreference === "best_hls"
            ? "best_mp4"
            : online?.formatPreference || "best_mp4",
        playlistIndex: ep.playlistIndex,
        cookiesFile: online?.cookiesFile,
        authBearer: online?.authBearer,
      });
      const preview = mediaUrl(frame.url) || frame.url;
      let kept = false;
      setEpisodes((prev) => {
        const idx = prev.findIndex((e) => e.id === id);
        if (idx < 0) return prev;
        kept = true;
        const next = [...prev];
        revokeThumbPreview(next[idx].thumbPreviewUrl);
        next[idx] = {
          ...next[idx],
          thumbPreviewUrl: preview,
          thumbStatus: "pending",
        };
        return next;
      });
      if (!kept) return;

      const res = await fetch(preview);
      if (!res.ok) throw new Error(`frame fetch ${res.status}`);
      const blob = await res.blob();
      const saved = await adminUploadImage(blob, {
        kind: "thumbnail",
        filename: `${(ep.title || "episode").replace(/[^\w\u4e00-\u9fff-]+/g, "").slice(0, 40) || "episode"}-thumb.jpg`,
      });
      setEpisodes((prev) => {
        const idx = prev.findIndex((e) => e.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          thumbnailUrl: saved.url,
          thumbPreviewUrl: mediaUrl(saved.url) || saved.url,
          thumbStatus: "ready",
        };
        return next;
      });
    } catch {
      setEpisodes((prev) => {
        const idx = prev.findIndex((e) => e.id === id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], thumbStatus: "error" };
        return next;
      });
    }
  }

  function queueLinkThumbHydration(seeds: EpisodeDraft[]) {
    if (!seeds.length) return;
    if (onlineIngestRef.current?.ingestForm === "r2") return;
    const concurrency = 2;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, seeds.length) }, async () => {
      while (cursor < seeds.length) {
        const i = cursor++;
        const seed = seeds[i];
        // Skip if this draft was replaced by a newer online apply.
        if (!episodesRef.current.some((ep) => ep.id === seed.id && ep.kind === "link")) continue;
        await hydrateLinkEpisodeThumb(seed);
      }
    });
    void Promise.all(workers);
  }
  queueLinkThumbHydrationRef.current = queueLinkThumbHydration;

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
    const base = (ep.file?.name || ep.title || "episode").replace(/\.[^.]+$/, "") || "episode";
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
    const known = new Set(
      episodesRef.current.filter((ep) => ep.file).map((ep) => fileKey(ep.file!)),
    );
    const incoming: EpisodeDraft[] = videos
      .filter((f) => !known.has(fileKey(f)))
      .map((file) => ({
        id: makeEpisodeId(file),
        kind: "file" as const,
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
      if (ep.file) void hydrateEpisodeThumb(ep.id, ep.file);
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
    setOnlineIngest(null);
    setWatermark(DEFAULT_PLACEMENT);
    setWatermarkFrame(null);
    setWatermarkFrameBusy(false);
  }

  function resetWizardAfterEnqueue() {
    clearAllEpisodes();
    setOnlineIngest(null);
    setWatermark(DEFAULT_PLACEMENT);
    setWatermarkFrame(null);
    setWatermarkFrameBusy(false);
    setEditingDraftId(null);
    setProgress({});
    setTitleZh("");
    setTitleEn("");
    setTitleTouched(false);
    setCoverUrl("");
    setCreatorId("");
    setDescriptionEn("");
    setTags([]);
    setContentType(DEFAULT_CONTENT_TYPE);
    setCompletion(DEFAULT_COMPLETION);
    setTotalEpisodes(0);
    setTotalEpisodesDirty(false);
    setFreeRangeStart("1");
    setFreeRangeEnd("");
    setAllFree(false);
    setPriceCredits(10);
    setBuyoutDiscountPercent(70);
    setAllowPreview(false);
    setPreviewSeconds(10);
    setInheritGlobal(true);
  }

  function prepareEpisodesForSubmit() {
    const total = episodes.length;
    if (!total) return episodes;

    const policy = resolvePolicyForTotal(total);
    if (
      policy.createLockMode !== "ALL_FREE" &&
      policy.freeThru < total &&
      policy.credits <= 0
    ) {
      throw new Error(t("policyPriceInvalid"));
    }

    return episodes.map((episode, index) => {
      const isFree =
        policy.createLockMode === "ALL_FREE" || index + 1 <= policy.freeThru;
      return {
        ...episode,
        isFree,
        previewSeconds: isFree ? 0 : policy.previewSec,
      };
    });
  }

  const onlineSubmitMut = useMutation({
    mutationFn: async () => {
      if (fileBlockReason) throw new Error(fileBlockReason);
      const linkEps = episodes.filter((ep) => ep.kind === "link");
      const fileEps = episodes.filter((ep) => ep.kind === "file");
      if (fileEps.length) {
        throw new Error(t("onlineMixSubmitHint"));
      }
      if (!linkEps.length) throw new Error(t("onlineNeedEpisodes"));

      const englishTitle = titleEn.trim();
      const titleZhResolved = titleZh.trim() || undefined;
      const max =
        onlineIngest?.maxEpisodes && onlineIngest.maxEpisodes > 0
          ? onlineIngest.maxEpisodes
          : undefined;
      const pageUrl = onlineIngest?.pageUrl?.trim() || "";

      if (onlineIngest?.ingestForm === "r2") {
        if (onlineIngest.provider === "telegram") {
          const ingest = onlineIngestRef.current ?? onlineIngest;
          const channel =
            ingest.telegramChannel?.trim() ||
            pageUrl ||
            linkEps.find((ep) => ep.webpageUrl)?.webpageUrl ||
            "";
          const transferEps = linkEps
            .map((ep, i) => ({
              episodeNumber: i + 1,
              title: ep.title,
              webpageUrl: ep.webpageUrl?.trim() || undefined,
              messageId: ep.messageId,
              durationSec: ep.durationSec,
            }))
            .filter((ep) => ep.messageId != null && ep.messageId > 0);
          if (!channel || !transferEps.length) {
            throw new Error(t("telegramNeedProbe"));
          }
          const titleDisplay = englishTitle || titleZhResolved || "—";
          const segmentSeconds =
            typeof ingest.segmentSeconds === "number" &&
            Number.isFinite(ingest.segmentSeconds) &&
            ingest.segmentSeconds >= 30 &&
            ingest.segmentSeconds <= 600
              ? Math.floor(ingest.segmentSeconds)
              : undefined;
          return adminTelegramTransfer({
            channel,
            categorySlug,
            titleZh: titleZhResolved,
            titleEn: englishTitle,
            coverUrl: coverUrl.trim() || undefined,
            descriptionEn: descriptionEn.trim() || undefined,
            creatorId: creatorId.trim() || undefined,
            freeEpisodeCount: (() => {
              try {
                return resolvePolicyForTotal(transferEps.length || max || 0).freeCount;
              } catch {
                return transferEps.length || max;
              }
            })(),
            lockMode: (() => {
              try {
                const p = resolvePolicyForTotal(transferEps.length || max || 0);
                return p.createLockMode;
              } catch {
                return "ALL_FREE";
              }
            })(),
            buyoutCredits: (() => {
              try {
                return resolvePolicyForTotal(transferEps.length || max || 0).buyoutCredits;
              } catch {
                return null;
              }
            })(),
            watermarkEnabled: watermark.enabled,
            watermarkX: watermark.x,
            watermarkY: watermark.y,
            watermarkScale: watermark.scale,
            ...(segmentSeconds != null ? { segmentSeconds } : {}),
            episodes: transferEps.map((ep) => ({
              messageId: ep.messageId!,
              title: ep.title,
              webpageUrl: ep.webpageUrl,
              episodeNumber: ep.episodeNumber,
              durationSec: ep.durationSec,
            })),
          }).then((data) => ({
            kind: "transfer" as const,
            id: data.id,
            jobId: data.jobId,
            n: data.totalEpisodes,
            title: titleDisplay,
            episodeTitles: transferEps.map((ep) => ({
              episodeNumber: ep.episodeNumber,
              title: ep.title,
            })),
          }));
        }
        const transferEps = linkEps
          .map((ep, i) => ({
            episodeNumber: i + 1,
            title: ep.title,
            webpageUrl: ep.webpageUrl?.trim() || undefined,
            sourceUrl: ep.sourceUrl?.trim() || undefined,
            playlistIndex: ep.playlistIndex,
            durationSec: ep.durationSec,
          }))
          .filter((ep) => ep.webpageUrl || ep.sourceUrl);
        if (!pageUrl && !transferEps.length) throw new Error(t("ytdlpNeedUrl"));
        const titleDisplay = englishTitle || titleZhResolved || "—";
        return adminYtdlpTransfer({
          url: pageUrl || transferEps[0].webpageUrl || transferEps[0].sourceUrl || "",
          categorySlug,
          target: "r2",
          titleZh: titleZhResolved,
          titleEn: englishTitle,
          coverUrl: coverUrl.trim() || undefined,
          descriptionEn: descriptionEn.trim() || undefined,
          sourceTags: composeDramaSourceTags(tags, contentType, completion),
          creatorId: creatorId.trim() || undefined,
          maxEpisodes: max,
          formatPreference:
            onlineIngest.formatPreference === "best_hls"
              ? "best"
              : onlineIngest.formatPreference || "best",
          cookiesFile: onlineIngest.cookiesFile,
          authBearer: onlineIngest.authBearer,
          freeEpisodeCount: (() => {
            try {
              return resolvePolicyForTotal(transferEps.length || max || 0).freeCount;
            } catch {
              return transferEps.length || max;
            }
          })(),
          lockMode: (() => {
            try {
              const p = resolvePolicyForTotal(transferEps.length || max || 0);
              return p.createLockMode;
            } catch {
              return "ALL_FREE";
            }
          })(),
          buyoutCredits: (() => {
            try {
              return resolvePolicyForTotal(transferEps.length || max || 0).buyoutCredits;
            } catch {
              return null;
            }
          })(),
          watermarkEnabled: watermark.enabled,
          watermarkX: watermark.x,
          watermarkY: watermark.y,
          watermarkScale: watermark.scale,
          ...(transferEps.length ? { episodes: transferEps } : {}),
        }).then((data) => ({
          kind: "transfer" as const,
          id: data.id,
          jobId: data.jobId,
          n: data.totalEpisodes,
          title: titleDisplay,
          episodeTitles: transferEps.map((ep) => ({
            episodeNumber: ep.episodeNumber,
            title: ep.title,
          })),
        }));
      }

      // Staged link episodes must all be playable — do not fall back to
      // import/re-probe which ignores AI selection and resolved media URLs.
      const missingPlayable = linkEps.filter(
        (ep) => !isPlayableMediaUrl(ep.sourceUrl?.trim()),
      );
      if (missingPlayable.length) {
        throw new Error(
          t("onlineNeedPlayableEpisodes", {
            n: String(missingPlayable.length),
            total: String(linkEps.length),
          }),
        );
      }

      // Finish any outstanding first-frame uploads before persist (soft timeout).
      const needThumbs = linkEps.filter((ep) => {
        const live = episodesRef.current.find((e) => e.id === ep.id) ?? ep;
        return !live.thumbnailUrl?.trim();
      });
      if (needThumbs.length) {
        queueLinkThumbHydration(needThumbs);
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          const pending = needThumbs.some((ep) => {
            const live = episodesRef.current.find((e) => e.id === ep.id);
            return live?.thumbStatus === "pending";
          });
          if (!pending) break;
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      const playable = linkEps.map((ep, i) => {
        const live = episodesRef.current.find((e) => e.id === ep.id) ?? ep;
        return {
          episodeNumber: i + 1,
          title: ep.title,
          sourceUrl: (ep.sourceUrl || "").trim(),
          thumbnailUrl: live.thumbnailUrl?.trim() || undefined,
        };
      });
      if (!playable.length) throw new Error(t("onlineNeedEpisodes"));

      const policy = resolvePolicyForTotal(playable.length);

      return adminCreateOnlineDrama({
        titleZh: titleZhResolved,
        titleEn: englishTitle,
        titleFr: titleFr.trim() || undefined,
        categorySlug,
        coverUrl: coverUrl.trim() || undefined,
        descriptionEn: descriptionEn.trim() || undefined,
        creatorId: creatorId.trim() || undefined,
        freeEpisodeCount: policy.freeCount,
        lockMode: policy.createLockMode ?? undefined,
        buyoutCredits: policy.buyoutCredits,
        status: "DRAFT",
        sourceTags: [...composeDramaSourceTags(tags, contentType, completion), "online"],
        relaxedPlayUrl: false,
        episodes: playable.map((ep, i) => {
          const n = i + 1;
          const isFree = n <= policy.freeThru;
          return { ...ep, isFree };
        }),
      }).then((data) => ({
        kind: "create" as const,
        id: data.id,
        n: data.totalEpisodes,
      }));
    },
    onSuccess: async (data) => {
      setError(null);
      if (data.kind === "transfer") {
        enqueueTransferJob({
          title: data.title,
          dramaId: data.id,
          transferJobId: data.jobId,
          totalEpisodes: data.n,
          episodeTitles: data.episodeTitles,
        });
        setSuccess(t("uploadTaskEnqueuedTransfer", { n: data.n }));
        resetWizardAfterEnqueue();
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
        return;
      }
      setSuccess(t("uploadTaskEnqueued", { n: data.n }));
      resetWizardAfterEnqueue();
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
      if (data.id) {
        router.push(contentDetailHref(data.id, "info"));
      }
    },
    onError: (e: Error) => {
      setSuccess(null);
      setError(e.message);
    },
  });

  const uploadMut = useMutation({
    mutationFn: async (opts?: { publishWhenReady?: boolean }) => {
      const publishWhenReady = !!opts?.publishWhenReady;
      if (fileBlockReason) throw new Error(fileBlockReason);
      const preparedAll = prepareEpisodesForSubmit();
      const preparedEpisodes = preparedAll.filter((ep) => ep.kind === "file" && ep.file);
      const pendingLinks = preparedAll.filter((ep) => ep.kind === "link");
      if (!preparedEpisodes.length) throw new Error(t("localWizardAddEpisodes"));
      if (pendingLinks.length) {
        // Mixed list: local upload runs now; link episodes need playable URLs and are
        // attached after shell create via a follow-up note (detail page can add URLs).
        // Prefer submitting online-only or local-only in one pass for reliability.
      }

      setProgress(
        Object.fromEntries(preparedEpisodes.map((ep) => [ep.id, { status: "pending" as const }])),
      );

      const start = 1;
      const credits = priceCredits;

      // Hand Files to the queue immediately — drama create + thumbs run inside the job.
      const queueEpisodes = preparedEpisodes.map((ep, i) => {
        const episodeNumber = start + i;
        const episodeIsFree = ep.isFree;
        const live = episodesRef.current.find((e) => e.id === ep.id) ?? ep;
        const file = ep.file!;
        return {
          id: ep.id,
          file,
          title: ep.title.trim() || defaultEpisodeTitle(file.name),
          episodeNumber,
          isFree: episodeIsFree,
          previewSeconds: episodeIsFree ? 0 : ep.previewSeconds,
          priceCredits: episodeIsFree ? 0 : credits,
          // Only pass a URL that's already on the server; capture/upload happens in the queue.
          thumbnailUrl: live.thumbnailUrl || undefined,
        };
      });

      const sourceTags = composeDramaSourceTags(tags, contentType, completion);

      const englishTitle = titleEn.trim();
      const titleZhResolved = titleZh.trim() || undefined;
      const titleDisplay = englishTitle || titleZhResolved || "—";
      const policy = resolvePolicyForTotal(preparedEpisodes.length);
      const createDrama = {
        titleZh: titleZhResolved,
        titleEn: englishTitle,
        titleFr: titleFr.trim() || undefined,
        categorySlug,
        coverUrl: coverUrl.trim() || undefined,
        descriptionEn: descriptionEn.trim() || undefined,
        creatorId: creatorId.trim() || undefined,
        freeEpisodeCount: policy.freeCount,
        lockMode: (policy.createLockMode ?? null) as "ALL_FREE" | "VIP_ALL" | "FREE_FIRST_N" | null,
        buyoutCredits: policy.buyoutCredits,
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
        watermarkEnabled: watermark.enabled,
        watermarkX: watermark.x,
        watermarkY: watermark.y,
        watermarkScale: watermark.scale,
      });

      return {
        id: "",
        totalEpisodes: preparedEpisodes.length,
        publishWhenReady,
      };
    },
    onSuccess: async (data) => {
      setError(null);
      setSuccess(
        data.publishWhenReady
          ? t("uploadTaskEnqueuedPublish", { n: data.totalEpisodes })
          : t("uploadTaskEnqueued", { n: data.totalEpisodes }),
      );
      resetWizardAfterEnqueue();
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

  const busy = uploadMut.isPending || onlineSubmitMut.isPending;
  const progressRows = Object.values(progress);
  const doneCount = progressRows.filter((p) => p.status === "done").length;
  const startEpPreview = 1;
  const stagedEpisodeCount = episodes.length;

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
  const sourceActions = (
    <div className="upload-source-actions" role="group" aria-label={t("localWizardVideosTitle")}>
      {splitUploadBtn}
      {onRequestOnline ? (
        <button
          type="button"
          className="upload-source-online"
          disabled={busy}
          onClick={onRequestOnline}
        >
          <Sparkles className="upload-source-online__icon" aria-hidden />
          {t("contentOnlineRef")}
        </button>
      ) : null}
    </div>
  );

  const storageStatusPills = (
    <div
      className="flex max-w-full flex-wrap items-center gap-1.5"
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
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showDrafts ? (
          <p className="text-body-sm text-ink-muted">{t("draftBoxHint")}</p>
        ) : (
          storageStatusPills
        )}
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
                const fileCount = draft.episodeFileCount ?? draft.totalEpisodes ?? 0;
                return (
                  <li
                    key={draft.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <div className="h-14 w-11 shrink-0 overflow-hidden rounded bg-surface">
                      {draft.coverUrl ? (
                        // Stored draft/blob previews intentionally bypass Next image optimization.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={draft.coverUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Film className="m-3 h-5 w-5 text-ink-subtle" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{draftDisplayTitle(draft)}</p>
                      <p className="text-caption text-ink-muted">
                        {t("draftModeNew")}
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
                <div className="mt-4 flex flex-wrap justify-center gap-2">{sourceActions}</div>
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
                      {t("uploadFilesSummary", {
                        n: episodes.length,
                        size: fmtSize(totalBytes),
                      })}
                      {linkEpisodeCount
                        ? ` · ${t("onlineLinkEpisodeCount", { n: linkEpisodeCount })}`
                        : ""}
                      {totalDurationSec != null ? ` · ${fmtDuration(totalDurationSec)}` : ""}
                      {onlineIngest
                        ? ` · ${onlineIngest.ingestForm === "r2" ? t("ytdlpIngestFormR2") : t("ytdlpIngestFormLink")}`
                        : ""}
                      {onlineIngest?.provider === "telegram" &&
                      onlineIngest.segmentSeconds != null &&
                      onlineIngest.segmentSeconds >= 30
                        ? ` · ${t("telegramSegmentSaved", {
                            sec: String(onlineIngest.segmentSeconds),
                          })}`
                        : onlineIngest?.provider === "telegram"
                          ? ` · ${t("telegramSegmentNone")}`
                          : ""}
                      {" · "}
                      {t("localWizardEpisodeOrderHint")}
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
                    {sourceActions}
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
                          ) : ep.kind === "link" ? (
                            <Link2 className="h-5 w-5" aria-hidden />
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
                          title={
                            ep.kind === "link"
                              ? `${ep.sourceUrl || ep.webpageUrl || ep.title} · ${episodeDurationLabel(ep)}`
                              : `${ep.file?.name || ep.title} · ${fmtSize(ep.file?.size || 0)} · ${episodeDurationLabel(ep)}`
                          }
                        >
                          <span>
                            {ep.kind === "link"
                              ? t("onlineLinkBadge")
                              : fmtSize(ep.file?.size || 0)}
                          </span>
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
                          {!episodeIsFree ? (
                            <span className="ep-card__pay">
                              {`${priceCredits}`}
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

      {onlineIngest?.ingestForm === "r2" || fileEpisodeCount > 0 ? (
        <section className="upload-panel space-y-3">
          <div className="upload-panel__head">
            <div>
              <h2>{t("watermarkEnable")}</h2>
              <p>{t("watermarkOnlineHint")}</p>
            </div>
          </div>
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
              setOnlineIngest((prev) =>
                prev
                  ? {
                      ...prev,
                      watermarkEnabled: next.enabled,
                      watermarkX: next.x,
                      watermarkY: next.y,
                      watermarkScale: next.scale,
                    }
                  : prev,
              );
            }}
          />
        </section>
      ) : null}

      <section id="local-drama-info" className="upload-panel upload-panel--info">
            <div className="upload-panel__head">
              <div>
                <h2>{t("uploadSectionInfo")}</h2>
                <p>{t("uploadSectionInfoHint")}</p>
              </div>
            </div>
            <div className="upload-info-layout">
              <div className="upload-info-layout__fields">
                <div className="upload-field upload-field--title-stack">
                  <div className="upload-locale-titles">
                    <div className="upload-locale-titles__head">
                      <strong>{t("localeTitlesLabel")}</strong>
                      <div className="flex flex-wrap items-center gap-2">
                        <small>{t("localeTitleFallbackHint")}</small>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy || translateBusy}
                          onClick={() => void completeTitleTranslation()}
                        >
                          {translateBusy ? t("translateTitlesBusy") : t("translateTitles")}
                        </Button>
                      </div>
                    </div>
                    <label className="upload-locale-titles__row">
                      <span className="upload-locale-titles__lang">
                        {t("contentTitleLocaleEn")} <b className="text-danger">*</b>
                      </span>
                      <div className="upload-locale-titles__input">
                        <Input
                          required
                          maxLength={40}
                          value={titleEn}
                          disabled={busy}
                          aria-required
                          aria-invalid={titleTouched && !titleEn.trim()}
                          aria-label={t("contentTitleLocaleEn")}
                          onBlur={() => setTitleTouched(true)}
                          onChange={(e) => setTitleEn(e.target.value)}
                        />
                        <em className="upload-locale-titles__count">{titleEn.length}/40</em>
                      </div>
                    </label>
                    {titleTouched && !titleEn.trim() ? (
                      <small className="upload-locale-titles__error text-danger">
                        {t("requiredField")}
                      </small>
                    ) : null}
                    <label className="upload-locale-titles__row">
                      <span className="upload-locale-titles__lang">{t("contentTitleLocaleZh")}</span>
                      <div className="upload-locale-titles__input">
                        <Input
                          maxLength={40}
                          value={titleZh}
                          disabled={busy}
                          placeholder={titleEn.trim() || t("localeTitleFallbackPlaceholder")}
                          onChange={(e) => setTitleZh(e.target.value)}
                          aria-label={t("contentTitleLocaleZh")}
                        />
                        <em className="upload-locale-titles__count">{titleZh.length}/40</em>
                      </div>
                    </label>
                    <label className="upload-locale-titles__row">
                      <span className="upload-locale-titles__lang">{t("contentTitleLocaleFr")}</span>
                      <div className="upload-locale-titles__input">
                        <Input
                          maxLength={40}
                          value={titleFr}
                          disabled={busy}
                          placeholder={titleEn.trim() || t("localeTitleFallbackPlaceholder")}
                          onChange={(e) => setTitleFr(e.target.value)}
                          aria-label={t("contentTitleLocaleFr")}
                        />
                        <em className="upload-locale-titles__count">{titleFr.length}/40</em>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="upload-info-row upload-info-row--meta">
                  <div className="upload-field upload-field--tags">
                    <span>
                      {t("dramaTags")}
                      <em className="float-right not-italic text-ink-subtle">{tags.length}/{MAX_DRAMA_TAGS}</em>
                    </span>
                    <DramaTagPicker
                      value={tags}
                      onChange={setTags}
                      max={MAX_DRAMA_TAGS}
                      disabled={busy}
                    />
                  </div>
                  <label className="upload-field upload-field--compact upload-field--creator">
                    <span>{t("dramaCreator")}</span>
                    <Select
                      value={creatorId}
                      disabled={busy}
                      aria-label={t("dramaCreator")}
                      onChange={(e) => setCreatorId(e.target.value)}
                    >
                      <option value="">{t("dramaCreatorAuto")}</option>
                      {(creatorsQ.data ?? []).map((c) => (
                        <option key={String(c.id)} value={String(c.id)}>
                          {c.displayName || String(c.id)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="upload-field upload-field--episodes">
                    <span>{t("totalEpisodes")}</span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      disabled={busy}
                      value={totalEpisodes}
                      aria-label={t("totalEpisodes")}
                      onChange={(e) => {
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
                      value={contentType}
                      disabled={busy}
                      ariaLabel={t("contentType")}
                      onChange={(value) => setContentType(normalizeContentType(value))}
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
                      value={completion}
                      disabled={busy}
                      ariaLabel={t("completionStatus")}
                      onChange={(value) => setCompletion(value)}
                      options={[
                        { value: "连载中", label: t("completionOngoing") },
                        { value: "已完结", label: t("completionFinished") },
                      ]}
                    />
                  </div>
                </div>

                <label className="upload-field">
                  <span>
                    {t("onlineDescEn")}
                    <em className="float-right not-italic text-ink-subtle">
                      {descriptionEn.length}/300
                    </em>
                  </span>
                  <textarea
                    className="content-textarea upload-info-desc"
                    rows={3}
                    maxLength={300}
                    value={descriptionEn}
                    disabled={busy}
                    onChange={(e) => setDescriptionEn(e.target.value)}
                  />
                </label>
              </div>

              <div className="upload-info-layout__cover">
                <div className="upload-field">
                  <span>{t("uploadSectionCover")}</span>
                  <DramaCoverField
                    url={coverUrl || undefined}
                    disabled={busy}
                    videoFile={episodes[0]?.file}
                    showAdvancedUrl
                    onChange={(url) => setCoverUrl(url)}
                    onError={setError}
                  />
                </div>
              </div>
            </div>
          </section>

            <DramaPlaybackPolicyForm
              variant="upload-panel"
              inheritGlobal={inheritGlobal}
              onInheritGlobalChange={setInheritGlobal}
              globalMode={globalMode}
              globalFreeCount={globalFreeCount}
              globalPreviewSeconds={globalPreviewSeconds}
              episodeTotal={episodes.length}
              allFree={allFree}
              onAllFreeChange={setAllFree}
              freeRangeStart={freeRangeStart}
              freeRangeEnd={freeRangeEnd}
              onFreeRangeStartChange={setFreeRangeStart}
              onFreeRangeEndChange={setFreeRangeEnd}
              priceCredits={priceCredits}
              onPriceCreditsChange={setPriceCredits}
              buyoutDiscountPercent={buyoutDiscountPercent}
              onBuyoutDiscountPercentChange={setBuyoutDiscountPercent}
              allowPreview={allowPreview}
              onAllowPreviewChange={setAllowPreview}
              previewSeconds={previewSeconds}
              onPreviewSecondsChange={setPreviewSeconds}
              disabled={busy}
              previewRadioName="member-preview-policy"
            />

      <div className="upload-submit-bar">
          <p className="upload-submit-bar__hint">
            {fileBlockReason ||
              (stagedEpisodeCount
                ? linkEpisodeCount && !fileEpisodeCount
                  ? t("localWizardSubmitHintOnline", {
                      n: stagedEpisodeCount,
                      mode:
                        onlineIngest?.ingestForm === "r2"
                          ? t("ytdlpIngestFormR2")
                          : t("ytdlpIngestFormLink"),
                    })
                  : t("localWizardSubmitHint", { n: stagedEpisodeCount })
                : t("uploadDraftOnlyHint"))}
          </p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={saveLocalDraft}>
            <Save className="h-4 w-4" />{t("saveDraft")}
          </Button>
          <Button
            size="sm"
            disabled={!!fileBlockReason || busy}
            onClick={() => {
              if (linkEpisodeCount && !fileEpisodeCount) {
                onlineSubmitMut.mutate();
                return;
              }
              if (linkEpisodeCount && fileEpisodeCount) {
                setError(t("onlineMixSubmitHint"));
                return;
              }
              setSubmitPublishChoice(false);
              setSubmitOpen(true);
            }}
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t("nextStep")}
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
            <p className="text-body-sm text-ink-muted">{t("submitDramaDialogHint", { n: stagedEpisodeCount })}</p>
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
});
