"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  adminCreateCategory,
  adminDeleteCategory,
  adminListCategories,
  adminUpdateCategory,
} from "@/lib/api";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminCategoriesPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({
    slug: "",
    nameVi: "",
    nameZh: "",
    sortOrder: 0,
    isActive: true,
  });
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setRows(await adminListCategories(true));
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setErr(null);
    try {
      if (editSlug) {
        await adminUpdateCategory(editSlug, {
          nameVi: form.nameVi,
          nameZh: form.nameZh,
          sortOrder: form.sortOrder,
          isActive: form.isActive,
        });
      } else {
        await adminCreateCategory(form);
      }
      setForm({ slug: "", nameVi: "", nameZh: "", sortOrder: 0, isActive: true });
      setEditSlug(null);
      await load();
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }

  return (
    <AdminLayout title={t("admin.categories")}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="rounded-lg border border-line bg-surface p-4 mb-6 grid md:grid-cols-3 gap-3">
        <label className="text-caption text-ink-muted">
          slug
          <input
            disabled={!!editSlug}
            className="block mt-1 w-full rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          nameVi
          <input
            className="block mt-1 w-full rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={form.nameVi}
            onChange={(e) => setForm((f) => ({ ...f, nameVi: e.target.value }))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          nameZh
          <input
            className="block mt-1 w-full rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={form.nameZh}
            onChange={(e) => setForm((f) => ({ ...f, nameZh: e.target.value }))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          sortOrder
          <input
            type="number"
            className="block mt-1 w-full rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={form.sortOrder}
            onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
          />
        </label>
        <label className="text-caption text-ink-muted flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          Active
        </label>
        <div className="flex gap-2 items-end">
          <button type="button" className={buttonVariants({ size: "sm" })} onClick={save}>
            {editSlug ? (zh ? "更新" : "Cập nhật") : zh ? "创建" : "Tạo"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">slug</th>
              <th className="px-3 py-2">VI</th>
              <th className="px-3 py-2">ZH</th>
              <th className="px-3 py-2">Sort</th>
              <th className="px-3 py-2">On</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-caption">{r.slug}</td>
                <td className="px-3 py-2">{r.nameVi}</td>
                <td className="px-3 py-2">{r.nameZh}</td>
                <td className="px-3 py-2">{r.sortOrder}</td>
                <td className="px-3 py-2">{r.isActive ? "✓" : "—"}</td>
                <td className="px-3 py-2 space-x-2">
                  <button
                    type="button"
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                    onClick={() => {
                      setEditSlug(r.slug);
                      setForm({
                        slug: r.slug,
                        nameVi: r.nameVi,
                        nameZh: r.nameZh,
                        sortOrder: r.sortOrder ?? 0,
                        isActive: !!r.isActive,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={async () => {
                      if (!confirm(zh ? "删除？（若有引用会失败）" : "Xoá? (fail nếu đang dùng)")) return;
                      try {
                        await adminDeleteCategory(r.slug);
                        await load();
                      } catch (e: any) {
                        setErr(e?.message || "failed");
                      }
                    }}
                  >
                    Del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
