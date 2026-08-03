"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateBanner,
  adminDeleteBanner,
  adminListBanners,
  adminUpdateBanner,
} from "@velvet/api-client";
import { Button, DataTable, Input, fmtDate, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";

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
const makeEmpty = () => ({
  titleVi: "",
  titleZh: "",
  imageUrl: "",
  linkUrl: "",
  dramaId: "",
  startAt: new Date().toISOString().slice(0, 16),
  endAt: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
  sortOrder: 0,
  isActive: true,
});

export default function AdminBannersPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(makeEmpty);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listQ = useQuery({
    queryKey: ["admin", "banners"],
    queryFn: () => adminListBanners(true) as Promise<Banner[]>,
  });
  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        dramaId: form.dramaId || undefined,
        linkUrl: form.linkUrl || undefined,
        titleZh: form.titleZh || undefined,
      };
      return editId ? adminUpdateBanner(editId, body) : adminCreateBanner(body);
    },
    onSuccess: async () => {
      setForm(makeEmpty());
      setEditId(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "banners"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: adminDeleteBanner,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "banners"] }),
    onError: (e: Error) => setError(e.message),
  });

  const columns: Column<Banner>[] = [
    { key: "id", header: "ID", cell: (row) => String(row.id) },
    {
      key: "title",
      header: "标题",
      cell: (row) => (
        <div className="flex items-center gap-2">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.imageUrl} alt="" className="h-8 w-12 rounded object-cover" />
          ) : null}
          {row.titleZh || row.titleVi || "—"}
        </div>
      ),
    },
    { key: "schedule", header: "投放时间", cell: (row) => `${fmtDate(row.startAt)} → ${fmtDate(row.endAt)}` },
    { key: "sort", header: "排序", cell: (row) => String(row.sortOrder ?? 0) },
    { key: "active", header: "状态", cell: (row) => (row.isActive ? "启用" : "停用") },
    {
      key: "actions",
      header: t("actions"),
      cell: (row) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditId(String(row.id));
              setForm({
                titleVi: row.titleVi || "",
                titleZh: row.titleZh || "",
                imageUrl: row.imageUrl || "",
                linkUrl: row.linkUrl || "",
                dramaId: row.dramaId ? String(row.dramaId) : "",
                startAt: new Date(row.startAt).toISOString().slice(0, 16),
                endAt: new Date(row.endAt).toISOString().slice(0, 16),
                sortOrder: row.sortOrder ?? 0,
                isActive: !!row.isActive,
              });
            }}
          >
            {t("edit")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={deleteMut.isPending}
            onClick={() => confirm("确定删除此横幅？") && deleteMut.mutate(String(row.id))}
          >
            {t("delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminShell title={t("banners")}>
      {error || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{error || (listQ.error as Error).message}</p>
      ) : null}
      <div className="mb-6 grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-2">
        {([
          ["titleVi", "越南语标题"],
          ["titleZh", "中文标题"],
          ["imageUrl", "图片 URL"],
          ["linkUrl", "链接 URL"],
          ["dramaId", "短剧 ID"],
          ["sortOrder", "排序"],
        ] as const).map(([key, label]) => (
          <label key={key} className="text-caption text-ink-muted">
            {label}
            <Input
              type={key === "sortOrder" ? "number" : "text"}
              className="mt-1"
              value={form[key]}
              onChange={(e) =>
                setForm((value) => ({
                  ...value,
                  [key]: key === "sortOrder" ? Number(e.target.value) : e.target.value,
                }))
              }
            />
          </label>
        ))}
        {(["startAt", "endAt"] as const).map((key) => (
          <label key={key} className="text-caption text-ink-muted">
            {key === "startAt" ? "开始时间" : "结束时间"}
            <Input
              type="datetime-local"
              className="mt-1"
              value={form[key]}
              onChange={(e) => setForm((value) => ({ ...value, [key]: e.target.value }))}
            />
          </label>
        ))}
        <label className="flex items-center gap-2 text-caption text-ink-muted">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((value) => ({ ...value, isActive: e.target.checked }))}
          />
          启用
        </label>
        <div className="flex gap-2">
          <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {editId ? t("update") : t("create")}
          </Button>
          {editId ? (
            <Button size="sm" variant="ghost" onClick={() => { setEditId(null); setForm(makeEmpty()); }}>
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      </div>
      <DataTable columns={columns} rows={listQ.data ?? []} loading={listQ.isFetching} emptyTitle={t("empty")} />
    </AdminShell>
  );
}
