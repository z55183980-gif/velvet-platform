"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminBatchDramas, adminListCategories, adminListDramas, asRows } from "@velvet/api-client";
import { Button, DataTable, Input, Select, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { ContentDetailModal } from "@/components/content-detail-modal";
import { ContentImportModal } from "@/components/content-import-modal";
import { useI18n, statusLabel } from "@/lib/i18n";

type Drama = {
  id: string | number;
  titleZh?: string;
  titleVi?: string;
  slug?: string;
  status?: string;
  creator?: { displayName?: string };
  viewCount?: number;
  unlockCount?: number;
  isOfficial?: boolean;
  isFeatured?: boolean;
  sortWeight?: number;
};
type Category = { slug: string; nameZh?: string; nameVi?: string };

const statuses = ["ALL", "DRAFT", "PENDING_REVIEW", "LIVE", "OFFLINE", "REJECTED"];
const pageSize = 20;

function AdminContentInner() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get("status") || "ALL";
  const [filters, setFilters] = useState({
    q: "",
    status: statusFromUrl,
    categorySlug: "",
    isOfficial: "",
    isFeatured: "",
  });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState({
    freeEpisodeCount: 3,
    priceCredits: 10,
    buyoutCredits: 0,
    lockMode: "" as "" | "INHERIT" | "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE",
  });
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const next = {
      q: "",
      status: statusFromUrl,
      categorySlug: "",
      isOfficial: "",
      isFeatured: "",
    };
    setFilters(next);
    setApplied(next);
    setPage(1);
  }, [statusFromUrl]);

  const categoriesQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Category[]>,
  });
  const dramasQ = useQuery({
    queryKey: ["admin", "dramas", applied, page],
    queryFn: async () => {
      const result = await adminListDramas({
        q: applied.q || undefined,
        status: applied.status,
        categorySlug: applied.categorySlug || undefined,
        isOfficial: applied.isOfficial || undefined,
        isFeatured: applied.isFeatured || undefined,
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

  const rows = dramasQ.data?.rows ?? [];
  const columns: Column<Drama>[] = useMemo(
    () => [
      {
        key: "select",
        header: "",
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
            <div className="font-medium">{row.titleZh || row.titleVi || "—"}</div>
            <div className="text-caption text-ink-muted">{row.slug}</div>
          </div>
        ),
      },
      { key: "status", header: t("status"), cell: (row) => statusLabel(t, row.status) },
      { key: "creator", header: t("colCreator"), cell: (row) => row.creator?.displayName || "—" },
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
      {
        key: "actions",
        header: "",
        cell: (row) => (
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() => setDetailId(String(row.id))}
          >
            {t("details")}
          </button>
        ),
      },
    ],
    [t, selected],
  );

  const title =
    statusFromUrl === "PENDING_REVIEW" ? t("contentPending") : t("content");

  return (
    <AdminShell title={title}>
      {error || dramasQ.error || categoriesQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (dramasQ.error as Error)?.message || (categoriesQ.error as Error)?.message}
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Input
          className="w-52"
          placeholder={t("searchTitleSlugCreator")}
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <Select
          className="w-40"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          {statuses.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </Select>
        <Select
          className="w-40"
          value={filters.categorySlug}
          onChange={(e) => setFilters((f) => ({ ...f, categorySlug: e.target.value }))}
        >
          <option value="">{t("allCategories")}</option>
          {(categoriesQ.data ?? []).map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.nameZh || category.nameVi}
            </option>
          ))}
        </Select>
        {(["isOfficial", "isFeatured"] as const).map((key) => (
          <Select
            key={key}
            className="w-32"
            value={filters[key]}
            onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
          >
            <option value="">{t(key === "isOfficial" ? "official" : "featuredFlag")}: {t("all")}</option>
            <option value="1">{t("yes")}</option>
            <option value="0">{t("no")}</option>
          </Select>
        ))}
        <Button
          size="sm"
          onClick={() => {
            setPage(1);
            setApplied(filters);
          }}
        >
          {t("query")}
        </Button>
        {statusFromUrl !== "PENDING_REVIEW" ? (
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            {t("contentImport")}
          </Button>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2 card glass-card p-3">
        <span className="text-caption text-ink-muted">{t("selectedCount", { n: selected.size })}</span>
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
        <Button size="sm" disabled={!selected.size || batchMut.isPending} onClick={() => batchMut.mutate()}>
          {t("batchApply")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setSelected(
              rows.length > 0 && rows.every((row) => selected.has(String(row.id)))
                ? new Set()
                : new Set(rows.map((row) => String(row.id))),
            )
          }
        >
          {t("selectAllPage")}
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

      <ContentDetailModal
        open={!!detailId}
        dramaId={detailId}
        onClose={() => setDetailId(null)}
      />
      <ContentImportModal open={importOpen} onClose={() => setImportOpen(false)} />
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
