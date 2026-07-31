"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  adminCreateBanner,
  adminDeleteBanner,
  adminListBanners,
  adminUpdateBanner,
} from "@/lib/api";
import { AdminLayout, fmtDate } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

const empty = {
  titleVi: "",
  titleZh: "",
  imageUrl: "",
  linkUrl: "",
  dramaId: "",
  startAt: new Date().toISOString().slice(0, 16),
  endAt: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
  sortOrder: 0,
  isActive: true,
};

export default function AdminBannersPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setRows(await adminListBanners(true));
    } catch (e: any) {
      setErr(e?.message || "failed");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setErr(null);
    try {
      const body = {
        ...form,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        dramaId: form.dramaId || undefined,
        linkUrl: form.linkUrl || undefined,
        titleZh: form.titleZh || undefined,
      };
      if (editId) await adminUpdateBanner(editId, body);
      else await adminCreateBanner(body);
      setForm({ ...empty });
      setEditId(null);
      await load();
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }

  return (
    <AdminLayout title={t("admin.banners")}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="rounded-lg border border-line bg-surface p-4 mb-6 grid md:grid-cols-2 gap-3">
        {(
          [
            ["titleVi", zh ? "标题 VI" : "Tiêu đề VI"],
            ["titleZh", zh ? "标题 ZH" : "Tiêu đề ZH"],
            ["imageUrl", "Image URL"],
            ["linkUrl", "Link URL"],
            ["dramaId", "Drama ID"],
            ["sortOrder", "Sort"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="text-caption text-ink-muted">
            {label}
            <input
              className="block mt-1 w-full rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
              value={(form as any)[k]}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  [k]: k === "sortOrder" ? Number(e.target.value) : e.target.value,
                }))
              }
            />
          </label>
        ))}
        <label className="text-caption text-ink-muted">
          Start
          <input
            type="datetime-local"
            className="block mt-1 w-full rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={form.startAt}
            onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          End
          <input
            type="datetime-local"
            className="block mt-1 w-full rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={form.endAt}
            onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
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
            {editId ? t("admin.update") : t("admin.create")}
          </button>
          {editId ? (
            <button
              type="button"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={() => {
                setEditId(null);
                setForm({ ...empty });
              }}
            >
              {t("admin.cancel")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">{zh ? "标题" : "Tiêu đề"}</th>
              <th className="px-3 py-2">Schedule</th>
              <th className="px-3 py-2">Sort</th>
              <th className="px-3 py-2">On</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-muted">
                  {t("admin.empty")}
                </td>
              </tr>
            ) : null}
            {(Array.isArray(rows) ? rows : []).map((r) => (
              <tr key={String(r.id)} className="border-t border-line">
                <td className="px-3 py-2">{String(r.id)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {r.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.imageUrl} alt="" className="w-12 h-8 object-cover rounded" />
                    ) : null}
                    <span>{zh ? r.titleZh || r.titleVi : r.titleVi}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-caption">
                  {fmtDate(r.startAt)} → {fmtDate(r.endAt)}
                </td>
                <td className="px-3 py-2">{r.sortOrder}</td>
                <td className="px-3 py-2">{r.isActive ? "✓" : "—"}</td>
                <td className="px-3 py-2 space-x-2">
                  <button
                    type="button"
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                    onClick={() => {
                      setEditId(String(r.id));
                      setForm({
                        titleVi: r.titleVi || "",
                        titleZh: r.titleZh || "",
                        imageUrl: r.imageUrl || "",
                        linkUrl: r.linkUrl || "",
                        dramaId: r.dramaId ? String(r.dramaId) : "",
                        startAt: new Date(r.startAt).toISOString().slice(0, 16),
                        endAt: new Date(r.endAt).toISOString().slice(0, 16),
                        sortOrder: r.sortOrder ?? 0,
                        isActive: !!r.isActive,
                      });
                    }}
                  >
                    {t("admin.edit")}
                  </button>
                  <button
                    type="button"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={async () => {
                      if (!confirm(t("admin.delete") + "?")) return;
                      try {
                        await adminDeleteBanner(String(r.id));
                        await load();
                      } catch (e: any) {
                        setErr(e?.message || "failed");
                      }
                    }}
                  >
                    {t("admin.delete")}
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
