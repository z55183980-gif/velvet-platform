"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateCategory,
  adminDeleteCategory,
  adminListCategories,
  adminUpdateCategory,
} from "@velvet/api-client";
import { Badge, Button, DataTable, Input, type Column } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";
import { useMemo, useState } from "react";

type Row = {
  slug: string;
  nameEn?: string;
  nameZh?: string | null;
  nameFr?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

const emptyForm = {
  slug: "",
  nameEn: "",
  nameZh: "",
  nameFr: "",
  sortOrder: 0,
  isActive: true,
};

export function CategoriesPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: () => adminListCategories(true) as Promise<Row[]>,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const nameEn = form.nameEn.trim();
      if (!nameEn) throw new Error(t("nameEnRequired"));
      const nameZh = form.nameZh.trim() || null;
      const nameFr = form.nameFr.trim() || null;
      if (editSlug) {
        return adminUpdateCategory(editSlug, {
          nameEn,
          nameZh,
          nameFr,
          sortOrder: form.sortOrder,
          isActive: form.isActive,
        });
      }
      if (!form.slug.trim()) throw new Error(t("slugRequired"));
      return adminCreateCategory({
        slug: form.slug.trim(),
        nameEn,
        nameZh,
        nameFr,
        sortOrder: form.sortOrder,
        isActive: form.isActive,
      });
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setEditSlug(null);
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (slug: string) => adminDeleteCategory(slug),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const columns: Column<Row>[] = useMemo(
    () => [
      { key: "slug", header: t("colSlug"), cell: (r) => r.slug },
      { key: "en", header: t("nameEnLabel"), cell: (r) => r.nameEn || "—" },
      { key: "zh", header: t("nameZhLabel"), cell: (r) => r.nameZh || "—" },
      { key: "fr", header: t("nameFrLabel"), cell: (r) => r.nameFr || "—" },
      { key: "sort", header: t("colSort"), cell: (r) => String(r.sortOrder ?? 0), className: "tabular-nums" },
      {
        key: "active",
        header: t("status"),
        cell: (r) => (
          <Badge tone={r.isActive ? "success" : "default"}>{r.isActive ? t("enable") : t("disable")}</Badge>
        ),
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (r) => (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditSlug(r.slug);
                setForm({
                  slug: r.slug,
                  nameEn: r.nameEn || "",
                  nameZh: r.nameZh || "",
                  nameFr: r.nameFr || "",
                  sortOrder: r.sortOrder ?? 0,
                  isActive: !!r.isActive,
                });
              }}
            >
              {t("edit")}
            </Button>
            <Button size="sm" variant="danger" onClick={() => deleteMut.mutate(r.slug)}>
              {t("delete")}
            </Button>
          </div>
        ),
      },
    ],
    [t, deleteMut],
  );

  return (
    <div>
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}

      <div className="mb-6 grid gap-3 card glass-card p-4 md:grid-cols-3">
        <label className="text-caption text-ink-muted">
          {t("colSlug")}
          <Input
            className="mt-1"
            disabled={!!editSlug}
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("nameEnLabel")}
          <Input
            className="mt-1"
            value={form.nameEn}
            onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("nameZhLabel")}
          <Input
            className="mt-1"
            value={form.nameZh}
            onChange={(e) => setForm((f) => ({ ...f, nameZh: e.target.value }))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("nameFrLabel")}
          <Input
            className="mt-1"
            value={form.nameFr}
            onChange={(e) => setForm((f) => ({ ...f, nameFr: e.target.value }))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("colSort")}
          <Input
            type="number"
            className="mt-1"
            value={form.sortOrder}
            onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
          />
        </label>
        <label className="flex items-end gap-2 text-caption text-ink-muted">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          {t("isActive")}
        </label>
        <div className="flex items-end gap-2">
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {editSlug ? t("update") : t("create")}
          </Button>
          {editSlug ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditSlug(null);
                setForm(emptyForm);
              }}
            >
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={listQ.data || []}
        loading={listQ.isFetching}
        emptyTitle={t("empty")}
        getRowKey={(r) => r.slug}
      />
    </div>
  );
}
