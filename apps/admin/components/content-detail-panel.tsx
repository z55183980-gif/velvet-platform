"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveDrama,
  adminBatchEpisodes,
  adminAppendPublicEpisodes,
  adminCreateEpisode,
  adminDeleteDrama,
  adminDeleteEpisode,
  adminGetDrama,
  adminListCategories,
  adminListSettings,
  adminOfflineDrama,
  adminOnlineDrama,
  adminRejectDrama,
  adminReorderEpisodes,
  adminRetryTranscode,
  adminEpisodeFirstFrame,
  adminSubmitDramaReview,
  adminTranslateTitles,
  adminUpdateDrama,
  adminUpdateEpisode,
  adminPurgeEpisodeMedia,
} from "@velvet/api-client";
import { Badge, Button, DataTable, Input, Select, cn, fmtNum, type Column } from "@velvet/ui";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clapperboard,
  Cloud,
  ExternalLink,
  Eye,
  FileVideo,
  Heart,
  LayoutDashboard,
  ThumbsUp,
  ListVideo,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  UnlockKeyhole,
  Video,
} from "lucide-react";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import {
  WatermarkPositionEditor,
  DEFAULT_PLACEMENT,
  type WatermarkPlacement,
} from "@/components/watermark-position-editor";
import {
  DramaStoragePanel,
  EpisodeVideoUploadButton,
  NewEpisodeUploadForm,
  STORAGE_EPISODE_PAGE_SIZE,
} from "@/components/episode-media-panel";
import { EpisodeThumbnailField } from "@/components/episode-thumbnail-field";
import { DramaCoverField } from "@/components/drama-cover-field";
import { DramaCoverThumb } from "@/components/drama-cover-thumb";
import { DramaPlaybackPolicyForm } from "@/components/drama-playback-policy-form";
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
import {
  freeThruWhenInheriting,
  parseLockMode,
  resolveCustomFreePolicy,
  stampFreeCountWhenInheriting,
} from "@/lib/drama-playback-policy";
import { useAdminSession } from "@/lib/admin-session";
import { contentDetailHref } from "@/lib/content-href";
import { useI18n, statusLabel } from "@/lib/i18n";
import { webDramaPreviewHref } from "@/lib/web-preview";

type Episode = {
  id: string | number;
  episodeNumber?: number;
  title?: string;
  isFree?: boolean;
  priceCredits?: number | string;
  previewSeconds?: number | string;
  transcodeStatus?: string;
  thumbnailUrl?: string;
  hlsUrl?: string;
  originalUrl?: string;
  durationSec?: number;
};

type Drama = {
  id: string | number;
  titleZh?: string;
  titleEn?: string;
  titleFr?: string;
  slug?: string;
  status?: string;
  coverUrl?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  isFeatured?: boolean;
  isOfficial?: boolean;
  sortWeight?: number;
  freeEpisodeCount?: number;
  lockMode?: "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE" | null;
  buyoutCredits?: number | string | null;
  viewCount?: number;
  unlockCount?: number;
  favoriteCount?: number;
  likeCount?: number;
  publishedAt?: string | null;
  sourceType?: string;
  tags?: string[];
  creator?: { displayName?: string };
  category?: { slug?: string; nameZh?: string; nameEn?: string };
  episodes?: Episode[];
};

type Category = { slug: string; nameZh?: string; nameEn?: string };
type DetailTab = "overview" | "info" | "episodes" | "policy";
/** Marker returned by delete mutation so shared onSuccess skips detail refetch. */
type DramaDeletedResult = { __velvetDramaDeleted: true };
function isDramaDeletedResult(data: unknown): data is DramaDeletedResult {
  return !!data && typeof data === "object" && (data as DramaDeletedResult).__velvetDramaDeleted === true;
}
type AddEpisodeMethod = "upload" | "url" | "public";
type AddEpisodeOption = { key: AddEpisodeMethod; labelKey: "addEpisodeMethodUpload" | "addEpisodeMethodUrl" | "addEpisodeMethodPublic"; advanced?: boolean };

function episodeAddOptions(sourceType?: string, status?: string): {
  options: AddEpisodeOption[];
  defaultMethod: AddEpisodeMethod;
  canPullPublic: boolean;
} {
  const canPullPublic =
    status === "DRAFT" || status === "REJECTED" || status === "OFFLINE";
  const isOnline = sourceType === "ONLINE";

  if (isOnline) {
    const options: AddEpisodeOption[] = [
      { key: "url", labelKey: "addEpisodeMethodUrl" },
      ...(canPullPublic
        ? [{ key: "public" as const, labelKey: "addEpisodeMethodPublic" as const }]
        : []),
    ];
    return { options, defaultMethod: "url", canPullPublic };
  }

  const options: AddEpisodeOption[] = [
    { key: "upload", labelKey: "addEpisodeMethodUpload" },
    { key: "url", labelKey: "addEpisodeMethodUrl", advanced: true },
    ...(canPullPublic
      ? [{ key: "public" as const, labelKey: "addEpisodeMethodPublic" as const, advanced: true }]
      : []),
  ];
  return { options, defaultMethod: "upload", canPullPublic };
}
type BasicDraft = {
  titleZh: string;
  titleEn: string;
  titleFr: string;
  categorySlug: string;
  coverUrl: string;
  descriptionZh: string;
  descriptionEn: string;
  tags: string[];
  contentType: DramaContentType;
  completion: DramaCompletion;
};

const emptyDraft: BasicDraft = {
  titleZh: "",
  titleEn: "",
  titleFr: "",
  categorySlug: "",
  coverUrl: "",
  descriptionZh: "",
  descriptionEn: "",
  tags: [],
  contentType: DEFAULT_CONTENT_TYPE,
  completion: DEFAULT_COMPLETION,
};

function draftFromDrama(drama: Drama): BasicDraft {
  const meta = parseDramaTags(drama.tags);
  const storedZh = drama.descriptionZh || "";
  const storedEn = drama.descriptionEn || "";
  // Historical create wrote primary (English) synopsis into descriptionZh only.
  // Prefer showing that text under descriptionEn without clearing zh.
  const enLooksMissing = !storedEn.trim();
  const zhLooksEnglish = Boolean(storedZh.trim()) && !/[\u4e00-\u9fff]/.test(storedZh);
  return {
    titleZh: drama.titleZh || "",
    titleEn: drama.titleEn || "",
    titleFr: drama.titleFr || "",
    categorySlug: drama.category?.slug || "",
    coverUrl: drama.coverUrl || "",
    descriptionZh: storedZh,
    descriptionEn: storedEn || (enLooksMissing && zhLooksEnglish ? storedZh : ""),
    tags: meta.displayTags,
    contentType: meta.contentType,
    completion: meta.completion,
  };
}

function FieldLabel({ label, required, children }: { label: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <label className="block text-[13px] font-medium text-ink-muted">
      <span className="mb-1.5 block">
        {label}{required ? <span className="ml-1 text-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="content-metric">
      <span className="content-metric__icon">{icon}</span>
      <div>
        <p className="text-[12px] font-medium text-ink-subtle">{label}</p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: () => void; label: string; description: string }) {
  return (
    <button type="button" className="content-toggle-row" onClick={onChange} aria-pressed={checked}>
      <span className={cn("content-toggle", checked && "content-toggle--on")}>
        <span />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-ink-subtle">{description}</span>
      </span>
    </button>
  );
}

export type ContentDetailPanelHandle = {
  /** Saves the basic-info draft (title/category/cover/description). */
  save: () => Promise<{ ok: boolean; error?: string }>;
};

export const ContentDetailPanel = forwardRef<ContentDetailPanelHandle, {
  id: string;
  initialTab?: DetailTab;
  onDeleted?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}>(function ContentDetailPanel({ id, initialTab, onDeleted, onDirtyChange }, ref) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { admin } = useAdminSession();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";
  const [tab, setTab] = useState<DetailTab>(initialTab ?? "overview");
  const [reason, setReason] = useState("");
  const [weight, setWeight] = useState(0);
  const [priceCredits, setPriceCredits] = useState(10);
  const [allowPreview, setAllowPreview] = useState(false);
  const [previewSeconds, setPreviewSeconds] = useState(10);
  const [freeRangeStart, setFreeRangeStart] = useState("1");
  const [freeRangeEnd, setFreeRangeEnd] = useState("");
  /** Explicit ALL_FREE lock mode — not freeEnd === episode total. */
  const [allFree, setAllFree] = useState(false);
  /** Default ON: drama follows platform global lock policy (lockMode null). */
  const [inheritGlobal, setInheritGlobal] = useState(true);
  const [draft, setDraft] = useState<BasicDraft>(emptyDraft);
  const [savedDraft, setSavedDraft] = useState<BasicDraft>(emptyDraft);
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [translateBusy, setTranslateBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [deleteEpisodeId, setDeleteEpisodeId] = useState<string | null>(null);
  const [watermarkRetryId, setWatermarkRetryId] = useState<string | null>(null);
  const [watermarkFrame, setWatermarkFrame] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const [watermarkPlacement, setWatermarkPlacement] =
    useState<WatermarkPlacement>(DEFAULT_PLACEMENT);
  const [watermarkFrameBusy, setWatermarkFrameBusy] = useState(false);
  const [purgeEpisodeId, setPurgeEpisodeId] = useState<string | null>(null);
  const [showAddEpisode, setShowAddEpisode] = useState(false);
  const [addEpisodeMethod, setAddEpisodeMethod] = useState<AddEpisodeMethod>("upload");
  const [showAdvancedAdd, setShowAdvancedAdd] = useState(false);
  const [selectedEps, setSelectedEps] = useState<Set<string>>(new Set());
  const [episodePage, setEpisodePage] = useState(1);
  const [storageTotalsNonce, setStorageTotalsNonce] = useState(0);
  const [batchFree, setBatchFree] = useState<"keep" | "1" | "0">("keep");
  const [batchPrice, setBatchPrice] = useState("");
  const [newEp, setNewEp] = useState({
    title: "",
    sourceUrl: "",
    publicPageUrl: "",
    thumbnailUrl: "",
    isFree: false,
    priceCredits: 10,
  });

  const detailQ = useQuery({ queryKey: ["admin", "drama", id], queryFn: () => adminGetDrama(id) as Promise<Drama> });
  const categoriesQ = useQuery({ queryKey: ["admin", "categories"], queryFn: () => adminListCategories(true) as Promise<Category[]> });
  const settingsQ = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const result = (await adminListSettings()) as { items?: { key: string; value: unknown }[] };
      return result.items ?? [];
    },
    staleTime: 60_000,
  });

  const globalMode = useMemo(() => {
    const raw = settingsQ.data?.find((s) => s.key === "episodeLockMode")?.value;
    return parseLockMode(raw);
  }, [settingsQ.data]);
  const globalFreeCount = useMemo(() => {
    const n = Number(settingsQ.data?.find((s) => s.key === "defaultFreeEpisodes")?.value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3;
  }, [settingsQ.data]);
  const globalPreviewSeconds = useMemo(() => {
    const n = Number(settingsQ.data?.find((s) => s.key === "defaultPreviewSeconds")?.value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }, [settingsQ.data]);

  useEffect(() => {
    setTab(initialTab ?? "overview");
  }, [id, initialTab]);

  useEffect(() => {
    setEpisodePage(1);
    setSelectedEps(new Set());
  }, [id]);

  useEffect(() => {
    if (!detailQ.data) return;
    const nextDraft = draftFromDrama(detailQ.data);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setWeight(detailQ.data.sortWeight ?? 0);
    const eps = detailQ.data.episodes ?? [];
    const total = eps.length;
    const lock = detailQ.data.lockMode;
    const freeCount = Math.max(0, Math.floor(Number(detailQ.data.freeEpisodeCount) || 0));
    // null lockMode = inherit global (switch ON)
    setInheritGlobal(lock == null);
    if (lock == null) {
      // Keep custom fields primed for when the user turns the switch off
      if (globalMode === "ALL_FREE") {
        setAllFree(true);
        setFreeRangeStart("1");
        setFreeRangeEnd(String(Math.max(1, total || 3)));
      } else if (globalMode === "VIP_ALL") {
        setAllFree(false);
        setFreeRangeStart(String(total + 1 || 999));
        setFreeRangeEnd(String(total + 1 || 999));
      } else {
        setAllFree(false);
        setFreeRangeStart("1");
        setFreeRangeEnd(String(Math.max(0, globalFreeCount)));
      }
    } else if (lock === "ALL_FREE") {
      setAllFree(true);
      setFreeRangeStart("1");
      setFreeRangeEnd(String(Math.max(1, total || freeCount || 3)));
    } else if (lock === "VIP_ALL" && freeCount <= 0) {
      // Out-of-range card values represent "no free episodes"
      setAllFree(false);
      setFreeRangeStart(String(total + 1 || 999));
      setFreeRangeEnd(String(total + 1 || 999));
    } else {
      // FREE_FIRST_N, or legacy VIP_ALL+freeCount>0 (buggy prior save) → first-N free cards
      setAllFree(false);
      setFreeRangeStart("1");
      setFreeRangeEnd(String(Math.max(1, freeCount)));
    }
    const paid = eps.find((ep) => !ep.isFree);
    setPriceCredits(Math.max(1, Number(paid?.priceCredits) || 10));
    const previewSec = Math.max(0, Math.floor(Number(paid?.previewSeconds) || 0));
    if (previewSec > 0) {
      setAllowPreview(true);
      setPreviewSeconds(previewSec);
    } else if (globalPreviewSeconds > 0) {
      setAllowPreview(true);
      setPreviewSeconds(globalPreviewSeconds);
    } else {
      setAllowPreview(false);
      setPreviewSeconds(10);
    }
  }, [detailQ.data, globalMode, globalFreeCount, globalPreviewSeconds]);

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(savedDraft), [draft, savedDraft]);
  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const actionMut = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async (data) => {
      // After hard-delete, invalidating detail would refetch GET /dramas/:id → 404
      // and paint a false "找不到短剧" while stale cache still shows the title.
      if (isDramaDeletedResult(data)) {
        qc.removeQueries({ queryKey: ["admin", "drama", id] });
        qc.removeQueries({ queryKey: ["admin", "drama-storage", id] });
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
        return;
      }
      setError(null);
      setSelectedEps(new Set());
      await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const act = useCallback((action: () => Promise<unknown>) => actionMut.mutate(action), [actionMut]);

  async function completeTitleTranslation() {
    const en = draft.titleEn.trim();
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
      setDraft((v) => ({
        ...v,
        titleEn: String(res.titleEn || v.titleEn).trim(),
        titleZh: nextZh || v.titleZh,
        titleFr: nextFr || v.titleFr,
      }));
      if (!nextFr) {
        setError(t("translateTitlesFailed") + " (Français)");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("translateTitlesFailed"));
    } finally {
      setTranslateBusy(false);
    }
  }

  const drama = detailQ.data;
  const episodes = useMemo(() => drama?.episodes ?? [], [drama?.episodes]);
  const EPISODE_PAGE_SIZE = STORAGE_EPISODE_PAGE_SIZE;
  const episodeTotalPages = Math.max(1, Math.ceil(episodes.length / EPISODE_PAGE_SIZE));
  const pagedEpisodes = useMemo(() => {
    const start = (episodePage - 1) * EPISODE_PAGE_SIZE;
    return episodes.slice(start, start + EPISODE_PAGE_SIZE);
  }, [episodes, episodePage]);

  const bumpStorageTotals = useCallback(() => {
    setStorageTotalsNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    setEpisodePage((page) => Math.min(Math.max(1, page), episodeTotalPages));
  }, [episodeTotalPages]);
  const addEpisodeConfig = useMemo(
    () => episodeAddOptions(drama?.sourceType, drama?.status),
    [drama?.sourceType, drama?.status],
  );

  useEffect(() => {
    setAddEpisodeMethod(addEpisodeConfig.defaultMethod);
    setShowAdvancedAdd(false);
  }, [addEpisodeConfig.defaultMethod, id]);

  const saveBasicInfo = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!draft.titleEn.trim()) {
      setError(t("dramaTitleRequired"));
      return { ok: false, error: t("dramaTitleRequired") };
    }
    if (draft.tags.length > MAX_DRAMA_TAGS) {
      setError(t("dramaTagsTooMany"));
      return { ok: false, error: t("dramaTagsTooMany") };
    }
    try {
      const {
        tags,
        contentType,
        completion,
        ...rest
      } = draft;
      await actionMut.mutateAsync(() =>
        adminUpdateDrama(id, {
          ...rest,
          titleZh: draft.titleZh.trim(),
          titleEn: draft.titleEn.trim(),
          titleFr: draft.titleFr.trim() || null,
          sourceTags: composeDramaSourceTags(tags, contentType, completion),
        }),
      );
      setSavedDraft(draft);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  useImperativeHandle(ref, () => ({ save: saveBasicInfo }));

  const moveEpisode = useCallback((episodeId: string, dir: -1 | 1) => {
    const list = [...episodes];
    const idx = list.findIndex((e) => String(e.id) === episodeId);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= list.length) return;
    [list[idx], list[next]] = [list[next], list[idx]];
    act(() => adminReorderEpisodes(id, list.map((e) => String(e.id))));
  }, [act, episodes, id]);

  async function applyEpisodeAccessFields(opts: {
    freeThru: number;
    allFree: boolean;
    credits: number;
    previewSec: number;
  }) {
    const { freeThru, allFree, credits, previewSec } = opts;
    await Promise.all(
      episodes.map((ep, i) => {
        const n = ep.episodeNumber ?? i + 1;
        const isFree = allFree || n <= freeThru;
        return adminUpdateEpisode(String(ep.id), {
          isFree,
          priceCredits: isFree ? 0 : credits,
          priceVnd: isFree ? 0 : credits,
          previewSeconds: isFree ? 0 : previewSec,
        });
      }),
    );
  }

  async function savePlaybackPolicy() {
    const total = episodes.length;

    if (inheritGlobal) {
      // Stamp global freeCount (not episode total) so Follow Global stays consistent with API resolve.
      await adminUpdateDrama(id, {
        freeEpisodeCount: stampFreeCountWhenInheriting(globalFreeCount),
        lockMode: null,
        buyoutCredits: null,
      });
      if (!total) return;
      const freeThru = freeThruWhenInheriting({
        total,
        globalMode,
        globalFreeCount,
      });
      await applyEpisodeAccessFields({
        freeThru,
        allFree: globalMode === "ALL_FREE",
        credits: Math.max(1, priceCredits || 10),
        previewSec: globalPreviewSeconds > 0 ? globalPreviewSeconds : 0,
      });
      return;
    }

    let resolved: ReturnType<typeof resolveCustomFreePolicy>;
    try {
      resolved = resolveCustomFreePolicy(total, freeRangeStart, freeRangeEnd, allFree);
    } catch {
      throw new Error(t("policyRangeInvalid", { total: total || 1 }));
    }
    const { freeThru, freeCount, lockMode } = resolved;
    if (total > 0 && lockMode !== "ALL_FREE" && freeCount < total && priceCredits <= 0) {
      throw new Error(t("policyPriceInvalid"));
    }
    const previewSec = allowPreview ? Math.max(1, Math.floor(Number(previewSeconds) || 10)) : 0;

    await adminUpdateDrama(id, {
      freeEpisodeCount: freeCount,
      lockMode,
      buyoutCredits: null,
    });

    if (!total) return;
    await applyEpisodeAccessFields({
      freeThru: lockMode === "ALL_FREE" ? total : freeThru,
      allFree: lockMode === "ALL_FREE",
      credits: Math.max(1, priceCredits),
      previewSec,
    });
  }

  const episodeColumns: Column<Episode>[] = useMemo(() => [
    {
      key: "select", header: "", className: "w-10",
      cell: (episode) => <input className="content-checkbox" type="checkbox" checked={selectedEps.has(String(episode.id))} onChange={(e) => setSelectedEps((prev) => {
        const next = new Set(prev); e.target.checked ? next.add(String(episode.id)) : next.delete(String(episode.id)); return next;
      })} />,
    },
    {
      key: "number", header: t("episodeNumber"), className: "w-16 tabular-nums",
      cell: (episode) => <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-surface-2 px-1.5 text-caption font-semibold">{episode.episodeNumber ?? "—"}</span>,
    },
    {
      key: "thumb", header: t("episodeThumbnail"), className: "min-w-[11rem] w-[12rem]",
      cell: (episode) => (
        <EpisodeThumbnailField
          url={episode.thumbnailUrl}
          disabled={actionMut.isPending}
          episodeId={String(episode.id)}
          videoSrc={episode.hlsUrl || episode.originalUrl || undefined}
          videoIsHls={/\.m3u8(\?|$)/i.test(episode.hlsUrl || "")}
          fromVideoLabel={t("thumbFromVideo")}
          uploadLabel={t("thumbUpload")}
          onError={setError}
          onUploaded={(url) => act(() => adminUpdateEpisode(String(episode.id), { thumbnailUrl: url }))}
        />
      ),
    },
    {
      key: "title", header: t("colTitle"),
      cell: (episode) => <Input className="h-8 min-w-36" defaultValue={episode.title || ""} onBlur={(e) => e.target.value !== (episode.title || "") && act(() => adminUpdateEpisode(String(episode.id), { title: e.target.value }))} />,
    },
    {
      key: "media", header: t("playUrl"),
      cell: (episode) => <Input className="h-8 min-w-48" defaultValue={episode.hlsUrl || episode.originalUrl || ""} placeholder="m3u8 / mp4" onBlur={(e) => {
        const next = e.target.value.trim(); const prev = episode.hlsUrl || episode.originalUrl || "";
        if (next !== prev) act(() => adminUpdateEpisode(String(episode.id), { sourceUrl: next || undefined, hlsUrl: next || "", originalUrl: next || "" }));
      }} />,
    },
    {
      key: "access", header: t("episodeAccess"), className: "w-28",
      cell: (episode) => <button type="button" className={cn("content-access-pill", episode.isFree && "content-access-pill--free")} onClick={() => act(() => adminUpdateEpisode(String(episode.id), episode.isFree ? { isFree: false, priceCredits: Math.max(10, Number(episode.priceCredits || 0)), priceVnd: Math.max(10, Number(episode.priceCredits || 0)) } : { isFree: true }))}>
        {episode.isFree ? <UnlockKeyhole className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}{episode.isFree ? t("free") : `${Number(episode.priceCredits || 0)} ${t("creditsShort")}`}
      </button>,
    },
    {
      key: "transcode", header: t("transcodeStatus"), className: "w-28",
      cell: (episode) => (
        <Badge
          tone={
            episode.transcodeStatus === "FAILED"
              ? "danger"
              : episode.transcodeStatus === "COMPLETED" || episode.transcodeStatus === "READY"
                ? "success"
                : "warning"
          }
        >
          {episode.transcodeStatus || "—"}
        </Badge>
      ),
    },
    {
      key: "actions", header: "", className: "w-40",
      cell: (episode) => (
        <div className="flex justify-end gap-1">
          {drama?.sourceType !== "ONLINE" ? (
            <EpisodeVideoUploadButton
              episodeId={String(episode.id)}
              disabled={actionMut.isPending}
              label={episode.hlsUrl || episode.originalUrl ? t("replaceVideo") : t("uploadVideo")}
              onError={setError}
              onDone={async () => {
                bumpStorageTotals();
                await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
                await qc.invalidateQueries({ queryKey: ["admin", "drama-storage", id] });
              }}
            />
          ) : null}
          <Button size="sm" variant="ghost" className="!h-7 !w-7 !p-0" title={t("moveUp")} disabled={actionMut.isPending} onClick={() => moveEpisode(String(episode.id), -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" className="!h-7 !w-7 !p-0" title={t("moveDown")} disabled={actionMut.isPending} onClick={() => moveEpisode(String(episode.id), 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
          {["FAILED", "PENDING", "PROCESSING"].includes(episode.transcodeStatus || "") ? (
            <Button
              size="sm"
              variant="ghost"
              className="!h-7 !w-7 !p-0"
              title={t("retryTranscode")}
              onClick={() => {
                setWatermarkRetryId(String(episode.id));
                setWatermarkPlacement(DEFAULT_PLACEMENT);
                setWatermarkFrame(null);
                setWatermarkFrameBusy(true);
                void adminEpisodeFirstFrame(String(episode.id))
                  .then((frame) => {
                    setWatermarkFrame({
                      url: frame.url,
                      width: frame.width,
                      height: frame.height,
                    });
                  })
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setWatermarkFrameBusy(false));
              }}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="!h-7 !w-7 !p-0 !text-danger" title={t("delete")} onClick={() => setDeleteEpisodeId(String(episode.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      ),
    },
  ], [t, actionMut.isPending, selectedEps, id, qc, drama?.sourceType, act, moveEpisode]);

  const handleDeleteDrama = () =>
    actionMut.mutate(async () => {
      await adminDeleteDrama(id, reason || "admin delete");
      // Close before shared onSuccess clears caches so the panel never paints post-delete 404.
      setDeleteOpen(false);
      setError(null);
      if (onDeleted) onDeleted();
      else router.replace("/content");
      return { __velvetDramaDeleted: true as const };
    });

  const handleOfflineDrama = () =>
    actionMut.mutate(() => adminOfflineDrama(id, "admin force offline"), {
      onSuccess: async () => {
        setOfflineOpen(false);
        setError(null);
        await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
      },
    });

  const handleOnlineDrama = () =>
    actionMut.mutate(() => adminOnlineDrama(id, "admin restore online"), {
      onSuccess: async () => {
        setOnlineOpen(false);
        setError(null);
        await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
      },
    });

  const handleSubmitReview = () =>
    actionMut.mutate(() => adminSubmitDramaReview(id), {
      onSuccess: async () => {
        setError(null);
        await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
      },
    });

  if (detailQ.isLoading) return <div className="content-detail-loading"><LoaderCircle className="h-5 w-5 animate-spin text-brand" /><span>{t("loading")}</span></div>;
  if (!drama) return <p className="text-ink-muted">{t("empty")}</p>;

  const statusTone = drama.status === "LIVE" ? "success" : drama.status === "PENDING_REVIEW" ? "warning" : drama.status === "REJECTED" ? "danger" : "default";
  const isOnlineSource = drama.sourceType === "ONLINE";
  const canSubmitReview =
    isOnlineSource && (drama.status === "DRAFT" || drama.status === "REJECTED");
  const canDirectOnline =
    drama.status === "OFFLINE" ||
    (!isOnlineSource && (drama.status === "DRAFT" || drama.status === "REJECTED"));
  const tabs: { key: DetailTab; label: string; icon: ReactNode; count?: number }[] = [
    { key: "overview", label: t("tabOverview"), icon: <LayoutDashboard /> },
    { key: "info", label: t("tabDramaInfo"), icon: <Clapperboard /> },
    { key: "episodes", label: t("tabEpisodes"), icon: <ListVideo />, count: episodes.length },
    { key: "policy", label: t("tabPlayPolicy"), icon: <LockKeyhole /> },
  ];

  return (
    <div className="content-detail-shell">
      <section className="content-detail-hero">
        <div className="content-cover">
          <DramaCoverThumb
            url={drama.coverUrl}
            title={drama.titleEn || drama.titleZh || drama.titleFr}
            className="!h-full !w-full !rounded-none !ring-0"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone}>{statusLabel(t, drama.status)}</Badge>
            {drama.isOfficial ? <span className="content-flag"><Check className="h-3 w-3" />{t("official")}</span> : null}
            {drama.isFeatured ? <span className="content-flag content-flag--brand"><Sparkles className="h-3 w-3" />{t("featuredFlag")}</span> : null}
          </div>
          <h1 className="mt-2 truncate text-[22px] font-bold tracking-tight text-ink">{drama.titleEn || drama.titleZh || drama.titleFr || "—"}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-subtle"><span>{drama.slug}</span><span>·</span><span>{drama.creator?.displayName || "—"}</span><span>·</span><span>{drama.category?.nameZh || drama.category?.nameEn || "—"}</span></p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {(() => {
            const previewHref = webDramaPreviewHref({
              id: drama.id,
              slug: drama.slug,
              status: drama.status,
            });
            return (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={!previewHref}
                title={previewHref ? undefined : t("previewOnWebLiveOnly")}
                onClick={() => {
                  if (!previewHref) return;
                  window.open(previewHref, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="h-4 w-4" />
                {t("previewOnWeb")}
              </Button>
            );
          })()}
          {drama.status === "PENDING_REVIEW" ? (
            <Button size="sm" variant="success" disabled={actionMut.isPending} onClick={() => act(() => adminApproveDrama(id))}>
              <Check className="h-4 w-4" />
              {t("approveReview")}
            </Button>
          ) : null}
          {drama.status === "LIVE" ? (
            <Button size="sm" variant="secondary" disabled={actionMut.isPending} onClick={() => setOfflineOpen(true)}>
              <LockKeyhole className="h-4 w-4" />
              {t("forceOffline")}
            </Button>
          ) : null}
          {canSubmitReview ? (
            <Button size="sm" disabled={actionMut.isPending} onClick={handleSubmitReview}>
              <FileVideo className="h-4 w-4" />
              {t("submitReview")}
            </Button>
          ) : null}
          {canDirectOnline ? (
            <Button size="sm" disabled={actionMut.isPending} onClick={() => setOnlineOpen(true)}>
              <UnlockKeyhole className="h-4 w-4" />
              {t("restoreOnline")}
            </Button>
          ) : null}
          {isSuperAdmin ? (
            <Button size="sm" variant="danger" disabled={actionMut.isPending} onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              {t("deleteDrama")}
            </Button>
          ) : (
            <span className="text-caption text-ink-subtle">{t("dangerOpsSuperOnly")}</span>
          )}
        </div>
      </section>

      {error || detailQ.error || categoriesQ.error ? (
        <div className="content-inline-error">
          <AlertTriangle className="h-4 w-4" />
          <span>{error || (detailQ.error as Error)?.message || (categoriesQ.error as Error)?.message}</span>
        </div>
      ) : null}

      <nav className="content-detail-tabs" aria-label={t("dramaEditNavigation")}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn("content-detail-tab", tab === item.key && "content-detail-tab--active")}
            onClick={() => setTab(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count != null ? <span className="content-detail-tab__count">{item.count}</span> : null}
            {item.key === "info" && isDirty ? (
              <span className="content-detail-tab__dirty" title={t("unsavedChanges")} />
            ) : null}
          </button>
        ))}
      </nav>

      <div className="content-detail-body">
        {tab === "overview" ? <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric icon={<Eye />} label={t("views")} value={fmtNum(drama.viewCount)} />
            <Metric icon={<UnlockKeyhole />} label={t("unlocks")} value={fmtNum(drama.unlockCount)} />
            <Metric icon={<Heart />} label={t("favorites")} value={fmtNum(drama.favoriteCount)} />
            <Metric icon={<ThumbsUp />} label={t("likes")} value={fmtNum(drama.likeCount)} />
            <Metric icon={<FileVideo />} label={t("episodeCount")} value={episodes.length} />
          </div>
          {drama.status === "PENDING_REVIEW" ? (
            <section className="content-section-card space-y-4">
              <div className="content-section-heading"><div><h2>{t("statusAndActions")}</h2><p>{t("statusActionHint")}</p></div></div>
              <FieldLabel label={t("actionReason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("actionReasonPlaceholder")} /></FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="success" disabled={actionMut.isPending} onClick={() => act(() => adminApproveDrama(id))}><Check className="h-4 w-4" />{t("approveReview")}</Button>
                <Button size="sm" variant="secondary" disabled={actionMut.isPending || !reason.trim()} onClick={() => act(() => adminRejectDrama(id, reason))}><AlertTriangle className="h-4 w-4" />{t("reject")}</Button>
              </div>
            </section>
          ) : null}
          <section className="content-section-card space-y-4">
            <div className="content-section-heading"><div><h2>{t("distributionSettings")}</h2><p>{t("contentSummaryHint")}</p></div></div>
            <div className="grid gap-3 md:grid-cols-2">
              <Toggle checked={!!drama.isFeatured} onChange={() => act(() => adminUpdateDrama(id, { isFeatured: !drama.isFeatured }))} label={t("featured")} description={t("featuredSettingHint")} />
              <Toggle checked={!!drama.isOfficial} onChange={() => act(() => adminUpdateDrama(id, { isOfficial: !drama.isOfficial }))} label={t("official")} description={t("officialSettingHint")} />
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
              <FieldLabel label={t("sortWeightTitle")}><Input type="number" className="w-36" value={weight} onChange={(e) => setWeight(Number(e.target.value))} /></FieldLabel>
              <Button size="sm" variant="secondary" disabled={actionMut.isPending || weight === (drama.sortWeight ?? 0)} onClick={() => act(() => adminUpdateDrama(id, { sortWeight: weight }))}>{t("saveSortWeight")}</Button>
            </div>
          </section>
        </div> : null}

        {tab === "info" ? <div>
          <section className="content-section-card space-y-5">
            <div className="content-section-heading">
              <div>
                <h2>{t("editBasicInfo")}</h2>
                <p>{t("editBasicInfoHint")}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={actionMut.isPending || translateBusy}
                onClick={() => void completeTitleTranslation()}
              >
                {translateBusy ? t("translateTitlesBusy") : t("translateTitles")}
              </Button>
            </div>
            <div className="content-info-layout">
              <div className="content-info-layout__cover">
                <DramaCoverField
                  url={draft.coverUrl || undefined}
                  disabled={actionMut.isPending}
                  episodeId={episodes[0] ? String(episodes[0].id) : undefined}
                  videoSrc={episodes[0]?.hlsUrl || episodes[0]?.originalUrl || undefined}
                  videoIsHls={/\.m3u8(\?|$)/i.test(episodes[0]?.hlsUrl || "")}
                  onChange={(next) => setDraft((v) => ({ ...v, coverUrl: next }))}
                  onError={setError}
                />
              </div>
              <div className="content-info-layout__titles">
                <FieldLabel label={t("contentTitleLocaleEn")} required>
                  <Input
                    maxLength={40}
                    value={draft.titleEn}
                    onChange={(e) => setDraft((v) => ({ ...v, titleEn: e.target.value }))}
                  />
                </FieldLabel>
                <FieldLabel label={t("contentTitleLocaleZh")}>
                  <Input
                    maxLength={40}
                    value={draft.titleZh}
                    placeholder={draft.titleEn.trim() || t("localeTitleFallbackPlaceholder")}
                    onChange={(e) => setDraft((v) => ({ ...v, titleZh: e.target.value }))}
                  />
                </FieldLabel>
                <FieldLabel label={t("contentTitleLocaleFr")}>
                  <Input
                    maxLength={40}
                    value={draft.titleFr}
                    placeholder={draft.titleEn.trim() || t("localeTitleFallbackPlaceholder")}
                    onChange={(e) => setDraft((v) => ({ ...v, titleFr: e.target.value }))}
                  />
                </FieldLabel>
                <p className="text-caption text-ink-subtle">{t("localeTitleFallbackHint")}</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <FieldLabel label={t("category")} required>
                <Select value={draft.categorySlug} onChange={(e) => setDraft((v) => ({ ...v, categorySlug: e.target.value }))}>
                  <option value="">{t("selectCategory")}</option>
                  {(categoriesQ.data ?? []).map((category) => (
                    <option key={category.slug} value={category.slug}>
                      {category.nameZh || category.nameEn || category.slug}
                    </option>
                  ))}
                </Select>
              </FieldLabel>
              <FieldLabel label={t("contentType")} required>
                <Select
                  value={draft.contentType}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, contentType: normalizeContentType(e.target.value) }))
                  }
                >
                  <option value="漫剧">{t("contentTypeComic")}</option>
                  <option value="真人短剧">{t("contentTypeLive")}</option>
                  <option value="AI短剧">{t("contentTypeAi")}</option>
                </Select>
              </FieldLabel>
              <FieldLabel label={t("completionStatus")} required>
                <Select
                  value={draft.completion}
                  onChange={(e) =>
                    setDraft((v) => ({ ...v, completion: normalizeCompletion(e.target.value) }))
                  }
                >
                  <option value="连载中">{t("completionOngoing")}</option>
                  <option value="已完结">{t("completionFinished")}</option>
                </Select>
              </FieldLabel>
            </div>
            <FieldLabel
              label={
                <>
                  {t("dramaTags")}
                  <em className="float-right not-italic text-ink-subtle">{draft.tags.length}/{MAX_DRAMA_TAGS}</em>
                </>
              }
            >
              <div className="flex flex-wrap gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5">
                {draft.tags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand"
                    onClick={() => setDraft((v) => ({ ...v, tags: v.tags.filter((item) => item !== tag) }))}
                  >
                    {tag} ×
                  </button>
                ))}
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
                      if (tag && !draft.tags.includes(tag) && draft.tags.length < MAX_DRAMA_TAGS) {
                        setDraft((v) => ({ ...v, tags: [...v.tags, tag] }));
                      }
                      setTagInput("");
                    }
                  }}
                />
              </div>
            </FieldLabel>
            <div className="grid gap-4 md:grid-cols-2">
              <FieldLabel label={t("descriptionEnLabel")}><textarea className="content-textarea" rows={7} value={draft.descriptionEn} onChange={(e) => setDraft((v) => ({ ...v, descriptionEn: e.target.value }))} /></FieldLabel>
              <FieldLabel label={t("descriptionZhLabel")}><textarea className="content-textarea" rows={7} value={draft.descriptionZh} onChange={(e) => setDraft((v) => ({ ...v, descriptionZh: e.target.value }))} /></FieldLabel>
            </div>
            <div className="content-save-bar"><span className={cn("text-xs", isDirty ? "text-warning" : "text-ink-subtle")}>{isDirty ? t("unsavedChanges") : t("allChangesSaved")}</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={!isDirty || actionMut.isPending} onClick={() => setDraft(savedDraft)}>{t("discardChanges")}</Button><Button size="sm" disabled={!isDirty || actionMut.isPending} onClick={saveBasicInfo}>{actionMut.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{actionMut.isPending ? t("saving") : t("saveChanges")}</Button></div></div>
          </section>
        </div> : null}

        {tab === "episodes" ? <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">{t("episodeManagement")}</h2>
              <p className="mt-0.5 text-xs text-ink-subtle">{t("episodeManagementHint", { n: episodes.length })}</p>
            </div>
            <Button size="sm" onClick={() => setShowAddEpisode((v) => !v)}>
              {showAddEpisode ? <ChevronDown className="h-4 w-4 rotate-180" /> : <Plus className="h-4 w-4" />}
              {showAddEpisode ? t("collapse") : t("addEpisode")}
            </Button>
          </div>
          {showAddEpisode ? (
            <section className="content-section-card space-y-4">
              {(() => {
                const primary = addEpisodeConfig.options.filter((o) => !o.advanced);
                const advanced = addEpisodeConfig.options.filter((o) => o.advanced);
                const methodTabs = showAdvancedAdd ? addEpisodeConfig.options : primary;
                return (
                  <>
                    <div className="seg-tabs" role="tablist" aria-label={t("addEpisodeMethods")}>
                      {methodTabs.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          role="tab"
                          aria-selected={addEpisodeMethod === item.key}
                          className="seg-tabs__item"
                          onClick={() => setAddEpisodeMethod(item.key)}
                        >
                          {t(item.labelKey)}
                          {item.advanced ? (
                            <span className="ml-1 text-[10px] text-ink-subtle">{t("addEpisodeAdvancedTag")}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                    {advanced.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setShowAdvancedAdd((v) => {
                              const next = !v;
                              if (!next && advanced.some((a) => a.key === addEpisodeMethod)) {
                                setAddEpisodeMethod(addEpisodeConfig.defaultMethod);
                              }
                              return next;
                            });
                          }}
                        >
                          {showAdvancedAdd ? t("addEpisodeHideAdvanced") : t("addEpisodeShowAdvanced")}
                        </Button>
                        {drama.sourceType === "ONLINE" && !addEpisodeConfig.canPullPublic ? (
                          <span className="text-xs text-ink-subtle">{t("addEpisodePublicBlockedHint")}</span>
                        ) : null}
                      </div>
                    ) : drama.sourceType === "ONLINE" && !addEpisodeConfig.canPullPublic ? (
                      <p className="text-xs text-ink-subtle">{t("addEpisodePublicBlockedHint")}</p>
                    ) : null}
                    {addEpisodeMethod === "url" && drama.sourceType !== "ONLINE" ? (
                      <p className="text-xs leading-5 text-warning">{t("addEpisodeUrlOnOwnedWarn")}</p>
                    ) : null}
                  </>
                );
              })()}

              <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                <FieldLabel label={t("colTitle")}>
                  <Input value={newEp.title} onChange={(e) => setNewEp((v) => ({ ...v, title: e.target.value }))} />
                </FieldLabel>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-muted">
                  <input
                    className="content-checkbox"
                    type="checkbox"
                    checked={newEp.isFree}
                    onChange={(e) => setNewEp((v) => ({ ...v, isFree: e.target.checked }))}
                  />
                  {t("free")}
                </label>
              </div>

              {addEpisodeMethod === "upload" ? (
                <div className="space-y-4">
                  <FieldLabel label={t("episodeThumbnail")}>
                    <EpisodeThumbnailField
                      url={newEp.thumbnailUrl || undefined}
                      disabled={actionMut.isPending}
                      fromVideoLabel={t("thumbFromVideo")}
                      uploadLabel={t("thumbUpload")}
                      onError={setError}
                      onUploaded={(url) => setNewEp((v) => ({ ...v, thumbnailUrl: url }))}
                    />
                  </FieldLabel>
                  <NewEpisodeUploadForm
                    dramaId={id}
                    title={newEp.title}
                    isFree={newEp.isFree}
                    priceCredits={newEp.priceCredits}
                    thumbnailUrl={newEp.thumbnailUrl || undefined}
                    disabled={actionMut.isPending}
                    onError={setError}
                    onDone={async () => {
                      setNewEp({ title: "", sourceUrl: "", publicPageUrl: "", thumbnailUrl: "", isFree: false, priceCredits: 10 });
                      setShowAddEpisode(false);
                      setError(null);
                      bumpStorageTotals();
                      await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
                      await qc.invalidateQueries({ queryKey: ["admin", "drama-storage", id] });
                    }}
                  />
                </div>
              ) : null}

              {addEpisodeMethod === "url" ? (
                <div className="space-y-4">
                  <p className="text-xs leading-5 text-ink-subtle">{t("addEpisodeUrlHint")}</p>
                  <FieldLabel label={t("playUrl")}>
                    <Input
                      placeholder="https://…m3u8"
                      value={newEp.sourceUrl}
                      onChange={(e) => setNewEp((v) => ({ ...v, sourceUrl: e.target.value }))}
                    />
                  </FieldLabel>
                  <FieldLabel label={t("episodeThumbnail")}>
                    <EpisodeThumbnailField
                      url={newEp.thumbnailUrl || undefined}
                      disabled={actionMut.isPending}
                      videoSrc={newEp.sourceUrl || undefined}
                      fromVideoLabel={t("thumbFromVideo")}
                      uploadLabel={t("thumbUpload")}
                      onError={setError}
                      onUploaded={(url) => setNewEp((v) => ({ ...v, thumbnailUrl: url }))}
                    />
                  </FieldLabel>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={actionMut.isPending || !newEp.sourceUrl.trim()}
                      onClick={() =>
                        act(async () => {
                          await adminCreateEpisode(id, {
                            title: newEp.title || undefined,
                            sourceUrl: newEp.sourceUrl.trim(),
                            thumbnailUrl: newEp.thumbnailUrl || undefined,
                            isFree: newEp.isFree,
                            priceCredits: newEp.isFree ? 0 : newEp.priceCredits,
                          });
                          setNewEp({ title: "", sourceUrl: "", publicPageUrl: "", thumbnailUrl: "", isFree: false, priceCredits: 10 });
                          setShowAddEpisode(false);
                        })
                      }
                    >
                      <Plus className="h-4 w-4" />
                      {t("addEpisodeByUrl")}
                    </Button>
                  </div>
                  <p className="text-xs leading-5 text-ink-subtle">{t("episodeThumbHint")}</p>
                </div>
              ) : null}

              {addEpisodeMethod === "public" ? (
                <div className="space-y-4">
                  <p className="text-xs leading-5 text-ink-subtle">{t("addEpisodePublicHint")}</p>
                  <FieldLabel label={t("publicVideoPageUrl")}>
                    <Input
                      placeholder="https://…"
                      value={newEp.publicPageUrl}
                      onChange={(e) => setNewEp((v) => ({ ...v, publicPageUrl: e.target.value }))}
                    />
                  </FieldLabel>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={actionMut.isPending || !newEp.publicPageUrl.trim() || !addEpisodeConfig.canPullPublic}
                      onClick={() =>
                        act(async () => {
                          await adminAppendPublicEpisodes(id, {
                            url: newEp.publicPageUrl.trim(),
                            formatPreference: "best_hls",
                          });
                          setNewEp({ title: "", sourceUrl: "", publicPageUrl: "", thumbnailUrl: "", isFree: false, priceCredits: 10 });
                          setShowAddEpisode(false);
                        })
                      }
                    >
                      <Cloud className="h-4 w-4" />
                      {t("pullPublicEpisodes")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          <div className="content-batch-toolbar">
            <div className="flex items-center gap-2">
              <input
                className="content-checkbox"
                type="checkbox"
                aria-label={t("selectAllPage")}
                checked={
                  pagedEpisodes.length > 0 &&
                  pagedEpisodes.every((ep) => selectedEps.has(String(ep.id)))
                }
                onChange={() => {
                  const pageIds = pagedEpisodes.map((ep) => String(ep.id));
                  const pageAllSelected =
                    pageIds.length > 0 && pageIds.every((id) => selectedEps.has(id));
                  setSelectedEps((prev) => {
                    const next = new Set(prev);
                    if (pageAllSelected) {
                      for (const id of pageIds) next.delete(id);
                    } else {
                      for (const id of pageIds) next.add(id);
                    }
                    return next;
                  });
                }}
              />
              <span className="text-xs font-medium text-ink-muted">{t("selectedCount", { n: selectedEps.size })}</span>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Select className="w-36" value={batchFree} onChange={(e) => setBatchFree(e.target.value as typeof batchFree)}>
                <option value="keep">{t("batchKeepFree")}</option>
                <option value="1">{t("batchSetFree")}</option>
                <option value="0">{t("batchSetPaid")}</option>
              </Select>
              <Input
                className="w-32"
                type="number"
                placeholder={t("priceCreditsPerEpisode")}
                value={batchPrice}
                onChange={(e) => setBatchPrice(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!selectedEps.size || actionMut.isPending || (batchFree === "keep" && batchPrice === "")}
                onClick={() =>
                  act(() =>
                    adminBatchEpisodes(id, {
                      ids: [...selectedEps],
                      ...(batchFree !== "keep" ? { isFree: batchFree === "1" } : {}),
                      ...(batchPrice !== "" ? { priceCredits: Number(batchPrice) } : {}),
                    }),
                  )
                }
              >
                {t("batchApply")}
              </Button>
            </div>
          </div>
          <DataTable
            className="content-episode-table"
            columns={episodeColumns}
            rows={pagedEpisodes}
            emptyTitle={t("emptyEpisodes")}
          />
          {episodes.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/45 px-3 py-2 text-caption text-ink-muted">
              <span>
                {`${(episodePage - 1) * EPISODE_PAGE_SIZE + 1}–${Math.min(episodePage * EPISODE_PAGE_SIZE, episodes.length)} / ${episodes.length}`}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={episodePage <= 1}
                  onClick={() => setEpisodePage((page) => Math.max(1, page - 1))}
                >
                  {t("previousPage")}
                </Button>
                <span className="min-w-12 text-center font-medium text-ink">
                  {episodePage} / {episodeTotalPages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={episodePage >= episodeTotalPages}
                  onClick={() => setEpisodePage((page) => Math.min(episodeTotalPages, page + 1))}
                >
                  {t("nextPage")}
                </Button>
              </div>
            </div>
          ) : null}
          <DramaStoragePanel
            dramaId={id}
            totalsNonce={storageTotalsNonce}
            onPurge={async (episodeId) => {
              setPurgeEpisodeId(episodeId);
            }}
          />
        </div> : null}

        {tab === "policy" ? (
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
            allowPreview={allowPreview}
            onAllowPreviewChange={setAllowPreview}
            previewSeconds={previewSeconds}
            onPreviewSecondsChange={setPreviewSeconds}
            disabled={actionMut.isPending}
            previewRadioName="edit-member-preview-policy"
            showSaveButton
            savePending={actionMut.isPending}
            onSave={() => act(() => savePlaybackPolicy())}
          />
        ) : null}
      </div>

      <GlassModal
        open={!!watermarkRetryId}
        onClose={() => {
          setWatermarkRetryId(null);
          setWatermarkFrame(null);
        }}
        title={t("retryTranscode")}
        size="lg"
        zIndex={95}
      >
        <div className="space-y-4">
          {watermarkFrameBusy ? (
            <p className="text-caption text-ink-muted">{t("watermarkLoadingFrame")}</p>
          ) : null}
          <WatermarkPositionEditor
            frameUrl={watermarkFrame?.url || null}
            frameWidth={watermarkFrame?.width}
            frameHeight={watermarkFrame?.height}
            value={watermarkPlacement}
            busy={actionMut.isPending || watermarkFrameBusy}
            onChange={setWatermarkPlacement}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={actionMut.isPending}
              onClick={() => {
                setWatermarkRetryId(null);
                setWatermarkFrame(null);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              disabled={actionMut.isPending || !watermarkRetryId}
              onClick={() => {
                if (!watermarkRetryId) return;
                const epId = watermarkRetryId;
                act(() =>
                  adminRetryTranscode(epId, {
                    watermarkEnabled: watermarkPlacement.enabled,
                    watermarkX: watermarkPlacement.x,
                    watermarkY: watermarkPlacement.y,
                    watermarkScale: watermarkPlacement.scale,
                  }),
                );
                setWatermarkRetryId(null);
                setWatermarkFrame(null);
              }}
            >
              {t("retryTranscode")}
            </Button>
          </div>
        </div>
      </GlassModal>
      <ConfirmModal
        open={offlineOpen}
        onClose={() => setOfflineOpen(false)}
        onConfirm={handleOfflineDrama}
        message={t("confirmForceOffline")}
        busy={actionMut.isPending}
      />
      <ConfirmModal
        open={onlineOpen}
        onClose={() => setOnlineOpen(false)}
        onConfirm={handleOnlineDrama}
        message={t("confirmRestoreOnline")}
        confirmVariant="primary"
        busy={actionMut.isPending}
      />
      <ConfirmModal open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDeleteDrama} message={t("confirmDeleteDrama")} busy={actionMut.isPending} />
      <ConfirmModal open={!!deleteEpisodeId} onClose={() => setDeleteEpisodeId(null)} onConfirm={() => { if (!deleteEpisodeId) return; actionMut.mutate(() => adminDeleteEpisode(deleteEpisodeId), { onSuccess: async () => { setDeleteEpisodeId(null); bumpStorageTotals(); await qc.invalidateQueries({ queryKey: ["admin", "drama", id] }); await qc.invalidateQueries({ queryKey: ["admin", "drama-storage", id] }); } }); }} message={t("confirmDeleteEpisode")} busy={actionMut.isPending} />
      <ConfirmModal
        open={!!purgeEpisodeId}
        onClose={() => setPurgeEpisodeId(null)}
        onConfirm={() => {
          if (!purgeEpisodeId) return;
          actionMut.mutate(() => adminPurgeEpisodeMedia(purgeEpisodeId), {
            onSuccess: async () => {
              setPurgeEpisodeId(null);
              bumpStorageTotals();
              await qc.invalidateQueries({ queryKey: ["admin", "drama", id] });
              await qc.invalidateQueries({ queryKey: ["admin", "drama-storage", id] });
            },
          });
        }}
        message={t("confirmPurgeMedia")}
        busy={actionMut.isPending}
      />
    </div>
  );
});
