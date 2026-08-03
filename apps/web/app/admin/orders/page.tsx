"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  adminApproveRefund,
  adminDownloadCsv,
  adminListOrders,
  adminListRefunds,
  adminMarkPaid,
  adminRefuseRefund,
} from "@/lib/api";
import { AdminLayout, fmtDate, fmtNum } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminOrdersPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [tab, setTab] = useState<"orders" | "refunds">("orders");
  const [rows, setRows] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [status, setStatus] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [method, setMethod] = useState("ALL");
  const [err, setErr] = useState<string | null>(null);
  const [markRef, setMarkRef] = useState<Record<string, string>>({});
  const [refuseReason, setRefuseReason] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      if (tab === "orders") {
        const data = await adminListOrders({ status, type, method, page: 1, pageSize: 40 });
        setRows(data.rows || []);
      } else {
        const data = await adminListRefunds(1, 40);
        setRefunds(data.rows || []);
      }
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [tab, status, type, method]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={t("admin.orders")}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <button
          type="button"
          className={buttonVariants({ variant: tab === "orders" ? "primary" : "secondary", size: "sm" })}
          onClick={() => setTab("orders")}
        >
          {zh ? "订单" : "Đơn"}
        </button>
        <button
          type="button"
          className={buttonVariants({ variant: tab === "refunds" ? "primary" : "secondary", size: "sm" })}
          onClick={() => setTab("refunds")}
        >
          {t("admin.refunds")}
        </button>
        <button
          type="button"
          disabled={exporting}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          onClick={async () => {
            setExporting(true);
            try {
              await adminDownloadCsv("orders");
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

      {tab === "orders" ? (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {["ALL", "PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {["ALL", "TOPUP", "EPISODE_UNLOCK", "VIP_SUB", "DRAMA_BUYOUT"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {[
                "ALL",
                "BANK_TRANSFER",
                "VIETQR",
                "ALIPAY",
                "WECHAT",
                "STRIPE",
                "WALLET",
                "MOMO",
                "ZALOPAY",
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-body-sm">
              <thead className="bg-surface-2 text-ink-muted text-left">
                <tr>
                  <th className="px-3 py-2">orderNo</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">{t("admin.users")}</th>
                  <th className="px-3 py-2">₫ / credits</th>
                  <th className="px-3 py-2">Pay</th>
                  <th className="px-3 py-2">{t("admin.status")}</th>
                  <th className="px-3 py-2">{t("admin.time")}</th>
                  <th className="px-3 py-2">{t("admin.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-ink-muted">
                      {t("admin.empty")}
                    </td>
                  </tr>
                ) : null}
                {rows.map((r) => (
                  <tr key={r.orderNo} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-caption">{r.orderNo}</td>
                    <td className="px-3 py-2">{r.orderType}</td>
                    <td className="px-3 py-2">{r.user?.email || r.user?.phone || String(r.userId)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {fmtNum(r.amountVnd)} / {fmtNum(r.amountCredits)}
                    </td>
                    <td className="px-3 py-2">{r.paymentMethod}</td>
                    <td className="px-3 py-2">{r.paymentStatus}</td>
                    <td className="px-3 py-2 text-caption">{fmtDate(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      {r.paymentStatus === "PENDING" ? (
                        <div className="flex gap-1 items-center">
                          <input
                            className="w-28 rounded bg-surface-2 border border-line px-2 py-1 text-caption"
                            placeholder="externalRef"
                            value={markRef[r.orderNo] || ""}
                            onChange={(e) =>
                              setMarkRef((m) => ({ ...m, [r.orderNo]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className={buttonVariants({ size: "sm" })}
                            onClick={async () => {
                              try {
                                await adminMarkPaid(r.orderNo, markRef[r.orderNo] || "manual");
                                await load();
                              } catch (e: any) {
                                setErr(e?.message || "failed");
                              }
                            }}
                          >
                            {zh ? "入账" : "Mark paid"}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-body-sm">
            <thead className="bg-surface-2 text-ink-muted text-left">
              <tr>
                <th className="px-3 py-2">orderNo</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Credits</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.orderNo} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-caption">{r.orderNo}</td>
                  <td className="px-3 py-2">{r.orderType}</td>
                  <td className="px-3 py-2">{r.user?.email || r.user?.phone}</td>
                  <td className="px-3 py-2">{r.refundNote || "—"}</td>
                  <td className="px-3 py-2">{fmtNum(r.amountCredits)}</td>
                  <td className="px-3 py-2 space-x-2">
                    <button
                      type="button"
                      className={buttonVariants({ size: "sm" })}
                      onClick={async () => {
                        try {
                          await adminApproveRefund(r.orderNo);
                          await load();
                        } catch (e: any) {
                          setErr(e?.message || "failed");
                        }
                      }}
                    >
                      {zh ? "批准" : "Duyệt"}
                    </button>
                    <input
                      className="w-32 rounded bg-surface-2 border border-line px-2 py-1 text-caption"
                      placeholder={zh ? "拒绝理由" : "Lý do từ chối"}
                      value={refuseReason[r.orderNo] || ""}
                      onChange={(e) =>
                        setRefuseReason((m) => ({ ...m, [r.orderNo]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className={buttonVariants({ variant: "secondary", size: "sm" })}
                      onClick={async () => {
                        try {
                          await adminRefuseRefund(r.orderNo, refuseReason[r.orderNo] || "");
                          await load();
                        } catch (e: any) {
                          setErr(e?.message || "failed");
                        }
                      }}
                    >
                      {zh ? "拒绝" : "Từ chối"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!refunds.length ? (
            <p className="p-4 text-ink-muted text-body-sm">
              {zh ? "暂无退款工单" : "Không có yêu cầu hoàn"}
            </p>
          ) : null}
        </div>
      )}
    </AdminLayout>
  );
}
