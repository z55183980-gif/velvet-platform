"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { adminDownloadCsv, adminListReconciliations, adminRerunReconcile } from "@/lib/api";
import { AdminLayout, fmtDate } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminReconcilePage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(1);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await adminListReconciliations(1, 50);
      setRows(data.rows || data || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={t("admin.reconcile")}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <input
          type="number"
          min={1}
          max={30}
          className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-20"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <button
          type="button"
          disabled={busy}
          className={buttonVariants({ size: "sm" })}
          onClick={async () => {
            setBusy(true);
            try {
              await adminRerunReconcile(days);
              await load();
            } catch (e: any) {
              setErr(e?.message || "failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {zh ? "重新对账" : "Chạy lại"}
        </button>
        <button type="button" className={buttonVariants({ variant: "secondary", size: "sm" })} onClick={load}>
          {t("admin.refresh")}
        </button>
        <button
          type="button"
          disabled={exporting}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          onClick={async () => {
            setExporting(true);
            try {
              await adminDownloadCsv("reconciliations");
            } catch (e: any) {
              setErr(e?.message || "export failed");
            } finally {
              setExporting(false);
            }
          }}
        >
          {t("admin.exportCsv")}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Local</th>
              <th className="px-3 py-2">Remote</th>
              <th className="px-3 py-2">Diff</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(rows) ? rows : []).map((r: any) => (
              <tr
                key={String(r.id || `${r.date}-${r.provider}`)}
                className={`border-t border-line ${r.status === "mismatch" ? "bg-warning/10" : ""}`}
              >
                <td className="px-3 py-2">{r.date || r.reconcileDate || "—"}</td>
                <td className="px-3 py-2">{r.provider}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2">{r.localPaidCnt ?? r.localCount ?? "—"}</td>
                <td className="px-3 py-2">{r.remotePaidCnt ?? r.remoteCount ?? "—"}</td>
                <td className="px-3 py-2 text-caption font-mono max-w-xs truncate">
                  {typeof r.diff === "object" ? JSON.stringify(r.diff) : String(r.diff ?? "—")}
                </td>
                <td className="px-3 py-2 text-caption">{fmtDate(r.updatedAt || r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
