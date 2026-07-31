"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { adminApproveWithdraw, adminDownloadCsv, adminListWithdraws, adminRejectWithdraw } from "@/lib/api";
import { AdminLayout, fmtDate, fmtNum, hoursAgo } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminWithdrawsPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [status, setStatus] = useState("PENDING");
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = new URLSearchParams(window.location.search).get("status");
    if (s) setStatus(s);
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await adminListWithdraws({ status, page: 1, pageSize: 50 });
      setRows(data.rows || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={t("admin.withdraws")}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
      <select
        className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        {["ALL", "PENDING", "APPROVED", "PAID", "REJECTED", "CANCELLED"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
        <button
          type="button"
          disabled={exporting}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          onClick={async () => {
            setExporting(true);
            try {
              await adminDownloadCsv("withdraws");
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
              <th className="px-3 py-2">No</th>
              <th className="px-3 py-2">{t("admin.creators")}</th>
              <th className="px-3 py-2">{zh ? "申请额" : "Số tiền"}</th>
              <th className="px-3 py-2">{zh ? "税后" : "Sau thuế"}</th>
              <th className="px-3 py-2">{t("admin.status")}</th>
              <th className="px-3 py-2">{t("admin.time")}</th>
              <th className="px-3 py-2">{t("admin.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ink-muted">
                  {t("admin.empty")}
                </td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const overdue = r.status === "PENDING" && hoursAgo(r.createdAt) > 24;
              const pit = Number(r.pitVnd ?? Math.floor(Number(r.amountVnd) * 0.05));
              const net = Number(r.netVnd ?? Number(r.amountVnd) - pit);
              return (
                <tr
                  key={String(r.id)}
                  className={`border-t border-line ${overdue ? "bg-danger/10" : ""}`}
                >
                  <td className="px-3 py-2 font-mono text-caption">{r.requestNo}</td>
                  <td className="px-3 py-2">{r.creator?.displayName}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtNum(r.amountVnd)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {fmtNum(net)}
                    <span className="text-caption text-ink-muted ml-1">
                      (PIT {fmtNum(pit)})
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.status}
                    {overdue ? (
                      <span className="ml-1 text-danger text-caption">{t("admin.slaWarn")}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-caption">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    {r.status === "PENDING" ? (
                      <div className="flex flex-wrap gap-1 items-center">
                        <button
                          type="button"
                          className={buttonVariants({ size: "sm" })}
                          onClick={async () => {
                            try {
                              await adminApproveWithdraw(String(r.id));
                              await load();
                            } catch (e: any) {
                              setErr(e?.message || "failed");
                            }
                          }}
                        >
                          {t("admin.approve")}
                        </button>
                        <input
                          className="w-36 rounded bg-surface-2 border border-line px-2 py-1 text-caption"
                          placeholder={zh ? "拒绝理由" : "Lý do từ chối"}
                          value={reasons[String(r.id)] || ""}
                          onChange={(e) =>
                            setReasons((m) => ({ ...m, [String(r.id)]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className={buttonVariants({ variant: "secondary", size: "sm" })}
                          onClick={async () => {
                            try {
                              await adminRejectWithdraw(String(r.id), reasons[String(r.id)]);
                              await load();
                            } catch (e: any) {
                              setErr(e?.message || "failed");
                            }
                          }}
                        >
                          {t("admin.reject")}
                        </button>
                      </div>
                    ) : r.rejectReason ? (
                      <span className="text-caption text-ink-muted">{r.rejectReason}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
