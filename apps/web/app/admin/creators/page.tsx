"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { adminListCreators } from "@/lib/api";
import { AdminLayout, fmtNum } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";
import { adminPath } from "@/lib/admin-path";

export default function AdminCreatorsPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState("ALL");
  const [sort, setSort] = useState("available");
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await adminListCreators({ q, kyc, sort, page: 1, pageSize: 40 });
      setRows(data.rows || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [q, kyc, sort]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={zh ? "创作者收益" : "Thu nhập creator"}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-48"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="name / email"
        />
        <select
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
          value={kyc}
          onChange={(e) => setKyc(e.target.value)}
        >
          {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
            <option key={s} value={s}>
              KYC {s}
            </option>
          ))}
        </select>
        <select
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {["available", "pending", "withdrawn", "total"].map((s) => (
            <option key={s} value={s}>
              sort: {s}
            </option>
          ))}
        </select>
        <button type="button" className={buttonVariants({ size: "sm" })} onClick={load}>
          {zh ? "查询" : "Tìm"}
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">Creator</th>
              <th className="px-3 py-2">KYC</th>
              <th className="px-3 py-2">{zh ? "可提现" : "Available"}</th>
              <th className="px-3 py-2">{zh ? "冻结中" : "Pending"}</th>
              <th className="px-3 py-2">{zh ? "已提现" : "Withdrawn"}</th>
              <th className="px-3 py-2">{zh ? "累计" : "Total"}</th>
              <th className="px-3 py-2">Dramas</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)} className="border-t border-line">
                <td className="px-3 py-2">
                  <div>{r.displayName}</div>
                  <div className="text-caption text-ink-muted">{r.user?.email || r.user?.phone}</div>
                </td>
                <td className="px-3 py-2">{r.kycStatus}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.earnings?.availableVnd)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.earnings?.pendingVnd)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.earnings?.withdrawnVnd)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.earnings?.totalEarnedVnd)}</td>
                <td className="px-3 py-2">{r._count?.dramas ?? "—"}</td>
                <td className="px-3 py-2">
                  <Link
                    href={adminPath(`/creators/${r.id}`)}
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
