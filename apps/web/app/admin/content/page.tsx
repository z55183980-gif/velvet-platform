"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { adminListCategories, adminListDramas } from "@/lib/api";
import { AdminLayout, fmtNum } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";
import { adminPath } from "@/lib/admin-path";

const STATUSES = ["ALL", "DRAFT", "PENDING_REVIEW", "LIVE", "OFFLINE", "REJECTED"] as const;

export default function AdminContentPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [categorySlug, setCategorySlug] = useState("");
  const [isOfficial, setIsOfficial] = useState("");
  const [isFeatured, setIsFeatured] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [cats, setCats] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get("status");
    if (s) setStatus(s);
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [list, categories] = await Promise.all([
        adminListDramas({
          q,
          status,
          categorySlug: categorySlug || undefined,
          isOfficial: isOfficial || undefined,
          isFeatured: isFeatured || undefined,
          page,
          pageSize: 20,
        }),
        adminListCategories(true),
      ]);
      setRows(list.rows || []);
      setTotal(list.total || 0);
      setCats(Array.isArray(categories) ? categories : []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [q, status, categorySlug, isOfficial, isFeatured, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={t("admin.content")}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <label className="text-caption text-ink-muted">
          {t("admin.search")}
          <input
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-48"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="title / slug / creator"
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("admin.status")}
          <select
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption text-ink-muted">
          {zh ? "分类" : "Thể loại"}
          <select
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={categorySlug}
            onChange={(e) => {
              setPage(1);
              setCategorySlug(e.target.value);
            }}
          >
            <option value="">{zh ? "全部" : "Tất cả"}</option>
            {Array.isArray(cats) &&
              cats.map((c) => (
              <option key={c.slug} value={c.slug}>
                {zh ? c.nameZh : c.nameVi}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption text-ink-muted">
          Official
          <select
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={isOfficial}
            onChange={(e) => setIsOfficial(e.target.value)}
          >
            <option value="">—</option>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </label>
        <label className="text-caption text-ink-muted">
          Featured
          <select
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={isFeatured}
            onChange={(e) => setIsFeatured(e.target.value)}
          >
            <option value="">—</option>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </label>
        <button
          type="button"
          className={buttonVariants({ size: "sm" })}
          onClick={() => {
            setPage(1);
            load();
          }}
        >
          {zh ? "查询" : "Lọc"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">{zh ? "标题" : "Tiêu đề"}</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">{zh ? "创作者" : "Creator"}</th>
              <th className="px-3 py-2">Views / Unlock</th>
              <th className="px-3 py-2">Flags</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)} className="border-t border-line hover:bg-surface-2/50">
                <td className="px-3 py-2 tabular-nums">{String(r.id)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{zh ? r.titleZh || r.titleVi : r.titleVi}</div>
                  <div className="text-caption text-ink-muted">{r.slug}</div>
                </td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2">{r.creator?.displayName || "—"}</td>
                <td className="px-3 py-2 tabular-nums">
                  {fmtNum(r.viewCount)} / {fmtNum(r.unlockCount)}
                </td>
                <td className="px-3 py-2 text-caption">
                  {r.isOfficial ? "OFF " : ""}
                  {r.isFeatured ? "FEAT " : ""}
                  w={r.sortWeight ?? 0}
                </td>
                <td className="px-3 py-2">
                  <Link href={adminPath(`/content/${r.id}`)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    {zh ? "详情" : "Chi tiết"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3 text-body-sm text-ink-muted">
        <span>
          {zh ? "共" : "Tổng"} {total}
        </span>
        <button
          type="button"
          disabled={page <= 1}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ‹
        </button>
        <span>{page}</span>
        <button
          type="button"
          disabled={page * 20 >= total}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          onClick={() => setPage((p) => p + 1)}
        >
          ›
        </button>
      </div>
    </AdminLayout>
  );
}
