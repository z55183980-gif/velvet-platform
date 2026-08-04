"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminListDramas,
  adminListHottest,
  adminReorderHottest,
  adminSetHottest,
  asRows,
} from "@velvet/api-client";
import { Button, DataTable, Input, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { useI18n } from "@/lib/i18n";

type Drama = {
  id: string | number;
  titleZh?: string;
  titleEn?: string;
  slug?: string;
  status?: string;
  viewCount?: number;
  unlockCount?: number;
  isHottest?: boolean;
  hottestSortOrder?: number;
};

function dramaId(row: Drama) {
  return String(row.id);
}

export default function AdminHottestPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "hottest", "list"],
    queryFn: async () => {
      const data = await adminListHottest();
      return asRows<Drama>(data).sort(
        (a, b) => (a.hottestSortOrder ?? 0) - (b.hottestSortOrder ?? 0),
      );
    },
  });

  const searchQry = useQuery({
    queryKey: ["admin", "hottest", "search", searchQ],
    enabled: addOpen && searchQ.trim().length > 0,
    queryFn: async () => {
      const data = await adminListDramas({
        status: "LIVE",
        q: searchQ.trim(),
        page: 1,
        pageSize: 20,
      });
      return asRows<Drama>(data);
    },
  });

  const actionMut = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(null);
      setRemoveId(null);
      await qc.invalidateQueries({ queryKey: ["admin", "hottest"] });
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const rows = listQ.data ?? [];
  const selectedIds = useMemo(() => new Set(rows.map(dramaId)), [rows]);

  function closeAdd() {
    setAddOpen(false);
    setQ("");
    setSearchQ("");
  }

  function move(id: string, dir: -1 | 1) {
    const list = [...rows];
    const idx = list.findIndex((r) => dramaId(r) === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= list.length) return;
    const swapped = [...list];
    [swapped[idx], swapped[next]] = [swapped[next], swapped[idx]];
    actionMut.mutate(() => adminReorderHottest(swapped.map(dramaId)));
  }

  const columns: Column<Drama>[] = useMemo(
    () => [
      {
        key: "order",
        header: t("colSort"),
        cell: (row) => {
          const idx = rows.findIndex((r) => dramaId(r) === dramaId(row));
          return String(idx >= 0 ? idx + 1 : (row.hottestSortOrder ?? 0) + 1);
        },
      },
      {
        key: "title",
        header: t("drama"),
        cell: (row) => (
          <div>
            <Link href={`/content/${row.id}`} className="font-medium text-brand hover:underline">
              {row.titleZh || row.titleEn || "—"}
            </Link>
            <div className="text-caption text-ink-muted">{row.slug}</div>
          </div>
        ),
      },
      {
        key: "metrics",
        header: t("colViewsUnlocks"),
        cell: (row) => `${fmtNum(row.viewCount)} / ${fmtNum(row.unlockCount)}`,
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (row) => {
          const idx = rows.findIndex((r) => dramaId(r) === dramaId(row));
          const busy = actionMut.isPending;
          return (
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || idx <= 0}
                onClick={() => move(dramaId(row), -1)}
              >
                {t("moveUp")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || idx < 0 || idx >= rows.length - 1}
                onClick={() => move(dramaId(row), 1)}
              >
                {t("moveDown")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => setRemoveId(dramaId(row))}
              >
                {t("remove")}
              </Button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, actionMut.isPending, rows],
  );

  const searchColumns: Column<Drama>[] = useMemo(
    () => [
      {
        key: "title",
        header: t("drama"),
        cell: (row) => (
          <div>
            <div className="font-medium">{row.titleZh || row.titleEn || "—"}</div>
            <div className="text-caption text-ink-muted">{row.slug}</div>
          </div>
        ),
      },
      {
        key: "metrics",
        header: t("colViewsUnlocks"),
        cell: (row) => `${fmtNum(row.viewCount)} / ${fmtNum(row.unlockCount)}`,
      },
      {
        key: "status",
        header: t("status"),
        cell: (row) => row.status || "—",
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (row) => {
          const added = selectedIds.has(dramaId(row));
          return (
            <Button
              size="sm"
              variant={added ? "secondary" : "primary"}
              disabled={actionMut.isPending || added}
              onClick={() => actionMut.mutate(() => adminSetHottest(dramaId(row), true))}
            >
              {added ? t("alreadyAdded") : t("add")}
            </Button>
          );
        },
      },
    ],
    [t, actionMut.isPending, selectedIds],
  );

  const removeRow = removeId ? rows.find((r) => dramaId(r) === removeId) : undefined;

  return (
    <AdminShell title={t("hottest")}>
      {error || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (listQ.error as Error).message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-body-sm text-ink-muted">{t("heroHintHottest")}</p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-body-sm text-ink-muted">{t("totalCount", { n: rows.length })}</span>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            {t("hottestAddFromAll")}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={listQ.isFetching && !listQ.data}
        emptyTitle={t("hottestEmpty")}
        emptyDescription={t("hottestEmptyHint")}
      />

      <GlassModal open={addOpen} onClose={closeAdd} title={t("hottestAddFromAll")} size="lg">
        <p className="mb-3 text-body-sm text-ink-muted">{t("hottestSearchHint")}</p>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearchQ(q.trim());
          }}
        >
          <Input
            className="min-w-[220px] flex-1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("hottestSearchPlaceholder")}
            autoFocus
          />
          <Button type="submit" variant="secondary" disabled={!q.trim()}>
            {t("search")}
          </Button>
        </form>
        {searchQ.trim() ? (
          <DataTable
            columns={searchColumns}
            rows={searchQry.data ?? []}
            loading={searchQry.isFetching}
            emptyTitle={t("empty")}
            emptyDescription={t("hottestSearchNoResult")}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-4 py-10 text-center text-body-sm text-ink-muted">
            {t("hottestSearchHint")}
          </div>
        )}
      </GlassModal>

      <ConfirmModal
        open={!!removeId}
        onClose={() => setRemoveId(null)}
        busy={actionMut.isPending}
        message={t("hottestConfirmRemove", {
          title: removeRow?.titleZh || removeRow?.titleEn || removeId || "",
        })}
        onConfirm={() => {
          if (!removeId) return;
          actionMut.mutate(() => adminSetHottest(removeId, false));
        }}
      />
    </AdminShell>
  );
}
