"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { adminListUsers } from "@/lib/api";
import { adminPath } from "@/lib/admin-path";
import { AdminLayout, fmtDate, fmtNum } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminUsersPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await adminListUsers({ q, status, page: 1, pageSize: 40 });
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [q, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={zh ? "用户 CRM" : "CRM người dùng"}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-56"
          placeholder="email / phone / nick"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["ALL", "ACTIVE", "SUSPENDED", "BANNED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="button" className={buttonVariants({ size: "sm" })} onClick={load}>
          {zh ? "查询" : "Tìm"}
        </button>
      </div>
      <p className="text-caption text-ink-muted mb-2">
        {zh ? "共" : "Tổng"} {total}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Locale</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Credits</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)} className="border-t border-line">
                <td className="px-3 py-2 tabular-nums">{String(r.id)}</td>
                <td className="px-3 py-2">
                  <div>{r.nickname || "—"}</div>
                  <div className="text-caption text-ink-muted">{r.email || r.phone}</div>
                </td>
                <td className="px-3 py-2">{r.locale}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.wallet?.balanceCredits)}</td>
                <td className="px-3 py-2 text-caption">{fmtDate(r.createdAt)}</td>
                <td className="px-3 py-2">
                  <Link
                    href={adminPath(`/users/${r.id}`)}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    {zh ? "详情" : "Chi tiết"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
