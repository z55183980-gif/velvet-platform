"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminBatchDramaLifecycle,
  adminBatchDramas,
  adminListCategories,
  adminListDramas,
  asRows,
} from "@velvet/api-client";
import { Button, DataTable, Input, Select, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { CategoriesModal } from "@/components/categories-modal";
import { ContentDetailModal } from "@/components/content-detail-modal";
import {
  ContentSearchBar,
  type ContentSearchFilters,
} from "@/components/content-search-bar";
import { ConfirmModal } from "@/components/glass-modal";
import { useI18n, statusLabel } from "@/lib/i18n";

type Drama = {
  id: string | number;
  titleZh?: string;
  titleEn?: string;
  slug?: string;
  status?: string;
  creator?: { displayName?: string };
  viewCount?: number;
  unlockCount?: number;
  isOfficial?: boolean;
  isFeatured?: boolean;
  sortWeight?: number;
  publishedAt?: string | null;
  _count?: { episodes?: number };
};
type Category = { slug: string; nameZh?: string; nameEn?: string };
type ContentModal = "detail" | "categories";

const statuses = ["ALL", "DRAFT", "PENDING_REVIEW", "LIVE", "OFFLINE", "REJECTED"];
const pageSize = 20;

function buildContentHref(opts: {
  status?: string;
  sort?: string;
  modal?: ContentModal | null;
  id?: string | null;
}) {
  const qs = new URLSearchParams();
  if (opts.status && opts.status !== "ALL") qs.set("status", opts.status);
  if (opts.sort === "latest") qs.set("sort", "latest");
  if (opts.modal) qs.set("modal", opts.modal);
  if (opts.modal === "detail" && opts.id) qs.set("id", opts.id);
  const next = qs.toString();
  return next ? `/content?${next}` : "/content";
}

function AdminContentInner() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get("status") || "ALL";
  const sortFromUrl = searchParams.get("sort") === "latest" ? "latest" : "weight";
  const modalParam = searchParams.get("modal");
  const modal =
    modalParam === "detail" || modalParam === "categories" ? modalParam : null;
  const detailId = modal === "detail" ? searchParams.get("id") : null;
  const [filters, setFilters] = useState<ContentSearchFilters>({
    q: "",
    status: statusFromUrl,
    categorySlug: "",
    isOfficial: "",
    isFeatured: "",
    mediaKind: "",
    sort: sortFromUrl as "weight" | "latest",
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState({
    freeEpisodeCount: 3,
    priceCredits: 10,
    buyoutCredits: 0,
    lockMode: "" as "" | "INHERIT" | "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE",
  });
  const [error, setError] = useState<string | null>(null);
  const [lifecycleConfirm, setLifecycleConfirm] = useState<"offline" | "online" | "delete" | null>(null);

  useEffect(() => {
    if (modalParam !== "add") return;
    const tab = searchParams.get("tab") === "online" ? "?tab=online" : "";
    router.replace(`/content/add${tab}`);
  }, [modalParam, router, searchParams]);

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      status: statusFromUrl,
      sort: sortFromUrl as "weight" | "latest",
    }));
    setPage(1);
  }, [statusFromUrl, sortFromUrl]);

  function applyFilters(next: ContentSearchFilters) {
    setFilters(next);
    setPage(1);
    if (next.status !== statusFromUrl || next.sort !== sortFromUrl) {
      router.replace(
        buildContentHref({
          status: next.status,
          sort: next.sort,
          modal,
          id: detailId,
        }),
      );
    }
  }

  function openModal(nextModal: ContentModal, id?: string) {
    router.replace(
      buildContentHref({
        status: statusFromUrl,
        sort: sortFromUrl,
        modal: nextModal,
        id: nextModal === "detail" ? id ?? null : null,
      }),
    );
  }

  function closeModal() {
    router.replace(
      buildContentHref({
        status: statusFromUrl,
        sort: sortFromUrl,
      }),
    );
  }

  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Category[]>,
  });
  const dramasQ = useQuery({
    queryKey: ["admin", "dramas", filters, page],
    queryFn: async () => {
      const result = await adminListDramas({
        q: filters.q || undefined,
        status: filters.status,
        categorySlug: filters.categorySlug || undefined,
        isOfficial: filters.isOfficial || undefined,
        isFeatured: filters.isFeatured || undefined,
        mediaKind: filters.mediaKind || undefined,
        sort: filters.sort,
        page,
        pageSize,
      });
      return {
        rows: asRows<Drama>(result),
        total: (result as { total?: number }).total ?? 0,
      };
    },
  });
  const batchMut = useMutation({
    mutationFn: () =>
      adminBatchDramas({
        ids: [...selected],
        freeEpisodeCount: batch.freeEpisodeCount,
        priceCredits: batch.priceCredits,
        buyoutCredits: batch.buyoutCredits > 0 ? batch.buyoutCredits : null,
        ...(batch.lockMode ? { lockMode: batch.lockMode } : {}),
      }),
    onSuccess: async () => {
      setSelected(new Set());
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const lifecycleMut = useMutation({
    mutationFn: (action: "offline" | "online" | "delete") =>
      adminBatchDramaLifecycle({
        ids: [...selected],
        action,
        reason: `admin batch ${action}`,
      }),
    onSuccess: async (result) => {
      setLifecycleConfirm(null);
      setSelected(new Set());
      const failed = result?.failed?.length ?? 0;
      if (failed > 0) {
        setError(
          t("batchLifecyclePartial", {
            ok: result.updated,
            fail: failed,
            detail: result.failed.map((f) => `${f.id}: ${f.error}`).join("; "),
          }),
        );
      } else {
        setError(null);
      }
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => {
      setLifecycleConfirm(null);
      setError(e.message);
    },
  });

  const rows = dramasQ.data?.rows ?? [];
  const busy = batchMut.isPending || lifecycleMut.isPending;
  const pageAllSelected = rows.length > 0 && rows.every((row) => selected.has(String(row.id)));
  const pageSomeSelected = rows.some((row) => selected.has(String(row.id)));
  const columns: Column<Drama>[] = useMemo(
    () => [
      {
        key: "select",
        className: "w-[7.5rem] min-w-[7.5rem] max-w-[7.5rem]",
        header: (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-caption font-medium text-ink-muted">
            <input
              type="checkbox"
              checked={pageAllSelected}
              ref={(el) => {
                if (el) el.indeterminate = pageSomeSelected && !pageAllSelected;
              }}
              disabled={busy || rows.length === 0}
              onChange={() =>
                setSelected(
                  pageAllSelected ? new Set() : new Set(rows.map((row) => String(row.id))),
                )
              }
            />
            <span>{t("selectAll")}</span>
            <span className="inline-block w-7 tabular-nums text-ink-subtle">
              {selected.size > 0 ? `(${selected.size})` : null}
            </span>
          </label>
        ),
        cell: (row) => (
          <input
            type="checkbox"
            checked={selected.has(String(row.id))}
            onChange={(e) =>
              setSelected((previous) => {
                const next = new Set(previous);
                e.target.checked ? next.add(String(row.id)) : next.delete(String(row.id));
                return next;
              })
            }
          />
        ),
      },
      { key: "id", header: t("colId"), cell: (row) => String(row.id), className: "tabular-nums" },
      {
        key: "title",
        header: t("colTitle"),
        cell: (row) => (
          <div>
            <button
              type="button"
              className="font-medium text-brand hover:underline"
              onClick={() => openModal("detail", String(row.id))}
            >
              {row.titleZh || row.titleEn || "—"}
            </button>
            <div className="text-caption text-ink-muted">{row.slug}</div>
          </div>
        ),
      },
      { key: "status", header: t("status"), cell: (row) => statusLabel(t, row.status) },
      {
        key: "eps",
        header: t("episodeCount"),
        cell: (row) => String(row._count?.episodes ?? "—"),
        className: "tabular-nums",
      },
      { key: "creator", header: t("colCreator"), cell: (row) => row.creator?.displayName || "—" },
      {
        key: "published",
        header: t("publishedAt"),
        cell: (row) => (row.publishedAt ? fmtDate(row.publishedAt) : "—"),
      },
      {
        key: "metrics",
        header: t("colViewsUnlocks"),
        cell: (row) => `${fmtNum(row.viewCount)} / ${fmtNum(row.unlockCount)}`,
      },
      {
        key: "flags",
        header: t("colHomeFlags"),
        cell: (row) =>
          `${row.isOfficial ? `${t("official")} ` : ""}${row.isFeatured ? `${t("featuredFlag")} ` : ""}${t("weightLabel")} ${row.sortWeight ?? 0}`,
      },
    ],
    // openModal depends on URL filters; columns refresh when those/i18n/selection change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, selected, statusFromUrl, sortFromUrl, rows, pageAllSelected, pageSomeSelected, busy],
  );

  const title =
    statusFromUrl === "PENDING_REVIEW"
      ? t("contentPending")
      : filters.sort === "latest"
        ? t("contentLatest")
        : t("content");

  return (
    <AdminShell title={title}>
      {error || dramasQ.error || categoriesQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (dramasQ.error as Error)?.message || (categoriesQ.error as Error)?.message}
        </p>
      ) : null}
      <ContentSearchBar
        value={filters}
        onChange={applyFilters}
        categories={categoriesQ.data ?? []}
        statuses={statuses}
        showAdd={statusFromUrl !== "PENDING_REVIEW"}
        onAdd={() => router.push("/content/add")}
      />

      <div className="mb-4 flex flex-wrap items-end gap-2 card glass-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!selected.size || busy}
            onClick={() => setLifecycleConfirm("offline")}
          >
            {t("batchOffline")}
          </Button>
          <Button size="sm" disabled={!selected.size || busy} onClick={() => setLifecycleConfirm("online")}>
            {t("batchOnline")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!selected.size || busy}
            onClick={() => setLifecycleConfirm("delete")}
          >
            {t("batchDelete")}
          </Button>
        </div>
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
        <label className="text-caption text-ink-muted">
          {t("lockMode")}
          <Select
            className="mt-1 w-44"
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
              className="mt-1 w-28"
              value={batch[key]}
              onChange={(e) => setBatch((value) => ({ ...value, [key]: Number(e.target.value) }))}
            />
          </label>
        ))}
        <Button size="sm" disabled={!selected.size || busy} onClick={() => batchMut.mutate()}>
          {t("batchApply")}
        </Button>
      </div>

      <DataTable columns={columns} rows={rows} loading={dramasQ.isFetching} emptyTitle={t("empty")} />
      <div className="mt-3 flex items-center gap-3 text-body-sm text-ink-muted">
        <span>{t("totalCount", { n: dramasQ.data?.total ?? 0 })}</span>
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          {t("prevPage")}
        </Button>
        <span>{t("pageNumber", { n: page })}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={page * pageSize >= (dramasQ.data?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("nextPage")}
        </Button>
      </div>

      <ContentDetailModal open={modal === "detail"} dramaId={detailId} onClose={closeModal} />
      <CategoriesModal open={modal === "categories"} onClose={closeModal} />
      <ConfirmModal
        open={lifecycleConfirm === "offline"}
        onClose={() => setLifecycleConfirm(null)}
        onConfirm={() => lifecycleMut.mutate("offline")}
        message={t("confirmBatchOffline", { n: selected.size })}
        busy={lifecycleMut.isPending}
      />
      <ConfirmModal
        open={lifecycleConfirm === "online"}
        onClose={() => setLifecycleConfirm(null)}
        onConfirm={() => lifecycleMut.mutate("online")}
        message={t("confirmBatchOnline", { n: selected.size })}
        confirmVariant="primary"
        busy={lifecycleMut.isPending}
      />
      <ConfirmModal
        open={lifecycleConfirm === "delete"}
        onClose={() => setLifecycleConfirm(null)}
        onConfirm={() => lifecycleMut.mutate("delete")}
        message={t("confirmBatchDelete", { n: selected.size })}
        busy={lifecycleMut.isPending}
      />
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
