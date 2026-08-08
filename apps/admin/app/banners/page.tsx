"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, ImagePlus, LoaderCircle } from "lucide-react";
import {
  adminCreateBanner,
  adminDeleteBanner,
  adminGetDrama,
  adminListBanners,
  adminListDramas,
  adminUpdateBanner,
  adminUploadImage,
  asRows,
} from "@velvet/api-client";
import { Badge, Button, DataTable, Input, fmtDate, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { clampFocus, HERO_CROP, heroObjectPosition } from "@/lib/hero-crop";
import { useI18n } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media-url";

type Banner = {
  id: string | number;
  titleEn?: string;
  titleZh?: string;
  imageUrl?: string;
  linkUrl?: string;
  dramaId?: string | number;
  focusX?: number;
  focusY?: number;
  startAt: string;
  endAt: string;
  sortOrder?: number;
  isActive?: boolean;
};

type DramaLite = {
  id: string | number;
  titleZh?: string;
  titleEn?: string;
  slug?: string;
  status?: string;
  coverUrl?: string | null;
};

type BannerPhase = "live" | "scheduled" | "expired" | "inactive";

type BannerForm = {
  titleZh: string;
  imageUrl: string;
  dramaId: string;
  dramaTitle: string;
  dramaSlug: string;
  dramaCoverUrl: string;
  focusX: number;
  focusY: number;
  startAt: string;
  endAt: string;
  endPermanent: boolean;
  sortOrder: number;
  isActive: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalDatetimeValue(value: string | Date) {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isValidImageUrl(url: string) {
  const v = url.trim();
  return /^https?:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//"));
}

function bannerPhase(row: Banner, now = Date.now()): BannerPhase {
  if (!row.isActive) return "inactive";
  const start = new Date(row.startAt).getTime();
  const end = new Date(row.endAt).getTime();
  if (Number.isFinite(start) && now < start) return "scheduled";
  if (Number.isFinite(end) && now > end) return "expired";
  return "live";
}

function dramaLabel(d: DramaLite | null | undefined, fallbackId?: string) {
  if (!d) return fallbackId || "";
  return d.titleZh || d.titleEn || d.slug || String(d.id);
}

/** Sentinel far-future end — DB endAt stays non-null */
const PERMANENT_END_ISO = "9999-12-31T23:59:59.000Z";

function isPermanentEnd(value: string | Date | null | undefined) {
  if (value == null || value === "") return false;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isFinite(d.getTime()) && d.getUTCFullYear() >= 9000;
}

const makeEmpty = (sortOrder = 0): BannerForm => ({
  titleZh: "",
  imageUrl: "",
  dramaId: "",
  dramaTitle: "",
  dramaSlug: "",
  dramaCoverUrl: "",
  focusX: HERO_CROP.defaultFocusX,
  focusY: HERO_CROP.defaultFocusY,
  startAt: toLocalDatetimeValue(new Date()),
  endAt: toLocalDatetimeValue(new Date(Date.now() + 7 * 86400000)),
  endPermanent: false,
  sortOrder,
  isActive: true,
});

function bannerFromRow(row: Banner): BannerForm {
  const permanent = isPermanentEnd(row.endAt);
  return {
    titleZh: row.titleZh || row.titleEn || "",
    imageUrl: row.imageUrl || "",
    dramaId: row.dramaId ? String(row.dramaId) : "",
    dramaTitle: "",
    dramaSlug: "",
    dramaCoverUrl: "",
    focusX: clampFocus(row.focusX, HERO_CROP.defaultFocusX),
    focusY: clampFocus(row.focusY, HERO_CROP.defaultFocusY),
    startAt: toLocalDatetimeValue(row.startAt),
    endAt: permanent
      ? toLocalDatetimeValue(new Date(Date.now() + 7 * 86400000))
      : toLocalDatetimeValue(row.endAt),
    endPermanent: permanent,
    sortOrder: row.sortOrder ?? 0,
    isActive: !!row.isActive,
  };
}

export default function AdminBannersPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => makeEmpty());
  const [editId, setEditId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dramaQ, setDramaQ] = useState("");
  const [dramaSearch, setDramaSearch] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const cropDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    focusX: number;
    focusY: number;
    width: number;
    height: number;
  } | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "banners"],
    queryFn: () => adminListBanners(true) as Promise<Banner[]>,
  });

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  const dramaIds = useMemo(
    () =>
      [...new Set(rows.map((row) => (row.dramaId != null ? String(row.dramaId) : "")).filter(Boolean))],
    [rows],
  );

  const dramaMapQ = useQuery({
    queryKey: ["admin", "banners", "drama-map", dramaIds.join(",")],
    enabled: dramaIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const entries = await Promise.all(
        dramaIds.map(async (id) => {
          try {
            const drama = (await adminGetDrama(id)) as DramaLite;
            return [id, drama] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, DramaLite | null>;
    },
  });

  const dramaSearchQ = useQuery({
    queryKey: ["admin", "banners", "drama-search", dramaSearch],
    enabled: modalOpen && dramaSearch.trim().length > 0,
    queryFn: async () =>
      asRows<DramaLite>(
        await adminListDramas({
          status: "LIVE",
          q: dramaSearch.trim(),
          page: 1,
          pageSize: 20,
        }),
      ),
  });

  // Fuzzy search: debounce input before querying LIVE dramas
  useEffect(() => {
    if (!modalOpen) return;
    const trimmed = dramaQ.trim();
    if (trimmed === dramaSearch) return;
    const timer = window.setTimeout(() => setDramaSearch(trimmed), 350);
    return () => window.clearTimeout(timer);
  }, [modalOpen, dramaQ, dramaSearch]);

  useEffect(() => {
    if (!modalOpen || !form.dramaId || form.dramaTitle) return;
    let cancelled = false;
    (async () => {
      try {
        const drama = (await adminGetDrama(form.dramaId)) as DramaLite;
        if (!cancelled) {
          setForm((value) =>
            value.dramaId === form.dramaId
              ? {
                  ...value,
                  dramaTitle: dramaLabel(drama, form.dramaId),
                  dramaSlug: drama.slug || "",
                  dramaCoverUrl: drama.coverUrl || value.dramaCoverUrl,
                  imageUrl: value.imageUrl || drama.coverUrl || "",
                  titleZh: value.titleZh || dramaLabel(drama, form.dramaId),
                }
              : value,
          );
        }
      } catch {
        if (!cancelled) {
          setForm((value) =>
            value.dramaId === form.dramaId
              ? { ...value, dramaTitle: t("bannerDramaMissing", { id: form.dramaId }) }
              : value,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, form.dramaId, form.dramaTitle, t]);

  function openCreate() {
    const nextSort =
      rows.reduce((max, row) => Math.max(max, row.sortOrder ?? 0), -1) + 1;
    setEditId(null);
    setForm(makeEmpty(nextSort));
    setDramaQ("");
    setDramaSearch("");
    setError(null);
    setModalOpen(true);
  }

  function openEdit(row: Banner) {
    setEditId(String(row.id));
    setForm(bannerFromRow(row));
    setDramaQ("");
    setDramaSearch("");
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditId(null);
    setForm(makeEmpty());
    setDramaQ("");
    setDramaSearch("");
    setError(null);
  }

  function pickDrama(drama: DramaLite) {
    const id = String(drama.id);
    const title = dramaLabel(drama, id);
    const cover = drama.coverUrl || "";
    setForm((value) => ({
      ...value,
      dramaId: id,
      dramaTitle: title,
      dramaSlug: drama.slug || "",
      dramaCoverUrl: cover,
      titleZh: title,
      imageUrl: cover || value.imageUrl,
    }));
    setDramaQ("");
    setDramaSearch("");
  }

  function clearDrama() {
    setForm((value) => ({
      ...value,
      dramaId: "",
      dramaTitle: "",
      dramaSlug: "",
      dramaCoverUrl: "",
    }));
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const dramaId = form.dramaId.trim();
      if (!dramaId) throw new Error(t("bannerNeedDrama"));
      const titleZh = form.titleZh.trim();
      if (!titleZh) throw new Error(t("onlineNeedTitle"));
      if (!isValidImageUrl(form.imageUrl)) throw new Error(t("imageUrlInvalid"));
      if (!form.startAt) throw new Error(t("bannerEndAfterStart"));
      const startAt = new Date(form.startAt);
      const endAt = form.endPermanent
        ? new Date(PERMANENT_END_ISO)
        : new Date(form.endAt);
      if (
        Number.isNaN(startAt.getTime()) ||
        Number.isNaN(endAt.getTime()) ||
        (!form.endPermanent && (!form.endAt || endAt <= startAt))
      ) {
        throw new Error(t("bannerEndAfterStart"));
      }

      const body = {
        titleZh,
        titleEn: titleZh,
        imageUrl: form.imageUrl.trim(),
        linkUrl: null,
        dramaId,
        focusX: clampFocus(form.focusX, HERO_CROP.defaultFocusX),
        focusY: clampFocus(form.focusY, HERO_CROP.defaultFocusY),
        focusZoom: 100,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        sortOrder: form.sortOrder,
        isActive: form.isActive,
      };
      return editId ? adminUpdateBanner(editId, body) : adminCreateBanner(body);
    },
    onSuccess: async () => {
      closeModal();
      await qc.invalidateQueries({ queryKey: ["admin", "banners"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: adminDeleteBanner,
    onSuccess: async () => {
      setDeleteId(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "banners"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminUpdateBanner(id, { isActive }),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "banners"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const phaseMeta = useMemo(
    () =>
      ({
        live: { label: t("bannerStatusLive"), tone: "success" as const },
        scheduled: { label: t("bannerStatusScheduled"), tone: "info" as const },
        expired: { label: t("bannerStatusExpired"), tone: "warning" as const },
        inactive: { label: t("bannerStatusInactive"), tone: "default" as const },
      }) satisfies Record<
        BannerPhase,
        { label: string; tone: "success" | "info" | "warning" | "default" }
      >,
    [t],
  );

  const dramaMap = dramaMapQ.data ?? {};
  const dramaOwnerBanner = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.dramaId == null) continue;
      map.set(String(row.dramaId), String(row.id));
    }
    return map;
  }, [rows]);

  const columns: Column<Banner>[] = useMemo(
    () => [
      { key: "id", header: t("colId"), cell: (row) => String(row.id) },
      {
        key: "title",
        header: t("colTitle"),
        cell: (row) => (
          <div className="flex items-center gap-3">
            {row.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(row.imageUrl) || row.imageUrl}
                alt=""
                className="h-12 w-20 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg bg-panel text-caption text-ink-muted">
                —
              </div>
            )}
            <div className="min-w-0 truncate font-medium text-ink">
              {row.titleZh || row.titleEn || "—"}
            </div>
          </div>
        ),
      },
      {
        key: "drama",
        header: t("drama"),
        cell: (row) => {
          if (!row.dramaId) {
            return <span className="text-body-sm text-ink-muted">—</span>;
          }
          const id = String(row.dramaId);
          const drama = dramaMap[id];
          const title = dramaLabel(drama, t("bannerDramaMissing", { id }));
          return (
            <Link
              href={`/content/${id}`}
              className="block truncate text-body-sm text-brand hover:underline"
            >
              {title}
            </Link>
          );
        },
      },
      {
        key: "schedule",
        header: t("scheduleLabel"),
        cell: (row) => {
          const dateLocale = locale === "en" ? "en-US" : "zh-CN";
          const permanent = isPermanentEnd(row.endAt);
          return (
            <div className="text-body-sm tabular-nums text-ink-muted">
              <div>{fmtDate(row.startAt, dateLocale)}</div>
              <div>→ {permanent ? t("bannerEndPermanent") : fmtDate(row.endAt, dateLocale)}</div>
            </div>
          );
        },
      },
      {
        key: "sort",
        header: t("colSort"),
        cell: (row) => String(row.sortOrder ?? 0),
        className: "tabular-nums",
      },
      {
        key: "active",
        header: t("status"),
        cell: (row) => {
          const phase = bannerPhase(row);
          const meta = phaseMeta[phase];
          return <Badge tone={meta.tone}>{meta.label}</Badge>;
        },
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (row) => (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={toggleMut.isPending}
              onClick={() =>
                toggleMut.mutate({ id: String(row.id), isActive: !row.isActive })
              }
            >
              {row.isActive ? t("toggleOff") : t("toggleOn")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
              {t("edit")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={deleteMut.isPending}
              onClick={() => setDeleteId(String(row.id))}
            >
              {t("delete")}
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, deleteMut.isPending, toggleMut.isPending, phaseMeta, dramaMap],
  );

  return (
    <AdminShell title={t("banners")}>
      {(!modalOpen && error) || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {(!modalOpen && error) || (listQ.error as Error)?.message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-body-sm text-ink-muted">{t("heroHintBanners")}</p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-body-sm text-ink-muted">
            {t("totalCount", { n: rows.length })}
          </span>
          <Button size="sm" onClick={openCreate}>
            {t("createBanner")}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={listQ.isFetching && !listQ.data}
        emptyTitle={t("empty")}
      />

      <GlassModal
        open={modalOpen}
        onClose={closeModal}
        title={editId ? t("editBanner") : t("createBanner")}
        size="lg"
      >
        <div className="grid gap-3">
          <div className="space-y-3">
            <p className="text-caption text-ink-muted">{t("bannerPickDrama")}</p>
            {form.dramaId ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-panel/40 px-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-14 w-10 overflow-hidden rounded bg-panel">
                    {form.imageUrl && isValidImageUrl(form.imageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(form.imageUrl.trim()) || form.imageUrl.trim()}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-ink-subtle">
                        <ImageIcon className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 text-body-sm">
                    {t("bannerSelectedDrama", {
                      title: form.dramaTitle || t("bannerDramaMissing", { id: form.dramaId }),
                    })}
                    <div className="text-caption text-ink-muted">
                      {form.dramaSlug || `ID ${form.dramaId}`}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={clearDrama}>
                  {t("bannerClearDrama")}
                </Button>
              </div>
            ) : null}

            <Input
              className="min-w-[220px] flex-1"
              value={dramaQ}
              onChange={(e) => setDramaQ(e.target.value)}
              placeholder={t("hottestSearchPlaceholder")}
            />

            {dramaSearch.trim() ? (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-line p-2">
                {dramaSearchQ.isFetching ? (
                  <p className="px-2 py-3 text-body-sm text-ink-muted">{t("loading")}</p>
                ) : (dramaSearchQ.data ?? []).length === 0 ? (
                  <p className="px-2 py-3 text-body-sm text-ink-muted">
                    {t("hottestSearchNoResult")}
                  </p>
                ) : (
                  (dramaSearchQ.data ?? []).map((drama) => {
                    const id = String(drama.id);
                    const selected = form.dramaId === id;
                    const ownerId = dramaOwnerBanner.get(id);
                    const linkedElsewhere = ownerId != null && ownerId !== editId;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={linkedElsewhere && !selected}
                        className={`flex w-full items-start justify-between gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                          selected ? "bg-white/60" : ""
                        }`}
                        onClick={() => pickDrama(drama)}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-panel">
                            {drama.coverUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={drama.coverUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="grid h-full place-items-center text-ink-subtle">
                                <ImageIcon className="h-3 w-3" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-body-sm font-medium text-ink">
                              {dramaLabel(drama, id)}
                            </div>
                            <div className="truncate text-caption text-ink-muted">
                              {drama.slug || id}
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 text-caption text-ink-muted">
                          {selected || linkedElsewhere ? t("alreadyAdded") : t("add")}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-caption text-ink-muted md:col-span-2">
              {t("colTitle")}
              <Input
                className="mt-1"
                value={form.titleZh}
                onChange={(e) => setForm((value) => ({ ...value, titleZh: e.target.value }))}
              />
            </label>
            <div className="space-y-2 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-ink-muted">{t("bannerImageHint")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    disabled={imageUploading || saveMut.isPending}
                    onClick={() => imageFileRef.current?.click()}
                  >
                    {imageUploading ? (
                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {t("thumbUpload")}
                  </Button>
                  {form.dramaCoverUrl && form.imageUrl !== form.dramaCoverUrl ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      disabled={imageUploading}
                      onClick={() =>
                        setForm((value) => ({ ...value, imageUrl: value.dramaCoverUrl }))
                      }
                    >
                      {t("bannerUseDramaCover")}
                    </Button>
                  ) : null}
                </div>
              </div>
              <input
                ref={imageFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void (async () => {
                    setImageUploading(true);
                    setError(null);
                    try {
                      const saved = await adminUploadImage(file, {
                        kind: "image",
                        filename: file.name,
                      });
                      if (!saved?.url) throw new Error(t("coverUploadNoUrl"));
                      setForm((value) => ({ ...value, imageUrl: saved.url }));
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setImageUploading(false);
                    }
                  })();
                }}
              />
              <label className="text-caption text-ink-muted">
                {t("imageUrlLabel")}
                <Input
                  className="mt-1"
                  value={form.imageUrl}
                  onChange={(e) => setForm((value) => ({ ...value, imageUrl: e.target.value }))}
                />
              </label>
            </div>
            {form.imageUrl.trim() && isValidImageUrl(form.imageUrl) ? (
              <div className="space-y-3 md:col-span-2">
                <p className="text-caption text-ink-muted">{t("bannerCropPreviewHint")}</p>
                <div className="overflow-hidden rounded-2xl border border-line bg-black">
                  <div
                    className={`relative mx-auto w-full max-w-xl cursor-grab overflow-hidden active:cursor-grabbing ${HERO_CROP.aspectClass} ${HERO_CROP.softMaskClass}`}
                    onPointerDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      cropDrag.current = {
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                        focusX: form.focusX,
                        focusY: form.focusY,
                        width: rect.width || 1,
                        height: rect.height || 1,
                      };
                    }}
                    onPointerMove={(e) => {
                      const drag = cropDrag.current;
                      if (!drag || drag.pointerId !== e.pointerId) return;
                      const dx = ((e.clientX - drag.startX) / drag.width) * 100;
                      const dy = ((e.clientY - drag.startY) / drag.height) * 100;
                      setForm((value) => ({
                        ...value,
                        focusX: clampFocus(drag.focusX - dx, HERO_CROP.defaultFocusX),
                        focusY: clampFocus(drag.focusY - dy, HERO_CROP.defaultFocusY),
                      }));
                    }}
                    onPointerUp={(e) => {
                      if (cropDrag.current?.pointerId === e.pointerId) cropDrag.current = null;
                    }}
                    onPointerCancel={(e) => {
                      if (cropDrag.current?.pointerId === e.pointerId) cropDrag.current = null;
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl(form.imageUrl.trim()) || form.imageUrl.trim()}
                      alt=""
                      className="pointer-events-none h-full w-full object-cover"
                      style={{ objectPosition: heroObjectPosition(form.focusX, form.focusY) }}
                      draggable={false}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-caption text-ink-muted">
                    {t("bannerFocusX", { n: form.focusX })}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={form.focusX}
                      className="mt-2 w-full accent-[var(--brand,#c81038)]"
                      onChange={(e) =>
                        setForm((value) => ({
                          ...value,
                          focusX: clampFocus(e.target.value, HERO_CROP.defaultFocusX),
                        }))
                      }
                    />
                  </label>
                  <label className="text-caption text-ink-muted">
                    {t("bannerFocusY", { n: form.focusY })}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={form.focusY}
                      className="mt-2 w-full accent-[var(--brand,#c81038)]"
                      onChange={(e) =>
                        setForm((value) => ({
                          ...value,
                          focusY: clampFocus(e.target.value, HERO_CROP.defaultFocusY),
                        }))
                      }
                    />
                  </label>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() =>
                    setForm((value) => ({
                      ...value,
                      focusX: HERO_CROP.defaultFocusX,
                      focusY: HERO_CROP.defaultFocusY,
                    }))
                  }
                >
                  {t("bannerFocusReset")}
                </Button>
              </div>
            ) : null}
            <label className="text-caption text-ink-muted">
              {t("colSort")}
              <Input
                type="number"
                className="mt-1"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm((value) => ({ ...value, sortOrder: Number(e.target.value) }))
                }
              />
            </label>
            <label className="flex items-center gap-2 self-end text-caption text-ink-muted">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((value) => ({ ...value, isActive: e.target.checked }))}
              />
              {t("enable")}
            </label>
            <label className="text-caption text-ink-muted">
              {t("startAtLabel")}
              <Input
                type="datetime-local"
                className="mt-1"
                value={form.startAt}
                onChange={(e) => setForm((value) => ({ ...value, startAt: e.target.value }))}
              />
            </label>
            <div className="space-y-2">
              <label className="text-caption text-ink-muted">
                {t("endAtLabel")}
                <Input
                  type="datetime-local"
                  className="mt-1"
                  disabled={form.endPermanent}
                  value={form.endPermanent ? "" : form.endAt}
                  onChange={(e) => setForm((value) => ({ ...value, endAt: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-caption text-ink-muted">
                <input
                  type="checkbox"
                  checked={form.endPermanent}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setForm((value) => ({
                      ...value,
                      endPermanent: checked,
                      endAt:
                        checked && !value.endAt
                          ? toLocalDatetimeValue(new Date(Date.now() + 7 * 86400000))
                          : value.endAt,
                    }));
                  }}
                />
                {t("bannerEndPermanent")}
              </label>
            </div>
          </div>
        </div>
        {error ? <p className="mt-3 text-body-sm text-danger">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={saveMut.isPending} onClick={closeModal}>
            {t("cancel")}
          </Button>
          <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {editId ? t("update") : t("create")}
          </Button>
        </div>
      </GlassModal>

      <ConfirmModal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        busy={deleteMut.isPending}
        message={t("confirmDeleteBanner")}
        onConfirm={() => {
          if (!deleteId) return;
          deleteMut.mutate(deleteId);
        }}
      />
    </AdminShell>
  );
}
