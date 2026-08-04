"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateBanner,
  adminDeleteBanner,
  adminGetDrama,
  adminListBanners,
  adminListDramas,
  adminUpdateBanner,
  asRows,
} from "@velvet/api-client";
import { Badge, Button, DataTable, Input, fmtDate, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { useI18n } from "@/lib/i18n";

type Banner = {
  id: string | number;
  titleVi?: string;
  titleZh?: string;
  imageUrl?: string;
  linkUrl?: string;
  dramaId?: string | number;
  startAt: string;
  endAt: string;
  sortOrder?: number;
  isActive?: boolean;
};

type DramaLite = {
  id: string | number;
  titleZh?: string;
  titleVi?: string;
  slug?: string;
  status?: string;
};

type JumpMode = "link" | "drama" | "none";
type BannerPhase = "live" | "scheduled" | "expired" | "inactive";

type BannerForm = {
  titleZh: string;
  imageUrl: string;
  jumpMode: JumpMode;
  linkUrl: string;
  dramaId: string;
  dramaTitle: string;
  startAt: string;
  endAt: string;
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
  return /^https?:\/\//i.test(v) || v.startsWith("/");
}

function jumpModeFromRow(row: Banner): JumpMode {
  if (row.linkUrl) return "link";
  if (row.dramaId) return "drama";
  return "none";
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
  return d.titleZh || d.titleVi || d.slug || String(d.id);
}

function truncateUrl(url: string, max = 36) {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}

const makeEmpty = (): BannerForm => ({
  titleZh: "",
  imageUrl: "",
  jumpMode: "none",
  linkUrl: "",
  dramaId: "",
  dramaTitle: "",
  startAt: toLocalDatetimeValue(new Date()),
  endAt: toLocalDatetimeValue(new Date(Date.now() + 7 * 86400000)),
  sortOrder: 0,
  isActive: true,
});

function bannerFromRow(row: Banner): BannerForm {
  return {
    titleZh: row.titleZh || row.titleVi || "",
    imageUrl: row.imageUrl || "",
    jumpMode: jumpModeFromRow(row),
    linkUrl: row.linkUrl || "",
    dramaId: row.dramaId ? String(row.dramaId) : "",
    dramaTitle: "",
    startAt: toLocalDatetimeValue(row.startAt),
    endAt: toLocalDatetimeValue(row.endAt),
    sortOrder: row.sortOrder ?? 0,
    isActive: !!row.isActive,
  };
}

export default function AdminBannersPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState(makeEmpty);
  const [editId, setEditId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dramaQ, setDramaQ] = useState("");
  const [dramaSearch, setDramaSearch] = useState("");

  const listQ = useQuery({
    queryKey: ["admin", "banners"],
    queryFn: () => adminListBanners(true) as Promise<Banner[]>,
  });

  const rows = listQ.data ?? [];

  const dramaIds = useMemo(
    () =>
      [
        ...new Set(
          rows
            .map((row) => (row.dramaId != null && !row.linkUrl ? String(row.dramaId) : ""))
            .filter(Boolean),
        ),
      ],
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
    enabled: modalOpen && form.jumpMode === "drama" && dramaSearch.trim().length > 0,
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

  useEffect(() => {
    if (!modalOpen || form.jumpMode !== "drama" || !form.dramaId || form.dramaTitle) return;
    let cancelled = false;
    (async () => {
      try {
        const drama = (await adminGetDrama(form.dramaId)) as DramaLite;
        if (!cancelled) {
          setForm((value) =>
            value.dramaId === form.dramaId
              ? { ...value, dramaTitle: dramaLabel(drama, form.dramaId) }
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
  }, [modalOpen, form.jumpMode, form.dramaId, form.dramaTitle, t]);

  function openCreate() {
    setEditId(null);
    setForm(makeEmpty());
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
    setForm((value) => ({
      ...value,
      jumpMode: "drama",
      dramaId: id,
      dramaTitle: dramaLabel(drama, id),
      linkUrl: "",
    }));
    setDramaQ("");
    setDramaSearch("");
  }

  function clearDrama() {
    setForm((value) => ({ ...value, dramaId: "", dramaTitle: "" }));
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const titleZh = form.titleZh.trim();
      if (!titleZh) throw new Error(t("onlineNeedTitle"));
      if (!isValidImageUrl(form.imageUrl)) throw new Error(t("imageUrlInvalid"));
      if (!form.startAt || !form.endAt) throw new Error(t("bannerEndAfterStart"));
      const startAt = new Date(form.startAt);
      const endAt = new Date(form.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        throw new Error(t("bannerEndAfterStart"));
      }

      let linkUrl: string | null = null;
      let dramaId: string | null = null;
      if (form.jumpMode === "link") {
        linkUrl = form.linkUrl.trim() || null;
        if (!linkUrl) throw new Error(t("bannerJumpNeedValue"));
      } else if (form.jumpMode === "drama") {
        dramaId = form.dramaId.trim() || null;
        if (!dramaId) throw new Error(t("bannerJumpNeedValue"));
      }

      const body = {
        titleZh,
        titleVi: titleZh,
        imageUrl: form.imageUrl.trim(),
        linkUrl,
        dramaId,
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
                src={row.imageUrl}
                alt=""
                className="h-12 w-20 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg bg-panel text-caption text-ink-muted">
                —
              </div>
            )}
            <div className="min-w-0 truncate font-medium text-ink">
              {row.titleZh || row.titleVi || "—"}
            </div>
          </div>
        ),
      },
      {
        key: "jump",
        header: t("bannerJumpCol"),
        cell: (row) => {
          if (row.linkUrl) {
            return (
              <div className="min-w-0">
                <div className="text-caption text-ink-muted">{t("bannerJumpLink")}</div>
                <a
                  href={row.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-body-sm text-brand hover:underline"
                  title={row.linkUrl}
                >
                  {truncateUrl(row.linkUrl)}
                </a>
              </div>
            );
          }
          if (row.dramaId) {
            const id = String(row.dramaId);
            const drama = dramaMap[id];
            const title = dramaLabel(drama, t("bannerDramaMissing", { id }));
            return (
              <div className="min-w-0">
                <div className="text-caption text-ink-muted">{t("bannerJumpDrama")}</div>
                <Link
                  href={`/content/${id}`}
                  className="block truncate text-body-sm text-brand hover:underline"
                >
                  {title}
                </Link>
              </div>
            );
          }
          return (
            <span className="text-body-sm text-ink-muted">{t("bannerJumpNone")}</span>
          );
        },
      },
      {
        key: "schedule",
        header: t("scheduleLabel"),
        cell: (row) => {
          const dateLocale = locale === "en" ? "en-US" : "zh-CN";
          return (
            <div className="text-body-sm tabular-nums text-ink-muted">
              <div>{fmtDate(row.startAt, dateLocale)}</div>
              <div>→ {fmtDate(row.endAt, dateLocale)}</div>
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

  const jumpModes: { id: JumpMode; label: string }[] = [
    { id: "link", label: t("bannerJumpLink") },
    { id: "drama", label: t("bannerJumpDrama") },
    { id: "none", label: t("bannerJumpNone") },
  ];

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
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-caption text-ink-muted md:col-span-2">
            {t("colTitle")}
            <Input
              className="mt-1"
              value={form.titleZh}
              onChange={(e) => setForm((value) => ({ ...value, titleZh: e.target.value }))}
            />
          </label>
          <label className="text-caption text-ink-muted md:col-span-2">
            {t("imageUrlLabel")}
            <Input
              className="mt-1"
              value={form.imageUrl}
              onChange={(e) => setForm((value) => ({ ...value, imageUrl: e.target.value }))}
            />
            {form.imageUrl.trim() && isValidImageUrl(form.imageUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.imageUrl.trim()}
                alt=""
                className="mt-2 h-28 w-full max-w-sm rounded-xl object-cover"
              />
            ) : null}
          </label>

          <fieldset className="md:col-span-2">
            <legend className="text-caption text-ink-muted">{t("bannerJumpLabel")}</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {jumpModes.map((mode) => (
                <label
                  key={mode.id}
                  className="flex cursor-pointer items-center gap-2 text-body-sm text-ink"
                >
                  <input
                    type="radio"
                    name="banner-jump"
                    checked={form.jumpMode === mode.id}
                    onChange={() => {
                      setForm((value) => ({
                        ...value,
                        jumpMode: mode.id,
                        linkUrl: mode.id === "link" ? value.linkUrl : "",
                        dramaId: mode.id === "drama" ? value.dramaId : "",
                        dramaTitle: mode.id === "drama" ? value.dramaTitle : "",
                      }));
                      setDramaQ("");
                      setDramaSearch("");
                    }}
                  />
                  {mode.label}
                </label>
              ))}
            </div>
          </fieldset>

          {form.jumpMode === "link" ? (
            <label className="text-caption text-ink-muted md:col-span-2">
              {t("linkUrlLabel")}
              <Input
                className="mt-1"
                value={form.linkUrl}
                onChange={(e) => setForm((value) => ({ ...value, linkUrl: e.target.value }))}
              />
            </label>
          ) : null}

          {form.jumpMode === "drama" ? (
            <div className="space-y-3 md:col-span-2">
              {form.dramaId ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-panel/40 px-3 py-2">
                  <div className="min-w-0 text-body-sm">
                    {t("bannerSelectedDrama", {
                      title: form.dramaTitle || t("bannerDramaMissing", { id: form.dramaId }),
                    })}
                    <div className="text-caption text-ink-muted">ID {form.dramaId}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={clearDrama}>
                    {t("bannerClearDrama")}
                  </Button>
                </div>
              ) : null}
              <p className="text-caption text-ink-muted">{t("bannerPickDrama")}</p>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setDramaSearch(dramaQ.trim());
                }}
              >
                <Input
                  className="min-w-[220px] flex-1"
                  value={dramaQ}
                  onChange={(e) => setDramaQ(e.target.value)}
                  placeholder={t("hottestSearchPlaceholder")}
                />
                <Button type="submit" variant="secondary" disabled={!dramaQ.trim()}>
                  {t("search")}
                </Button>
              </form>
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
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`flex w-full items-start justify-between gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/50 ${
                            selected ? "bg-white/60" : ""
                          }`}
                          onClick={() => pickDrama(drama)}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-body-sm font-medium text-ink">
                              {dramaLabel(drama, id)}
                            </div>
                            <div className="truncate text-caption text-ink-muted">
                              {drama.slug || id}
                            </div>
                          </div>
                          <span className="shrink-0 text-caption text-ink-muted">
                            {selected ? t("alreadyAdded") : t("add")}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
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
          {(["startAt", "endAt"] as const).map((key) => (
            <label key={key} className="text-caption text-ink-muted">
              {key === "startAt" ? t("startAtLabel") : t("endAtLabel")}
              <Input
                type="datetime-local"
                className="mt-1"
                value={form[key]}
                onChange={(e) => setForm((value) => ({ ...value, [key]: e.target.value }))}
              />
            </label>
          ))}
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
