"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { adminWalletAdjust, adminWalletLedger } from "@/lib/api";
import { AdminLayout, fmtDate, fmtNum } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminWalletPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [userId, setUserId] = useState("");
  const [type, setType] = useState("ALL");
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await adminWalletLedger({
        userId: userId || undefined,
        type,
        page: 1,
        pageSize: 50,
      });
      setRows(data.rows || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [userId, type]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={zh ? "钱包 / 积分流水" : "Ví / Ledger"}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <label className="text-caption text-ink-muted">
          userId
          <input
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-40"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </label>
        <label className="text-caption text-ink-muted">
          type
          <select
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {["ALL", "TOPUP", "UNLOCK", "REFUND", "ADJUST"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonVariants({ size: "sm" })} onClick={load}>
          {zh ? "查询" : "Tìm"}
        </button>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 mb-6 flex flex-wrap gap-2 items-end">
        <p className="w-full text-body-sm font-medium">{zh ? "人工调账（SUPER_ADMIN）" : "Điều chỉnh thủ công"}</p>
        <input
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-32"
          placeholder="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <input
          type="number"
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-28"
          value={delta}
          onChange={(e) => setDelta(Number(e.target.value))}
        />
        <input
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-56"
          placeholder={zh ? "理由" : "Lý do"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          type="button"
          className={buttonVariants({ size: "sm" })}
          onClick={async () => {
            try {
              await adminWalletAdjust(userId, delta, reason);
              await load();
            } catch (e: any) {
              setErr(e?.message || "failed");
            }
          }}
        >
          {zh ? "提交调账" : "Submit"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Δ</th>
              <th className="px-3 py-2">After</th>
              <th className="px-3 py-2">Remark</th>
              <th className="px-3 py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)} className="border-t border-line">
                <td className="px-3 py-2">{String(r.id)}</td>
                <td className="px-3 py-2">{String(r.walletUserId)}</td>
                <td className="px-3 py-2">{r.type}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.amountCredits)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.balanceAfter)}</td>
                <td className="px-3 py-2 text-caption max-w-xs truncate">{r.remark || "—"}</td>
                <td className="px-3 py-2 text-caption">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
