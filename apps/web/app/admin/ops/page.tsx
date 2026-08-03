"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { adminOpsDramaSales, adminOpsSummary } from "@/lib/api";
import { AdminLayout, fmtNum } from "@/components/admin/AdminLayout";

export default function AdminOpsPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [summary, setSummary] = useState<any>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, d] = await Promise.all([adminOpsSummary(), adminOpsDramaSales(undefined, undefined, 30)]);
      setSummary(s);
      setSales(Array.isArray(d) ? d : []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={t("admin.ops")}>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {[
            {
              label: zh ? "有效 VIP 用户" : "Active VIP",
              value: summary.activeVipUsers,
              hint: zh ? "vipExpireAt > now" : "vipExpireAt > now",
            },
            {
              label: zh ? "充值笔数 / 积分" : "Topup / credits",
              value: `${summary.topup?.count ?? 0} / ${fmtNum(summary.topup?.credits)}`,
              hint: zh ? "TOPUP 已支付" : "TOPUP paid",
            },
            {
              label: zh ? "VIP 订单 / VND" : "VIP / VND",
              value: `${summary.vip?.count ?? 0} / ${fmtNum(summary.vip?.amountVnd)}`,
              hint: zh ? "VIP_SUB 已支付" : "VIP_SUB paid",
            },
            {
              label: zh ? "解锁+买断 / 积分" : "Unlock+buyout / credits",
              value: `${(summary.unlock?.count ?? 0) + (summary.dramaBuyout?.count ?? 0)} / ${fmtNum(
                String(Number(summary.unlock?.credits || 0) + Number(summary.dramaBuyout?.credits || 0)),
              )}`,
              hint: zh ? "EPISODE_UNLOCK + DRAMA_BUYOUT" : "unlock + buyout",
            },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-line bg-surface p-4">
              <p className="text-caption text-ink-muted">{c.label}</p>
              <p className="mt-2 text-h4 font-semibold tabular-nums">{c.value}</p>
              <p className="mt-1 text-caption text-ink-subtle">{c.hint}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-body-sm text-ink-muted mb-6">{t("admin.loading")}</p>
      )}

      <h2 className="text-h4 font-semibold mb-2">{zh ? "剧目销售排行" : "Drama sales"}</h2>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">{zh ? "剧目" : "Drama"}</th>
              <th className="px-3 py-2">{zh ? "订单数" : "Orders"}</th>
              <th className="px-3 py-2">Credits</th>
              <th className="px-3 py-2">VND</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((r) => (
              <tr key={r.dramaId} className="border-t border-line">
                <td className="px-3 py-2">
                  {zh ? r.titleZh || r.titleVi : r.titleVi || r.titleZh}{" "}
                  <span className="text-caption text-ink-muted">#{r.dramaId}</span>
                </td>
                <td className="px-3 py-2">{r.orderCount}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.credits)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.amountVnd)}</td>
              </tr>
            ))}
            {!sales.length ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-ink-muted">
                  {t("admin.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
