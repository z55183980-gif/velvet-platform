"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, X } from "lucide-react";
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
  coverUrl?: string | null;
  viewCount?: number;
  unlockCount?: number;
  isHottest?: boolean;
  hottestSortOrder?: number;
};

function dramaId(row: Drama) {
  return String(row.id);
}

function dramaTitle(row: Drama) {
  return row.titleZh || row.titleEn || "—";
}

function idsKey(rows: Drama[]) {
  return rows.map(dramaId).join(",");
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function AdminHottestPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [ordered, setOrdered] = useState<Drama[]>([]);
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "hottest", "list"],
    queryFn: async () => {
      const data = await adminListHottest();
      return asRows<Drama>(data).sort(
        (a, b) => (a.hottestSortOrder ?? 0) - (b.hottestSortOrder ?? 0),
      );
    },
  });

  const dirty = syncedKey !== null && idsKey(ordered) !== syncedKey;

  useEffect(() => {
    if (!listQ.data) return;
    const key = idsKey(listQ.data);
    if (syncedKey === null || idsKey(ordered) === syncedKey) {
      setOrdered(listQ.data);
      setSyncedKey(key);
    }
  }, [listQ.data, ordered, syncedKey]);

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

  const saveSortMut = useMutation({
    mutationFn: (ids: string[]) => adminReorderHottest(ids),
    onSuccess: async () => {
      setError(null);
      setSyncedKey(idsKey(ordered));
      await qc.invalidateQueries({ queryKey: ["admin", "hottest"] });
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const selectedIds = useMemo(() => new Set(ordered.map(dramaId)), [ordered]);

  function closeAdd() {
    setAddOpen(false);
    setQ("");
    setSearchQ("");
  }

  function discardSort() {
    if (!listQ.data) return;
    setOrdered(listQ.data);
    setSyncedKey(idsKey(listQ.data));
  }

  function onDragStart(id: string) {
    setDragId(id);
  }

  function onDragOver(e: DragEvent, overId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overId !== dropId) setDropId(overId);
  }

  function onDrop(overId: string) {
    if (!dragId || dragId === overId) {
      setDragId(null);
      setDropId(null);
      return;
    }
    setOrdered((prev) => {
      const from = prev.findIndex((r) => dramaId(r) === dragId);
      const to = prev.findIndex((r) => dramaId(r) === overId);
      return moveItem(prev, from, to);
    });
    setDragId(null);
    setDropId(null);
  }

  function onDragEnd() {
    setDragId(null);
    setDropId(null);
  }

  const searchColumns: Column<Drama>[] = useMemo(
    () => [
      {
        key: "cover",
        header: t("coverPreview"),
        className: "w-16",
        cell: (row) => (
          <div className="h-14 w-10 overflow-hidden rounded bg-panel">
            {row.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-ink-subtle">
                <ImageIcon className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        ),
      },
      {
        key: "title",
        header: t("drama"),
        cell: (row) => (
          <div>
            <div className="font-medium">{dramaTitle(row)}</div>
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
              disabled={actionMut.isPending || dirty || added}
              onClick={() => actionMut.mutate(() => adminSetHottest(dramaId(row), true))}
            >
              {added ? t("alreadyAdded") : t("add")}
            </Button>
          );
        },
      },
    ],
    [t, actionMut.isPending, selectedIds, dirty],
  );

  const removeRow = removeId ? ordered.find((r) => dramaId(r) === removeId) : undefined;
  const busy = actionMut.isPending || saveSortMut.isPending;
  const loading = listQ.isFetching && !listQ.data;

  return (
    <AdminShell title={t("hottest")}>
      {error || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (listQ.error as Error).message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <p className="text-body-sm text-ink-muted">{t("heroHintHottest")}</p>
          {dirty ? (
            <p className="text-body-sm text-warning">{t("hottestSortUnsaved")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-body-sm text-ink-muted">{t("totalCount", { n: ordered.length })}</span>
          {dirty ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={discardSort}>
              {t("discardChanges")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !dirty}
            onClick={() => saveSortMut.mutate(ordered.map(dramaId))}
          >
            {saveSortMut.isPending ? t("saving") : t("hottestSaveSort")}
          </Button>
          <Button size="sm" disabled={dirty} onClick={() => setAddOpen(true)}>
            {t("hottestAddFromAll")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-line bg-white/70">
              <div className="aspect-[3/4] animate-pulse bg-panel" />
              <div className="space-y-1.5 p-1.5">
                <div className="h-3 animate-pulse rounded bg-panel" />
                <div className="h-2.5 w-2/3 animate-pulse rounded bg-panel" />
              </div>
            </div>
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <div className="card glass-card admin-fill flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <p className="text-body font-medium text-ink">{t("hottestEmpty")}</p>
          <p className="max-w-md text-body-sm text-ink-muted">{t("hottestEmptyHint")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {ordered.map((row, idx) => {
            const id = dramaId(row);
            const title = dramaTitle(row);
            const dragging = dragId === id;
            const dropTarget = dropId === id && dragId && dragId !== id;
            return (
              <div
                key={id}
                draggable={!busy}
                title={t("hottestDragHint")}
                onDragStart={(e) => {
                  // Don't start card drag from interactive controls.
                  const target = e.target as HTMLElement | null;
                  if (target?.closest("a,button")) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                  onDragStart(id);
                }}
                onDragOver={(e) => onDragOver(e, id)}
                onDrop={() => onDrop(id)}
                onDragEnd={onDragEnd}
                className={[
                  "group relative cursor-grab overflow-hidden rounded-lg border bg-white/80 shadow-sm transition active:cursor-grabbing",
                  dragging ? "opacity-40" : "hover:border-brand/40 hover:shadow-md",
                  dropTarget ? "border-brand ring-2 ring-brand/20" : "border-line",
                ].join(" ")}
              >
                <div className="relative aspect-[3/4] bg-panel">
                  {row.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.coverUrl}
                      alt=""
                      draggable={false}
                      className="pointer-events-none h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-ink-subtle">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}

                  <span className="absolute left-1 top-1 rounded bg-black/65 px-1 py-px text-[10px] font-semibold tabular-nums text-white">
                    {idx + 1}
                  </span>

                  <button
                    type="button"
                    disabled={busy || dirty}
                    onClick={() => setRemoveId(id)}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-danger text-white opacity-0 transition enabled:group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                    title={t("remove")}
                    aria-label={t("remove")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                <div className="p-1.5">
                  <Link
                    href={`/content/${row.id}`}
                    draggable={false}
                    className="line-clamp-2 text-[11px] font-medium leading-snug text-ink hover:text-brand"
                    title={title}
                  >
                    {title}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
          title: removeRow ? dramaTitle(removeRow) : removeId || "",
        })}
        onConfirm={() => {
          if (!removeId) return;
          actionMut.mutate(() => adminSetHottest(removeId, false));
        }}
      />
    </AdminShell>
  );
}
