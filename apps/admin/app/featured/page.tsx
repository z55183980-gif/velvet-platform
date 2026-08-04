"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminListDramas,
  adminSetFeatured,
  adminSetOfficial,
  adminSetSortWeight,
  asRows,
} from "@velvet/api-client";
import { Button, DataTable, Input, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n } from "@/lib/i18n";

type Drama = {
  id: string | number;
  titleZh?: string;
  titleVi?: string;
  slug?: string;
  status?: string;
  viewCount?: number;
  unlockCount?: number;
  isOfficial?: boolean;
  isFeatured?: boolean;
  sortWeight?: number;
};

export default function AdminFeaturedPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});

  const listQ = useQuery({
    queryKey: ["admin", "featured", "dramas"],
    queryFn: async () => {
      const [featured, official] = await Promise.all([
        adminListDramas({ status: "LIVE", isFeatured: "1", page: 1, pageSize: 100 }),
        adminListDramas({ status: "LIVE", isOfficial: "1", page: 1, pageSize: 100 }),
      ]);
      const map = new Map<string, Drama>();
      for (const row of [...asRows<Drama>(featured), ...asRows<Drama>(official)]) {
        map.set(String(row.id), row);
      }
      return [...map.values()].sort((a, b) => (b.sortWeight ?? 0) - (a.sortWeight ?? 0));
    },
  });

  useEffect(() => {
    if (!listQ.data) return;
    setWeights(Object.fromEntries(listQ.data.map((row) => [String(row.id), row.sortWeight ?? 0])));
  }, [listQ.data]);

  const actionMut = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "featured"] });
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const columns: Column<Drama>[] = useMemo(
    () => [
      {
        key: "title",
        header: t("drama"),
        cell: (row) => (
          <div>
            <Link href={`/content/${row.id}`} className="font-medium text-brand hover:underline">
              {row.titleZh || row.titleVi || "—"}
            </Link>
            <div className="text-caption text-ink-muted">{row.slug}</div>
          </div>
        ),
      },
      {
        key: "flags",
        header: t("flagsLabel"),
        cell: (row) =>
          `${row.isFeatured ? `${t("featuredFlag")} ` : ""}${row.isOfficial ? t("official") : ""}`.trim() || "—",
      },
      {
        key: "metrics",
        header: t("colViewsUnlocks"),
        cell: (row) => `${fmtNum(row.viewCount)} / ${fmtNum(row.unlockCount)}`,
      },
      {
        key: "weight",
        header: t("weightLabel"),
        cell: (row) => (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              className="w-20"
              value={weights[String(row.id)] ?? row.sortWeight ?? 0}
              onChange={(e) =>
                setWeights((prev) => ({ ...prev, [String(row.id)]: Number(e.target.value) }))
              }
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={actionMut.isPending}
              onClick={() =>
                actionMut.mutate(() =>
                  adminSetSortWeight(String(row.id), weights[String(row.id)] ?? 0),
                )
              }
            >
              {t("save")}
            </Button>
          </div>
        ),
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (row) => (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={actionMut.isPending}
              onClick={() => actionMut.mutate(() => adminSetFeatured(String(row.id), !row.isFeatured))}
            >
              {t("featuredFlag")}：{row.isFeatured ? t("on") : t("off")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={actionMut.isPending}
              onClick={() => actionMut.mutate(() => adminSetOfficial(String(row.id), !row.isOfficial))}
            >
              {t("official")}：{row.isOfficial ? t("on") : t("off")}
            </Button>
          </div>
        ),
      },
    ],
    [t, weights, actionMut],
  );

  return (
    <AdminShell title={t("featured")}>
      {error || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (listQ.error as Error).message}
        </p>
      ) : null}
      <p className="mb-4 text-body-sm text-ink-muted">{t("heroHintFeatured")}</p>
      <DataTable
        columns={columns}
        rows={listQ.data ?? []}
        loading={listQ.isFetching}
        emptyTitle={t("empty")}
      />
    </AdminShell>
  );
}
