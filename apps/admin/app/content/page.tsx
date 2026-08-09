"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal,
  ExternalLink,
  Trash2,
  Check,
  X,
} from "lucide-react";
import {
  adminApproveDrama,
  adminBatchDramaLifecycle,
  adminBatchDramas,
  adminListCategories,
  adminListCreators,
  adminListDramas,
  adminRejectDrama,
  adminSetFeatured,
  adminSetOfficial,
  adminSetSortWeight,
  adminUpdateDrama,
  asRows,
} from "@velvet/api-client";
import { Badge, Button, DataTable, Input, Select, Switch, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { CategoriesModal } from "@/components/categories-modal";
import { ContentDetailModal } from "@/components/content-detail-modal";
import {
  ContentSearchBar,
  type ContentSearchFilters,
  type ContentSort,
} from "@/components/content-search-bar";
import { DramaCoverThumb } from "@/components/drama-cover-thumb";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { useAdminSession } from "@/lib/admin-session";
import { parseContentDetailTab } from "@/lib/content-href";
import { useI18n, statusLabel } from "@/lib/i18n";
import { webDramaPreviewHref } from "@/lib/web-preview";

type Drama = {
  id: string | number;
  titleZh?: string;
  titleEn?: string;
  slug?: string;
  coverUrl?: string | null;
  status?: string;
  creator?: { id?: string | number; displayName?: string };
  viewCount?: number | string;
  likeCount?: number | string;
  favoriteCount?: number | string;
  unlockCount?: number | string;
  isOfficial?: boolean;
  isFeatured?: boolean;
  sortWeight?: number;
  publishedAt?: string | null;
  createdAt?: string | null;
  _count?: { episodes?: number };
};
type Category = { slug: string; nameZh?: string; nameEn?: string };
type Creator = { id: string | number; displayName?: string };
type ContentModal = "detail" | "categories";
type ContentView = "all" | "latest" | "pending";

const statuses = ["ALL", "DRAFT", "PENDING_REVIEW", "LIVE", "OFFLINE", "REJECTED"];
const PAGE_SIZE_OPTIONS = [10, 20, 50];

function parseSort(raw: string | null): ContentSort {
  if (raw === "latest" || raw === "views" || raw === "unlocks" || raw === "weight") return raw;
  return "latest";
}

function parseView(searchParams: URLSearchParams): ContentView {
  const view = searchParams.get("view");
  if (view === "latest" || view === "pending") return view;
  if (searchParams.get("status") === "PENDING_REVIEW") return "pending";
  if (searchParams.get("sort") === "latest" && !searchParams.get("view")) return "latest";
  return "all";
}

function parsePageSize(raw: string | null) {
  const n = Number(raw);
  return PAGE_SIZE_OPTIONS.includes(n) ? n : 20;
}

/** Compact ops console datetime: YYYY-MM-DD HH:mm */
function fmtOpsDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function filtersFromUrl(
  searchParams: URLSearchParams,
  view: ContentView,
  sort: ContentSort,
): ContentSearchFilters {
  const status =
    view === "pending" ? "PENDING_REVIEW" : searchParams.get("status") || "ALL";
  const official = searchParams.get("official") || "";
  const featured = searchParams.get("featured") || "";
  const media = searchParams.get("media") || "";
  const dateField = searchParams.get("dateField") === "createdAt" ? "createdAt" : "publishedAt";
  return {
    q: searchParams.get("q") || "",
    status: statuses.includes(status) ? status : "ALL",
    categorySlug: searchParams.get("category") || "",
    creatorId: searchParams.get("creator") || "",
    isOfficial: official === "1" || official === "0" ? official : "",
    isFeatured: featured === "1" || featured === "0" ? featured : "",
    mediaKind:
      media === "owned" || media === "online" || media === "r2" || media === "local" ? media : "",
    sort,
    dateField,
    dateFrom: searchParams.get("from") || "",
    dateTo: searchParams.get("to") || "",
  };
}

function toMetric(value?: number | string | null) {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Compact number field for list metrics — commit on blur / Enter. */
function MetricCountEdit({
  value,
  ariaLabel,
  disabled,
  onCommit,
}: {
  value: number;
  ariaLabel: string;
  disabled?: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  function commit() {
    const n = Math.floor(Number(draft));
    if (!Number.isFinite(n) || n < 0) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
    else setDraft(String(n));
  }

  return (
    <Input
      type="number"
      min={0}
      step={1}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="h-7 w-[4.75rem] px-1.5 text-right text-xs tabular-nums"
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function FlagTogglePill({
  active,
  tone,
  disabled,
  children,
  onToggle,
}: {
  active: boolean;
  tone: "official" | "featured" | "weight";
  disabled?: boolean;
  children: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      className={
        active
          ? `content-flag-pill content-flag-pill--${tone}`
          : "content-flag-pill content-flag-pill--off"
      }
      onClick={onToggle}
    >
      {children}
    </button>
  );
}

function unlockRate(views?: number | string | null, unlocks?: number | string | null) {
  const v = toMetric(views);
  const u = toMetric(unlocks);
  if (v <= 0) return "—";
  return `${((u / v) * 100).toFixed(1)}%`;
}

/**
 * Soft status pills — plain spans, not Badge.
 * Badge tone utilities (bg-success-soft etc.) live in @layer utilities and
 * always beat .content-status-pill rules in @layer components.
 */
function dramaStatusPillClass(status?: string) {
  switch (status) {
    case "LIVE":
      return "content-status-pill content-status-pill--live";
    case "PENDING_REVIEW":
      return "content-status-pill content-status-pill--pending";
    case "REJECTED":
      return "content-status-pill content-status-pill--rejected";
    case "OFFLINE":
      return "content-status-pill content-status-pill--offline";
    case "DRAFT":
    default:
      return "content-status-pill content-status-pill--draft";
  }
}

function paginationItems(page: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const visible = new Set([1, total, page - 1, page, page + 1]);
  const pages = [...visible].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  pages.forEach((value, index) => {
    if (index > 0 && value - pages[index - 1] > 1) result.push("ellipsis");
    result.push(value);
  });
  return result;
}

function buildContentHref(opts: {
  view?: ContentView;
  status?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  q?: string;
  categorySlug?: string;
  creatorId?: string;
  isOfficial?: string;
  isFeatured?: string;
  mediaKind?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
  modal?: ContentModal | null;
  id?: string | null;
  tab?: string | null;
}) {
  const qs = new URLSearchParams();
  if (opts.view === "latest") qs.set("view", "latest");
  if (opts.view === "pending") qs.set("view", "pending");

  if (opts.view === "pending") {
    // status pinned by view
  } else if (opts.status && opts.status !== "ALL") {
    qs.set("status", opts.status);
  }

  if (opts.view === "latest") {
    if (opts.sort && opts.sort !== "latest") qs.set("sort", opts.sort);
  } else if (opts.sort && opts.sort !== "latest") {
    qs.set("sort", opts.sort);
  }

  if (opts.q) qs.set("q", opts.q);
  if (opts.categorySlug) qs.set("category", opts.categorySlug);
  if (opts.creatorId) qs.set("creator", opts.creatorId);
  if (opts.isOfficial === "1" || opts.isOfficial === "0") qs.set("official", opts.isOfficial);
  if (opts.isFeatured === "1" || opts.isFeatured === "0") qs.set("featured", opts.isFeatured);
  if (opts.mediaKind) qs.set("media", opts.mediaKind);
  if (opts.dateField && opts.dateField !== "publishedAt") qs.set("dateField", opts.dateField);
  if (opts.dateFrom) qs.set("from", opts.dateFrom);
  if (opts.dateTo) qs.set("to", opts.dateTo);

  if (opts.page && opts.page > 1) qs.set("page", String(opts.page));
  if (opts.pageSize && opts.pageSize !== 20) qs.set("pageSize", String(opts.pageSize));
  if (opts.modal) qs.set("modal", opts.modal);
  if (opts.modal === "detail" && opts.id) {
    qs.set("id", opts.id);
    if (opts.tab) qs.set("tab", opts.tab);
  }
  const next = qs.toString();
  return next ? `/content?${next}` : "/content";
}

const ROW_MENU_MIN_WIDTH = 152;
const ROW_MENU_EST_HEIGHT = 96;
const ROW_MENU_GAP = 4;
const ROW_MENU_VIEWPORT_PAD = 8;

const rowActionClass =
  "content-row-action h-8 w-8 shrink-0 gap-0 px-0 hover:translate-y-0 hover:shadow-none";

/** Row ⋯ menu (preview / delete). Portal keeps overflow tables usable. */
function RowMoreMenu({
  row,
  busy,
  canDelete,
  onDelete,
}: {
  row: Drama;
  busy: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Public catalog only serves LIVE; prefer slug (canonical) over id.
  const previewHref = webDramaPreviewHref(row);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }

    function placeMenu() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuEl = menuRef.current;
      const menuWidth = Math.max(menuEl?.offsetWidth ?? 0, ROW_MENU_MIN_WIDTH);
      const menuHeight = menuEl?.offsetHeight || ROW_MENU_EST_HEIGHT;
      const spaceBelow = window.innerHeight - rect.bottom - ROW_MENU_VIEWPORT_PAD;
      const openAbove = spaceBelow < menuHeight + ROW_MENU_GAP && rect.top > spaceBelow;
      const top = openAbove
        ? Math.max(ROW_MENU_VIEWPORT_PAD, rect.top - menuHeight - ROW_MENU_GAP)
        : Math.min(
            rect.bottom + ROW_MENU_GAP,
            window.innerHeight - menuHeight - ROW_MENU_VIEWPORT_PAD,
          );
      const left = Math.min(
        Math.max(ROW_MENU_VIEWPORT_PAD, rect.right - menuWidth),
        window.innerWidth - menuWidth - ROW_MENU_VIEWPORT_PAD,
      );
      setMenuPos({ top, left });
    }

    placeMenu();
    window.addEventListener("resize", placeMenu);
    // Capture scroll from nested overflow (DataTable) without closing first.
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: menuPos?.top ?? -9999,
              left: menuPos?.left ?? -9999,
              minWidth: ROW_MENU_MIN_WIDTH,
              visibility: menuPos ? "visible" : "hidden",
            }}
            className="z-[70] rounded-xl border border-line bg-white py-1 text-ink shadow-lg"
          >
            {previewHref ? (
              <a
                role="menuitem"
                className="flex items-center gap-2 px-3 py-2 text-body-sm text-ink hover:bg-brand-soft"
                href={previewHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <ExternalLink className="size-3.5 shrink-0 text-ink-muted" />
                {t("previewOnWeb")}
              </a>
            ) : (
              <span
                role="menuitem"
                aria-disabled="true"
                title={t("previewOnWebLiveOnly")}
                className="flex cursor-not-allowed items-center gap-2 px-3 py-2 text-body-sm text-ink-muted"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                {t("previewOnWeb")}
              </span>
            )}
            {canDelete ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm text-danger hover:bg-danger-soft"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <Trash2 className="size-3.5 shrink-0" />
                {t("rowDelete")}
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t("moreActions")}
          title={t("moreActions")}
          className={rowActionClass}
          onClick={() => setOpen((v) => !v)}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </span>
      {menu}
    </>
  );
}

function AdminContentInner() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const { admin } = useAdminSession();
  // No SUPER_ADMIN fallback — hide hard-delete until role is known.
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";

  const view = parseView(searchParams);
  const statusFromUrl =
    view === "pending" ? "PENDING_REVIEW" : searchParams.get("status") || "ALL";
  const sortFromUrl =
    view === "latest" && !searchParams.get("sort")
      ? "latest"
      : parseSort(searchParams.get("sort"));
  const pageFromUrl = Math.max(1, Number(searchParams.get("page") || 1) || 1);
  const pageSizeFromUrl = parsePageSize(searchParams.get("pageSize"));
  const modalParam = searchParams.get("modal");
  const modal =
    modalParam === "detail" || modalParam === "categories" ? modalParam : null;
  const detailId = modal === "detail" ? searchParams.get("id") : null;
  const detailTab = modal === "detail" ? parseContentDetailTab(searchParams.get("tab")) : null;
  const urlFilterKey = searchParams.toString();

  const [filters, setFilters] = useState<ContentSearchFilters>(() =>
    filtersFromUrl(searchParams, view, sortFromUrl),
  );
  const [page, setPage] = useState(pageFromUrl);
  const [pageSize, setPageSize] = useState(pageSizeFromUrl);
  const [selected, setSelected] = useState<Map<string, Drama>>(new Map());
  const [batch, setBatch] = useState({
    freeEpisodeCount: 3,
    priceCredits: 10,
    buyoutCredits: 0,
    lockMode: "" as "" | "INHERIT" | "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE",
    sortWeight: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lifecycleConfirm, setLifecycleConfirm] = useState<"offline" | "online" | "delete" | null>(
    null,
  );
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [rowDelete, setRowDelete] = useState<Drama | null>(null);
  const [rejectRow, setRejectRow] = useState<Drama | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [jumpPage, setJumpPage] = useState("");
  const [menuBusyId, setMenuBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (modalParam !== "add") return;
    const tab = searchParams.get("tab");
    const qs =
      tab === "online" || tab === "transfer"
        ? "?tab=online"
        : tab === "owned" || tab === "upload" || tab === "local"
          ? "?tab=owned"
          : "?tab=owned";
    router.replace(`/content/add${qs}`);
  }, [modalParam, router, searchParams]);

  useEffect(() => {
    setFilters(filtersFromUrl(searchParams, view, sortFromUrl));
    setPage(pageFromUrl);
    setPageSize(pageSizeFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFilterKey, view, statusFromUrl, sortFromUrl, pageFromUrl, pageSizeFromUrl]);

  function syncUrl(next: {
    view?: ContentView;
    status?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
    filters?: ContentSearchFilters;
    modal?: ContentModal | null;
    id?: string | null;
    tab?: string | null;
  }) {
    const f = next.filters ?? filters;
    router.replace(
      buildContentHref({
        view: next.view ?? view,
        status: next.status ?? f.status,
        sort: next.sort ?? f.sort,
        page: next.page ?? page,
        pageSize: next.pageSize ?? pageSize,
        q: f.q,
        categorySlug: f.categorySlug,
        creatorId: f.creatorId,
        isOfficial: f.isOfficial,
        isFeatured: f.isFeatured,
        mediaKind: f.mediaKind,
        dateField: f.dateField,
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
        modal: next.modal === undefined ? modal : next.modal,
        id: next.id === undefined ? detailId : next.id,
        tab: next.tab === undefined ? detailTab : next.tab,
      }),
    );
  }

  function closeModal() {
    syncUrl({ modal: null, id: null, tab: null });
  }

  function openModal(nextModal: ContentModal, id?: string) {
    syncUrl({
      modal: nextModal,
      id: nextModal === "detail" ? id ?? null : null,
      tab: nextModal === "detail" ? detailTab : null,
    });
  }

  function applyFilters(next: ContentSearchFilters) {
    setFilters(next);
    setPage(1);

    let resolvedView: ContentView = "all";
    if (view === "pending" && next.status === "PENDING_REVIEW") resolvedView = "pending";
    else if (view === "latest" && next.sort === "latest") resolvedView = "latest";

    syncUrl({
      view: resolvedView,
      status: next.status,
      sort: next.sort,
      page: 1,
      filters: next,
    });
  }

  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Category[]>,
  });
  const creatorsQ = useQuery({
    queryKey: ["admin", "creators", "picker"],
    queryFn: async () => {
      const result = await adminListCreators({ page: 1, pageSize: 100 });
      return asRows<Creator>(result);
    },
  });
  const dramaCountsQ = useQuery({
    queryKey: ["admin", "dramas", "counts"],
    queryFn: async () => {
      const [all, live] = await Promise.all([
        adminListDramas({ page: 1, pageSize: 1, status: "ALL" }),
        adminListDramas({ page: 1, pageSize: 1, status: "LIVE" }),
      ]);
      return {
        total: (all as { total?: number }).total ?? 0,
        live: (live as { total?: number }).total ?? 0,
      };
    },
    staleTime: 30_000,
  });
  const dramasQ = useQuery({
    queryKey: ["admin", "dramas", filters, page, pageSize],
    queryFn: async () => {
      const result = await adminListDramas({
        q: filters.q || undefined,
        status: filters.status,
        categorySlug: filters.categorySlug || undefined,
        creatorId: filters.creatorId || undefined,
        isOfficial: filters.isOfficial || undefined,
        isFeatured: filters.isFeatured || undefined,
        mediaKind:
          filters.mediaKind === "r2" || filters.mediaKind === "local"
            ? "owned"
            : filters.mediaKind || undefined,
        sort: filters.sort,
        dateField: filters.dateField,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        page,
        pageSize,
      });
      return {
        rows: asRows<Drama>(result),
        total: (result as { total?: number }).total ?? 0,
      };
    },
  });

  function goToPage(nextPage: number) {
    const totalPages = Math.max(1, Math.ceil((dramasQ.data?.total ?? 0) / pageSize));
    const clamped = Math.min(Math.max(1, nextPage), totalPages);
    setPage(clamped);
    syncUrl({ page: clamped });
  }

  const selectedIds = useMemo(() => [...selected.keys()], [selected]);
  const selectedCount = selectedIds.length;

  const batchMut = useMutation({
    mutationFn: (patch: Parameters<typeof adminBatchDramas>[0]) => adminBatchDramas(patch),
    onSuccess: async () => {
      setSelected(new Map());
      setError(null);
      setNotice(t("batchApplyOk"));
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const metricMut = useMutation({
    mutationFn: (payload: { id: string; likeCount?: number; favoriteCount?: number }) =>
      adminUpdateDrama(payload.id, {
        ...(payload.likeCount != null ? { likeCount: payload.likeCount } : {}),
        ...(payload.favoriteCount != null ? { favoriteCount: payload.favoriteCount } : {}),
      }),
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: ["admin", "dramas"] });
      const previous = qc.getQueriesData<{ rows: Drama[]; total: number }>({
        queryKey: ["admin", "dramas"],
      });
      qc.setQueriesData<{ rows: Drama[]; total: number }>(
        { queryKey: ["admin", "dramas"] },
        (old) => {
          // Skip sibling caches under this prefix (e.g. ["admin","dramas","counts"]).
          if (!old?.rows) return old;
          return {
            ...old,
            rows: old.rows.map((row) =>
              String(row.id) === variables.id
                ? {
                    ...row,
                    ...(variables.likeCount != null ? { likeCount: variables.likeCount } : {}),
                    ...(variables.favoriteCount != null
                      ? { favoriteCount: variables.favoriteCount }
                      : {}),
                  }
                : row,
            ),
          };
        },
      );
      return { previous };
    },
    onError: (e: Error, _variables, ctx) => {
      if (ctx?.previous) {
        for (const [key, data] of ctx.previous) qc.setQueryData(key, data);
      }
      setError(e.message);
    },
    onSuccess: () => setError(null),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
  });

  const lastWeightRef = useRef<Record<string, number>>({});

  type FlagPatch =
    | { id: string; kind: "official"; value: boolean }
    | { id: string; kind: "featured"; value: boolean }
    | { id: string; kind: "weight"; value: number };

  const flagMut = useMutation({
    mutationFn: async (payload: FlagPatch) => {
      if (payload.kind === "official") return adminSetOfficial(payload.id, payload.value);
      if (payload.kind === "featured") return adminSetFeatured(payload.id, payload.value);
      return adminSetSortWeight(payload.id, payload.value);
    },
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: ["admin", "dramas"] });
      const previous = qc.getQueriesData<{ rows: Drama[]; total: number }>({
        queryKey: ["admin", "dramas"],
      });
      qc.setQueriesData<{ rows: Drama[]; total: number }>(
        { queryKey: ["admin", "dramas"] },
        (old) => {
          // Skip sibling caches under this prefix (e.g. ["admin","dramas","counts"]).
          if (!old?.rows) return old;
          return {
            ...old,
            rows: old.rows.map((row) => {
              if (String(row.id) !== variables.id) return row;
              if (variables.kind === "official") return { ...row, isOfficial: variables.value };
              if (variables.kind === "featured") return { ...row, isFeatured: variables.value };
              return { ...row, sortWeight: variables.value };
            }),
          };
        },
      );
      return { previous };
    },
    onError: (e: Error, _variables, ctx) => {
      if (ctx?.previous) {
        for (const [key, data] of ctx.previous) qc.setQueryData(key, data);
      }
      setError(e.message);
    },
    onSuccess: () => setError(null),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
  });

  const lifecycleMut = useMutation({
    mutationFn: (payload: {
      action: "offline" | "online" | "delete";
      ids: string[];
    }) =>
      adminBatchDramaLifecycle({
        ids: payload.ids,
        action: payload.action,
        reason: `admin batch ${payload.action}`,
      }),
    onMutate: async (variables) => {
      if (variables.action === "delete") return { previous: undefined };

      await qc.cancelQueries({ queryKey: ["admin", "dramas"] });
      const previous = qc.getQueriesData<{ rows: Drama[]; total: number }>({
        queryKey: ["admin", "dramas"],
      });
      const nextStatus = variables.action === "online" ? "LIVE" : "OFFLINE";
      const idSet = new Set(variables.ids);
      qc.setQueriesData<{ rows: Drama[]; total: number }>(
        { queryKey: ["admin", "dramas"] },
        (old) => {
          // Skip sibling caches under this prefix (e.g. ["admin","dramas","counts"]).
          if (!old?.rows) return old;
          return {
            ...old,
            rows: old.rows.map((row) =>
              idSet.has(String(row.id)) ? { ...row, status: nextStatus } : row,
            ),
          };
        },
      );
      return { previous };
    },
    onSuccess: async (result, variables) => {
      setLifecycleConfirm(null);
      setRowDelete(null);
      setMenuBusyId(null);

      const requested = result?.requested ?? variables.ids.length;
      const updated = result?.updated ?? 0;
      const skipped =
        result?.skipped ?? Math.max(0, requested - updated - (result?.failed?.length ?? 0));
      const failed = result?.failed?.length ?? 0;
      const silentRowToggle =
        variables.action !== "delete" && variables.ids.length === 1;

      // Single-row online/offline: keep optimistic row state; avoid notice + refetch flash.
      if (silentRowToggle) {
        if (failed > 0 || updated < 1) {
          setNotice(null);
          setError(
            failed > 0
              ? t("batchLifecyclePartial", {
                  ok: updated,
                  fail: failed,
                  detail: result.failed.map((f) => `${f.id}: ${f.error}`).join("; "),
                })
              : t("batchLifecycleSkipped", {
                  action:
                    variables.action === "offline" ? t("batchOffline") : t("batchOnline"),
                  n: requested,
                  ok: updated,
                  skip: skipped || requested - updated,
                }),
          );
          await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
        } else {
          setError(null);
        }
        return;
      }

      setSelected((prev) => {
        const next = new Map(prev);
        for (const id of variables.ids) next.delete(id);
        return next;
      });

      // Delete: modal result (no top banner; no「批量」wording).
      if (variables.action === "delete") {
        setNotice(null);
        setError(null);
        const detail = result.failed?.map((f) => `${f.id}: ${f.error}`).join("; ") ?? "";
        const r2 = result.purge?.r2Deleted ?? 0;
        const local = result.purge?.localDeleted ?? 0;
        if (failed > 0) {
          const purgeNote =
            updated > 0
              ? `（成功项：R2 清理 ${r2}，本地清理 ${local}）`
              : "";
          setDeleteResult(
            [
              t("deleteLifecyclePartial", { ok: updated, fail: failed, detail }),
              purgeNote,
              t("deleteLifecyclePurgeHint"),
            ]
              .filter(Boolean)
              .join("\n"),
          );
        } else if (skipped > 0 || updated < requested) {
          setDeleteResult(
            t("deleteLifecycleSkipped", {
              n: requested,
              ok: updated,
              skip: skipped || requested - updated,
            }),
          );
        } else {
          setDeleteResult(t("deleteLifecycleOk", { ok: updated, r2, local }));
        }
        await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
        return;
      }

      const actionLabel =
        variables.action === "offline" ? t("batchOffline") : t("batchOnline");

      if (failed > 0) {
        setNotice(null);
        setError(
          t("batchLifecyclePartial", {
            ok: updated,
            fail: failed,
            detail: result.failed.map((f) => `${f.id}: ${f.error}`).join("; "),
          }),
        );
      } else if (skipped > 0 || updated < requested) {
        setError(null);
        setNotice(
          t("batchLifecycleSkipped", {
            action: actionLabel,
            n: requested,
            ok: updated,
            skip: skipped || requested - updated,
          }),
        );
      } else {
        setError(null);
        setNotice(t("batchLifecycleOk", { action: actionLabel, ok: updated }));
      }
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (
      e: Error,
      variables,
      context?: { previous?: ReturnType<typeof qc.getQueriesData<{ rows: Drama[]; total: number }>> },
    ) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          qc.setQueryData(key, data);
        }
      }
      setLifecycleConfirm(null);
      setRowDelete(null);
      setMenuBusyId(null);
      setNotice(null);
      if (variables?.action === "delete") {
        setError(null);
        setDeleteResult(e.message);
      } else {
        setError(e.message);
      }
    },
  });

  const reviewMut = useMutation({
    mutationFn: async (payload: { id: string; action: "approve" | "reject"; reason?: string }) => {
      if (payload.action === "approve") return adminApproveDrama(payload.id);
      return adminRejectDrama(payload.id, payload.reason || "");
    },
    onSuccess: async (_data, variables) => {
      setRejectRow(null);
      setRejectReason("");
      setMenuBusyId(null);
      setError(null);
      setNotice(
        variables.action === "approve" ? t("approveReviewOk") : t("rejectReviewOk"),
      );
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => {
      setMenuBusyId(null);
      setNotice(null);
      setError(e.message);
    },
  });

  const rows = dramasQ.data?.rows ?? [];
  const busy =
    batchMut.isPending ||
    reviewMut.isPending ||
    metricMut.isPending ||
    flagMut.isPending ||
    (lifecycleMut.isPending &&
      (lifecycleMut.variables?.action === "delete" ||
        (lifecycleMut.variables?.ids.length ?? 0) > 1));
  const total = dramasQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageAllSelected = rows.length > 0 && rows.every((row) => selected.has(String(row.id)));
  const pageSomeSelected = rows.some((row) => selected.has(String(row.id)));

  function togglePageSelection(selectAll: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (selectAll) {
        for (const row of rows) next.set(String(row.id), row);
      } else {
        for (const row of rows) next.delete(String(row.id));
      }
      return next;
    });
  }

  function toggleRow(row: Drama, checked: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      const id = String(row.id);
      if (checked) next.set(id, row);
      else next.delete(id);
      return next;
    });
  }

  const columns: Column<Drama>[] = useMemo(
    () => [
      {
        key: "select",
        className: "w-10 min-w-10 max-w-10",
        header: (
          <input
            type="checkbox"
            title={t("selectAllPageHint")}
            aria-label={t("selectAllPage")}
            checked={pageAllSelected}
            ref={(el) => {
              if (el) el.indeterminate = pageSomeSelected && !pageAllSelected;
            }}
            disabled={busy || rows.length === 0}
            onChange={() => togglePageSelection(!pageAllSelected)}
          />
        ),
        cell: (row) => (
          <input
            type="checkbox"
            checked={selected.has(String(row.id))}
            onChange={(e) => toggleRow(row, e.target.checked)}
          />
        ),
      },
      {
        key: "cover",
        header: t("colCover"),
        className: "w-14 min-w-14",
        cell: (row) => (
          <DramaCoverThumb url={row.coverUrl} title={row.titleEn || row.titleZh} />
        ),
      },
      {
        key: "title",
        header: t("colTitle"),
        className: "content-title-col",
        cell: (row) => (
          <div className="min-w-0 max-w-full">
            <button
              type="button"
              className="block w-full truncate text-left font-medium text-brand hover:underline"
              onClick={() => openModal("detail", String(row.id))}
            >
              {row.titleEn || row.titleZh || "—"}
            </button>
            <div className="truncate text-caption text-ink-muted">
              {row.titleEn && row.titleZh ? row.titleZh : row.slug || "—"}
            </div>
          </div>
        ),
      },
      {
        key: "eps",
        header: t("episodeCount"),
        cell: (row) => String(row._count?.episodes ?? "—"),
        className: "content-metric-col tabular-nums text-right",
      },
      {
        key: "creator",
        header: t("colCreator"),
        className: "hidden xl:table-cell max-w-[7.5rem] whitespace-nowrap",
        cell: (row) => {
          const name = row.creator?.displayName;
          return name ? (
            <span className="block max-w-[7.5rem] truncate" title={name}>
              {name}
            </span>
          ) : (
            <span className="text-ink-subtle">—</span>
          );
        },
      },
      {
        key: "published",
        header: t("publishedAt"),
        className: "hidden 2xl:table-cell content-metric-col",
        cell: (row) =>
          row.publishedAt ? (
            fmtOpsDateTime(row.publishedAt)
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      {
        key: "likes",
        header: t("colLikes"),
        className: "content-metric-col tabular-nums text-right",
        cell: (row) => (
          <MetricCountEdit
            value={toMetric(row.likeCount)}
            ariaLabel={t("colLikes")}
            disabled={busy || metricMut.isPending}
            onCommit={(likeCount) => metricMut.mutate({ id: String(row.id), likeCount })}
          />
        ),
      },
      {
        key: "favorites",
        header: t("colFavorites"),
        className: "content-metric-col tabular-nums text-right",
        cell: (row) => (
          <MetricCountEdit
            value={toMetric(row.favoriteCount)}
            ariaLabel={t("colFavorites")}
            disabled={busy || metricMut.isPending}
            onCommit={(favoriteCount) => metricMut.mutate({ id: String(row.id), favoriteCount })}
          />
        ),
      },
      {
        key: "views",
        header: t("colViews"),
        className: "content-metric-col tabular-nums text-right",
        cell: (row) => {
          const n = toMetric(row.viewCount);
          return <span className={n === 0 ? "text-ink-subtle" : undefined}>{fmtNum(n)}</span>;
        },
      },
      {
        key: "unlocks",
        header: t("colUnlocks"),
        className: "content-metric-col tabular-nums text-right",
        cell: (row) => {
          const n = toMetric(row.unlockCount);
          return <span className={n === 0 ? "text-ink-subtle" : undefined}>{fmtNum(n)}</span>;
        },
      },
      {
        key: "unlockRate",
        header: t("colUnlockRate"),
        className: "hidden 2xl:table-cell content-metric-col tabular-nums text-right",
        cell: (row) => {
          const rate = unlockRate(row.viewCount, row.unlockCount);
          return <span className={rate === "—" ? "text-ink-subtle" : undefined}>{rate}</span>;
        },
      },
      {
        key: "flags",
        header: t("colHomeFlags"),
        className: "hidden lg:table-cell min-w-[9.5rem]",
        cell: (row) => {
          const id = String(row.id);
          const weight = row.sortWeight ?? 0;
          const weightOn = weight !== 0;
          const rowBusy = busy || menuBusyId === id;
          return (
            <div className="flex flex-wrap gap-1">
              <FlagTogglePill
                active={!!row.isOfficial}
                tone="official"
                disabled={rowBusy}
                onToggle={() =>
                  flagMut.mutate({ id, kind: "official", value: !row.isOfficial })
                }
              >
                {t("official")}
              </FlagTogglePill>
              <FlagTogglePill
                active={!!row.isFeatured}
                tone="featured"
                disabled={rowBusy}
                onToggle={() =>
                  flagMut.mutate({ id, kind: "featured", value: !row.isFeatured })
                }
              >
                {t("featuredFlag")}
              </FlagTogglePill>
              <FlagTogglePill
                active={weightOn}
                tone="weight"
                disabled={rowBusy}
                onToggle={() => {
                  if (weightOn) {
                    if (weight > 0) lastWeightRef.current[id] = weight;
                    flagMut.mutate({ id, kind: "weight", value: 0 });
                  } else {
                    flagMut.mutate({
                      id,
                      kind: "weight",
                      value: lastWeightRef.current[id] ?? 1,
                    });
                  }
                }}
              >
                {weightOn ? `${t("weightLabel")} ${weight}` : t("weightLabel")}
              </FlagTogglePill>
            </div>
          );
        },
      },
      {
        key: "status",
        header: (
          <span className="inline-flex items-center justify-center gap-1">
            {t("status")}
            <span className="inline-flex flex-col leading-none opacity-45" aria-hidden="true">
              <span className="text-[7px]">▲</span>
              <span className="-mt-px text-[7px]">▼</span>
            </span>
          </span>
        ),
        className: "content-status-col content-metric-col text-center",
        cell: (row) => (
          <span className={dramaStatusPillClass(row.status)}>
            {statusLabel(t, row.status)}
          </span>
        ),
      },
      {
        key: "online",
        header: t("colOnline"),
        className: "w-14 min-w-14 max-w-14",
        cell: (row) => {
          const live = row.status === "LIVE";
          const canToggleLifecycle =
            row.status === "LIVE" || row.status === "OFFLINE" || row.status === "REJECTED";
          const id = String(row.id);
          return (
            <Switch
              size="sm"
              checked={live}
              disabled={!canToggleLifecycle}
              title={live ? t("rowOffline") : t("rowOnline")}
              aria-label={live ? t("rowOffline") : t("rowOnline")}
              onCheckedChange={(next) => {
                // Avoid disable-during-pending (steals focus); ignore duplicate clicks.
                if (lifecycleMut.isPending) return;
                if (next) {
                  lifecycleMut.mutate({ action: "online", ids: [id] });
                } else {
                  lifecycleMut.mutate({ action: "offline", ids: [id] });
                }
              }}
            />
          );
        },
      },
      {
        key: "actions",
        header: t("colActions"),
        className: "whitespace-nowrap",
        cell: (row) => {
          const pending = row.status === "PENDING_REVIEW";
          const rowBusy = busy || menuBusyId === String(row.id);
          return (
            <div className="flex items-center gap-0.5">
              <Button
                size="sm"
                variant="ghost"
                disabled={rowBusy}
                title={t("edit")}
                aria-label={t("edit")}
                className="h-8 shrink-0 px-2 hover:translate-y-0 hover:shadow-none"
                onClick={() => openModal("detail", String(row.id))}
              >
                {t("edit")}
              </Button>
              <RowMoreMenu
                row={row}
                busy={rowBusy}
                canDelete={isSuperAdmin}
                onDelete={() => setRowDelete(row)}
              />
              {pending ? (
                <>
                  <Button
                    size="sm"
                    variant="success"
                    disabled={rowBusy}
                    title={t("approveReview")}
                    aria-label={t("approveReview")}
                    className={rowActionClass}
                    onClick={() => {
                      setMenuBusyId(String(row.id));
                      reviewMut.mutate({ id: String(row.id), action: "approve" });
                    }}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rowBusy}
                    title={t("reject")}
                    aria-label={t("reject")}
                    className={`${rowActionClass} text-danger hover:bg-danger-soft hover:text-danger`}
                    onClick={() => {
                      setRejectReason("");
                      setRejectRow(row);
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : null}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      selected,
      rows,
      pageAllSelected,
      pageSomeSelected,
      busy,
      menuBusyId,
      metricMut,
      flagMut,
      lifecycleMut.isPending,
      lifecycleMut.variables,
      isSuperAdmin,
      filters.status,
      filters.sort,
      view,
      page,
      pageSize,
    ],
  );

  const title =
    view === "pending"
      ? t("contentPending")
      : view === "latest"
        ? t("contentLatest")
        : t("content");

  function applyMonetization() {
    if (!isSuperAdmin || !selectedCount) return;
    batchMut.mutate({
      ids: selectedIds,
      freeEpisodeCount: batch.freeEpisodeCount,
      priceCredits: batch.priceCredits,
      buyoutCredits: batch.buyoutCredits > 0 ? batch.buyoutCredits : null,
      ...(batch.lockMode ? { lockMode: batch.lockMode } : {}),
    });
  }

  function applyFeatured(value: boolean) {
    if (!isSuperAdmin || !selectedCount) return;
    batchMut.mutate({ ids: selectedIds, isFeatured: value });
  }

  function applyWeight() {
    if (!isSuperAdmin || !selectedCount) return;
    batchMut.mutate({ ids: selectedIds, sortWeight: batch.sortWeight });
  }

  return (
    <AdminShell title={title}>
      {error || dramasQ.error || categoriesQ.error || creatorsQ.error ? (
        <p className="mb-3 shrink-0 text-body-sm text-danger">
          {error ||
            (dramasQ.error as Error)?.message ||
            (categoriesQ.error as Error)?.message ||
            (creatorsQ.error as Error)?.message}
        </p>
      ) : notice ? (
        <p className="mb-3 shrink-0 text-body-sm text-success">{notice}</p>
      ) : null}

      <ContentSearchBar
        value={filters}
        onChange={applyFilters}
        categories={categoriesQ.data ?? []}
        creators={creatorsQ.data ?? []}
        statuses={statuses}
        showAdd={view !== "pending"}
        onAdd={() => router.push("/content/add")}
        totalDramas={dramaCountsQ.data?.total ?? null}
        liveDramas={dramaCountsQ.data?.live ?? null}
      />

      <DataTable
        className={`content-table${selectedCount > 0 && total <= 0 ? " mb-36" : ""}`}
        columns={columns}
        rows={rows}
        loading={dramasQ.isFetching && !dramasQ.data}
        emptyTitle={t("empty")}
      />

      {total > 0 ? (
        <div
          className={`mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/45 px-3 py-2 text-caption text-ink-muted${selectedCount > 0 ? " mb-36" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {`${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total}`}
            </span>
            <Select
              className="h-8 w-28 text-caption"
              value={String(pageSize)}
              onChange={(e) => {
                const next = Number(e.target.value);
                setPageSize(next);
                setPage(1);
                syncUrl({ page: 1, pageSize: next });
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / {t("page")}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1 || dramasQ.isFetching}
              onClick={() => goToPage(page - 1)}
            >
              {t("previousPage")}
            </Button>
            <div className="hidden items-center gap-1 sm:flex">
              {paginationItems(page, totalPages).map((item, index) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="grid h-9 w-7 place-items-center text-ink-subtle">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    aria-current={item === page ? "page" : undefined}
                    disabled={dramasQ.isFetching}
                    onClick={() => goToPage(item)}
                    className={[
                      "grid h-9 min-w-9 place-items-center rounded-xl px-2 font-medium transition",
                      item === page
                        ? "bg-brand text-white shadow-brand"
                        : "border border-white/70 bg-white/65 text-ink-muted hover:-translate-y-0.5 hover:bg-white hover:text-ink hover:shadow-sm",
                    ].join(" ")}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages || dramasQ.isFetching}
              onClick={() => goToPage(page + 1)}
            >
              {t("nextPage")}
            </Button>
            {totalPages > 1 ? (
              <div className="ml-2 hidden items-center gap-1 lg:flex">
                <Input
                  type="number"
                  min={1}
                  max={totalPages}
                  className="h-9 w-16 px-2 text-center text-caption"
                  value={jumpPage}
                  placeholder={String(page)}
                  onChange={(event) => setJumpPage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && jumpPage) {
                      goToPage(Number(jumpPage));
                      setJumpPage("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!jumpPage || dramasQ.isFetching}
                  onClick={() => {
                    goToPage(Number(jumpPage));
                    setJumpPage("");
                  }}
                >
                  {t("goToPage")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
          <div className="pointer-events-auto w-full max-w-5xl rounded-2xl border border-white/70 bg-white/92 p-3 shadow-lg backdrop-blur-xl">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-body-sm">
                <Badge tone="info">{t("selectedCount", { n: selectedCount })}</Badge>
                <span className="text-caption text-ink-muted">{t("selectionCrossPageHint")}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
                {t("clearSelection")}
              </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-white/60 bg-white/50 p-2.5">
                <p className="mb-2 text-caption font-semibold text-ink-muted">{t("batchBarLifecycle")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setLifecycleConfirm("offline")}
                  >
                    {t("batchOffline")}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => setLifecycleConfirm("online")}>
                    {t("batchOnline")}
                  </Button>
                  {isSuperAdmin ? (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => setLifecycleConfirm("delete")}
                    >
                      {t("batchDelete")}
                    </Button>
                  ) : (
                    <span className="text-caption text-ink-subtle">{t("dangerOpsSuperOnly")}</span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/60 bg-white/50 p-2.5">
                <p className="mb-2 text-caption font-semibold text-ink-muted">{t("batchBarHomeFlags")}</p>
                {isSuperAdmin ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => applyFeatured(true)}
                    >
                      {t("batchFeaturedOn")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => applyFeatured(false)}
                    >
                      {t("batchFeaturedOff")}
                    </Button>
                    <label className="text-caption text-ink-muted">
                      {t("batchWeightValue")}
                      <Input
                        type="number"
                        className="mt-1 w-24"
                        value={batch.sortWeight}
                        onChange={(e) =>
                          setBatch((value) => ({ ...value, sortWeight: Number(e.target.value) }))
                        }
                      />
                    </label>
                    <Button size="sm" disabled={busy} onClick={applyWeight}>
                      {t("batchSetWeight")}
                    </Button>
                  </div>
                ) : (
                  <span className="text-caption text-ink-subtle">{t("dangerOpsSuperOnly")}</span>
                )}
              </div>

              <div className="rounded-xl border border-white/60 bg-white/50 p-2.5">
                <p className="mb-2 text-caption font-semibold text-ink-muted">
                  {t("batchBarMonetization")}
                </p>
                {isSuperAdmin ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-caption text-ink-muted">
                      {t("lockMode")}
                      <Select
                        className="mt-1 w-40"
                        value={batch.lockMode}
                        onChange={(e) =>
                          setBatch((value) => ({
                            ...value,
                            lockMode: e.target.value as typeof batch.lockMode,
                          }))
                        }
                      >
                        <option value="">{t("lockModeBatchKeep")}</option>
                        <option value="INHERIT">{t("lockModeInherit")}</option>
                        <option value="FREE_FIRST_N">{t("lockModeFreeFirstN")}</option>
                        <option value="VIP_ALL">{t("lockModeVipAll")}</option>
                        <option value="ALL_FREE">{t("lockModeAllFree")}</option>
                      </Select>
                    </label>
                    {(
                      [
                        ["freeEpisodeCount", t("freeEpisodes")],
                        ["priceCredits", t("priceCreditsPerEpisode")],
                        ["buyoutCredits", t("buyoutCreditsLabel")],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="text-caption text-ink-muted">
                        {label}
                        <Input
                          type="number"
                          className="mt-1 w-24"
                          value={batch[key]}
                          onChange={(e) =>
                            setBatch((value) => ({ ...value, [key]: Number(e.target.value) }))
                          }
                        />
                      </label>
                    ))}
                    <Button size="sm" disabled={busy} onClick={applyMonetization}>
                      {t("batchApply")}
                    </Button>
                  </div>
                ) : (
                  <span className="text-caption text-ink-subtle">{t("dangerOpsSuperOnly")}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ContentDetailModal
        open={modal === "detail"}
        dramaId={detailId}
        initialTab={detailTab ?? undefined}
        onClose={closeModal}
      />
      <CategoriesModal open={modal === "categories"} onClose={closeModal} />
      <ConfirmModal
        open={lifecycleConfirm === "offline"}
        onClose={() => setLifecycleConfirm(null)}
        onConfirm={() => lifecycleMut.mutate({ action: "offline", ids: selectedIds })}
        message={t("confirmBatchOffline", { n: selectedCount })}
        busy={lifecycleMut.isPending}
      />
      <ConfirmModal
        open={lifecycleConfirm === "online"}
        onClose={() => setLifecycleConfirm(null)}
        onConfirm={() => lifecycleMut.mutate({ action: "online", ids: selectedIds })}
        message={t("confirmBatchOnline", { n: selectedCount })}
        confirmVariant="primary"
        busy={lifecycleMut.isPending}
      />
      <ConfirmModal
        open={lifecycleConfirm === "delete"}
        onClose={() => setLifecycleConfirm(null)}
        onConfirm={() => lifecycleMut.mutate({ action: "delete", ids: selectedIds })}
        message={t("confirmBatchDeleteHard", { n: selectedCount })}
        busy={lifecycleMut.isPending}
      />
      <ConfirmModal
        open={!!rowDelete}
        onClose={() => setRowDelete(null)}
        onConfirm={() => {
          if (!rowDelete) return;
          setMenuBusyId(String(rowDelete.id));
          lifecycleMut.mutate({ action: "delete", ids: [String(rowDelete.id)] });
        }}
        message={t("confirmRowDelete", {
          title: rowDelete?.titleZh || rowDelete?.titleEn || String(rowDelete?.id ?? ""),
        })}
        busy={lifecycleMut.isPending}
      />
      <GlassModal
        open={!!deleteResult}
        onClose={() => setDeleteResult(null)}
        title={t("deleteLifecycleTitle")}
        size="sm"
      >
        <p className="whitespace-pre-wrap text-body-sm text-ink-muted">{deleteResult}</p>
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setDeleteResult(null)}>
            {t("confirm")}
          </Button>
        </div>
      </GlassModal>
      <GlassModal
        open={!!rejectRow}
        onClose={() => {
          if (reviewMut.isPending) return;
          setRejectRow(null);
          setRejectReason("");
        }}
        title={t("reject")}
        size="sm"
      >
        <p className="mb-3 text-body-sm text-ink-muted">
          {t("confirmRejectDrama", {
            title: rejectRow?.titleZh || rejectRow?.titleEn || String(rejectRow?.id ?? ""),
          })}
        </p>
        <Input
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder={t("actionReasonPlaceholder")}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={reviewMut.isPending}
            onClick={() => {
              setRejectRow(null);
              setRejectReason("");
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={reviewMut.isPending || !rejectReason.trim()}
            onClick={() => {
              if (!rejectRow) return;
              setMenuBusyId(String(rejectRow.id));
              reviewMut.mutate({
                id: String(rejectRow.id),
                action: "reject",
                reason: rejectReason.trim(),
              });
            }}
          >
            {t("reject")}
          </Button>
        </div>
      </GlassModal>
    </AdminShell>
  );
}

export default function AdminContentPage() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <AdminShell title={t("content")}>
          <p className="text-ink-muted">{t("loading")}</p>
        </AdminShell>
      }
    >
      <AdminContentInner />
    </Suspense>
  );
}
