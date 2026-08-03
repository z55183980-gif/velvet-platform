"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminBatchDramas, adminListCategories, adminListDramas, asRows } from "@velvet/api-client";
import { Button, DataTable, Input, Select, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";

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

export default function AdminContentPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({
    q: "",
    status: "ALL",
    categorySlug: "",
    isOfficial: "",
    isFeatured: "",
  });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState({ freeEpisodeCount: 3, priceCredits: 10, buyoutCredits: 0 });
  const [error, setError] = useState<string | null>(null);

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
      }),
    onSuccess: async () => {
      setSelected(new Set());
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "dramas"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const rows = dramasQ.data?.rows ?? [];
  const columns: Column<Drama>[] = [
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
    { key: "id", header: "ID", cell: (row) => String(row.id), className: "tabular-nums" },
    {
      key: "title",
      header: "标题",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.titleZh || row.titleVi || "—"}</div>
          <div className="text-caption text-ink-muted">{row.slug}</div>
        </div>
      ),
    },
    { key: "status", header: t("status"), cell: (row) => row.status || "—" },
    { key: "creator", header: "创作者", cell: (row) => row.creator?.displayName || "—" },
    {
      key: "metrics",
      header: "浏览 / 解锁",
      cell: (row) => `${fmtNum(row.viewCount)} / ${fmtNum(row.unlockCount)}`,
    },
    {
      key: "flags",
      header: "标记",
      cell: (row) =>
        `${row.isOfficial ? "官方 " : ""}${row.isFeatured ? "推荐 " : ""}权重 ${row.sortWeight ?? 0}`,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Link className="text-brand hover:underline" href={`/content/${row.id}`}>
          详情
        </Link>
      ),
    },
  ];

  return (
    <AdminShell title={t("content")}>
      {error || dramasQ.error || categoriesQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (dramasQ.error as Error)?.message || (categoriesQ.error as Error)?.message}
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Input
          className="w-52"
          placeholder="标题 / slug / 创作者"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <Select
          className="w-40"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          {statuses.map((status) => <option key={status}>{status}</option>)}
        </Select>
        <Select
          className="w-40"
          value={filters.categorySlug}
          onChange={(e) => setFilters((f) => ({ ...f, categorySlug: e.target.value }))}
        >
          <option value="">全部分类</option>
          {(categoriesQ.data ?? []).map((category) => (
            <option key={category.slug} value={category.slug}>{category.nameZh || category.nameVi}</option>
          ))}
        </Select>
        {(["isOfficial", "isFeatured"] as const).map((key) => (
          <Select
            key={key}
            className="w-32"
            value={filters[key]}
            onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
          >
            <option value="">{key === "isOfficial" ? "官方" : "推荐"}：全部</option>
            <option value="1">是</option>
            <option value="0">否</option>
          </Select>
        ))}
        <Button size="sm" onClick={() => { setPage(1); setApplied(filters); }}>查询</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3">
        <span className="text-caption text-ink-muted">已选 {selected.size}</span>
        {([
          ["freeEpisodeCount", "免费集数"],
          ["priceCredits", "单集积分"],
          ["buyoutCredits", "买断积分（0=关闭）"],
        ] as const).map(([key, label]) => (
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
          批量应用
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
          全选本页
        </Button>
      </div>

      <DataTable columns={columns} rows={rows} loading={dramasQ.isFetching} emptyTitle={t("empty")} />
      <div className="mt-3 flex items-center gap-3 text-body-sm text-ink-muted">
        <span>共 {dramasQ.data?.total ?? 0}</span>
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
        <span>第 {page} 页</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={page * pageSize >= (dramasQ.data?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>
    </AdminShell>
  );
}
