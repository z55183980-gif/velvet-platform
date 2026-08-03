"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  adminCreateRedeemBatch,
  adminExportRedeemBatchCsv,
  adminListRedeemBatches,
  adminListRedemptions,
  adminVoidRedeemBatch,
} from "@/lib/api";
import { AdminLayout, fmtDate } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminRedeemCodesPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [batches, setBatches] = useState<any[]>([]);
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [createdCodes, setCreatedCodes] = useState<string[] | null>(null);
  const [type, setType] = useState<"VIP" | "CREDITS">("VIP");
  const [vipDays, setVipDays] = useState(30);
  const [creditsAmount, setCreditsAmount] = useState(50);
  const [quantity, setQuantity] = useState(10);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [b, r] = await Promise.all([
        adminListRedeemBatches(1, 40),
        adminListRedemptions(1, 30),
      ]);
      setBatches(b.rows || []);
      setRedemptions(r.rows || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={t("admin.redeemCodes")}>
      <p className="text-body-sm text-ink-muted mb-4">
        {zh
          ? "批量生成 VIP 或积分卡密。明文仅在创建时展示一次，请立即复制或导出 CSV。"
          : "Tạo hàng loạt mã VIP/credits. Plaintext chỉ hiện 1 lần khi tạo — copy hoặc xuất CSV ngay."}
      </p>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}

      <div className="rounded-lg border border-line bg-surface p-4 mb-6 flex flex-wrap gap-2 items-end">
        <label className="text-caption text-ink-muted">
          {zh ? "名称" : "Tên"}
          <input
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-36"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-caption text-ink-muted">
          Type
          <select
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
            value={type}
            onChange={(e) => setType(e.target.value as any)}
          >
            <option value="VIP">VIP</option>
            <option value="CREDITS">CREDITS</option>
          </select>
        </label>
        {type === "VIP" ? (
          <label className="text-caption text-ink-muted">
            {zh ? "天数" : "Ngày"}
            <input
              type="number"
              className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-24"
              value={vipDays}
              onChange={(e) => setVipDays(Number(e.target.value))}
            />
          </label>
        ) : (
          <label className="text-caption text-ink-muted">
            Credits
            <input
              type="number"
              className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-24"
              value={creditsAmount}
              onChange={(e) => setCreditsAmount(Number(e.target.value))}
            />
          </label>
        )}
        <label className="text-caption text-ink-muted">
          Qty
          <input
            type="number"
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-20"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className={buttonVariants({ size: "sm" })}
          onClick={async () => {
            try {
              const r = await adminCreateRedeemBatch({
                name: name || undefined,
                type,
                vipDays: type === "VIP" ? vipDays : undefined,
                creditsAmount: type === "CREDITS" ? creditsAmount : undefined,
                quantity,
              });
              setCreatedCodes(r.codes || []);
              await load();
            } catch (e: any) {
              setErr(e?.message || "failed");
            }
          }}
        >
          {zh ? "生成" : "Tạo"}
        </button>
      </div>

      {createdCodes ? (
        <div className="mb-6 rounded-lg border border-line bg-surface p-4">
          <p className="text-body-sm font-medium mb-2">
            {zh ? "明文卡密（仅此一次）" : "Mã plaintext (một lần)"}
          </p>
          <textarea
            readOnly
            className="w-full h-32 rounded-md bg-surface-2 border border-line p-2 text-caption font-mono"
            value={createdCodes.join("\n")}
          />
          <button
            type="button"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            onClick={() => setCreatedCodes(null)}
          >
            {t("admin.cancel")}
          </button>
        </div>
      ) : null}

      <h2 className="text-h4 font-semibold mb-2">{zh ? "批次" : "Batches"}</h2>
      <div className="overflow-x-auto rounded-lg border border-line mb-8">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Unused/Used/Void</th>
              <th className="px-3 py-2">{t("admin.time")}</th>
              <th className="px-3 py-2">{t("admin.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="px-3 py-2">{b.id} {b.name || ""}</td>
                <td className="px-3 py-2">
                  {b.type}
                  {b.type === "VIP" ? ` ${b.vipDays}d` : ` ${b.creditsAmount}c`}
                </td>
                <td className="px-3 py-2">{b.quantity}</td>
                <td className="px-3 py-2">
                  {b.unused}/{b.used}/{b.voided}
                </td>
                <td className="px-3 py-2">{fmtDate(b.createdAt)}</td>
                <td className="px-3 py-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={async () => {
                      try {
                        await adminExportRedeemBatchCsv(b.id);
                      } catch (e: any) {
                        setErr(e?.message || "export failed");
                      }
                    }}
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={async () => {
                      try {
                        await adminVoidRedeemBatch(b.id);
                        await load();
                      } catch (e: any) {
                        setErr(e?.message || "failed");
                      }
                    }}
                  >
                    {zh ? "作废未用" : "Void unused"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-h4 font-semibold mb-2">{zh ? "兑换记录" : "Redemptions"}</h2>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">{t("admin.time")}</th>
            </tr>
          </thead>
          <tbody>
            {redemptions.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-caption">{r.code}</td>
                <td className="px-3 py-2">
                  {r.user?.nickname || r.user?.email || r.user?.id}
                </td>
                <td className="px-3 py-2">
                  {r.type}
                  {r.vipDays ? ` ${r.vipDays}d` : ""}
                  {r.creditsAmount ? ` ${r.creditsAmount}c` : ""}
                </td>
                <td className="px-3 py-2">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
