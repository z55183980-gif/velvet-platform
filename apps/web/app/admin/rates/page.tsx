"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { adminListAuditLogs, adminListRates, adminSetRate } from "@/lib/api";
import { AdminLayout, fmtDate } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminRatesPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [rates, setRates] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [currency, setCurrency] = useState("VND");
  const [cnyToFiat, setCnyToFiat] = useState(3500);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [r, h] = await Promise.all([
        adminListRates(),
        adminListAuditLogs({ action: "exchangeRate.upsert", pageSize: 30 }),
      ]);
      setRates(Array.isArray(r) ? r : r?.rows || r || []);
      setHistory(h?.rows || h || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const preview = (10 * cnyToFiat).toLocaleString(zh ? "zh-CN" : "vi-VN");

  return (
    <AdminLayout title={t("admin.rates")}>
      <p className="text-body-sm text-ink-muted mb-4">
        {zh
          ? "含义：1 人民币 = N 该币种。例：1 CNY = 3500 VND → ¥10 套餐应付 35000 VND，到账积分仍以套餐为准。"
          : "1 CNY = N đơn vị tiền tệ. Ví dụ 1 CNY = 3500 VND → gói ¥10 = 35000 VND."}
      </p>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      <div className="rounded-lg border border-line bg-surface p-4 mb-6 flex flex-wrap gap-2 items-end">
        <label className="text-caption text-ink-muted">
          Currency
          <input
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-28"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {zh ? "1 CNY =" : "1 CNY ="}
          <input
            type="number"
            step="any"
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-36"
            value={cnyToFiat}
            onChange={(e) => setCnyToFiat(Number(e.target.value))}
          />
        </label>
        <p className="text-caption text-ink-subtle pb-2">
          {zh ? `预览：¥10 ≈ ${preview} ${currency}` : `Xem: ¥10 ≈ ${preview} ${currency}`}
        </p>
        <button
          type="button"
          className={buttonVariants({ size: "sm" })}
          onClick={async () => {
            try {
              await adminSetRate({ currency, cnyToFiat, sellRate: cnyToFiat });
              await load();
            } catch (e: any) {
              setErr(e?.message || "failed");
            }
          }}
        >
          {zh ? "保存" : "Lưu"}
        </button>
      </div>

      <h2 className="text-h4 mb-2">{zh ? "当前汇率" : "Tỷ giá hiện tại"}</h2>
      <div className="overflow-x-auto rounded-lg border border-line mb-8">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">Currency</th>
              <th className="px-3 py-2">{zh ? "1 CNY =" : "1 CNY ="}</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(rates) ? rates : []).map((r: any) => (
              <tr key={r.currency || r.id} className="border-t border-line">
                <td className="px-3 py-2">{r.currency}</td>
                <td className="px-3 py-2 tabular-nums">
                  {String(r.cnyToFiat ?? r.buyRate)}
                </td>
                <td className="px-3 py-2 text-caption">{fmtDate(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-h4 mb-2">{zh ? "变更历史（审计）" : "Lịch sử (audit)"}</h2>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Payload</th>
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(history) ? history : []).map((h: any) => (
              <tr key={String(h.id)} className="border-t border-line">
                <td className="px-3 py-2 text-caption">{fmtDate(h.createdAt)}</td>
                <td className="px-3 py-2">{h.action}</td>
                <td className="px-3 py-2 text-caption font-mono max-w-lg truncate">
                  {JSON.stringify(h.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
