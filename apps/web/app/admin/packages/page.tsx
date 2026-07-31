"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  adminCreatePackage,
  adminListPackages,
  adminUpdatePackage,
} from "@/lib/api";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";

export default function AdminPackagesPage() {
  const { locale, t } = useLocale();
  const zh = locale === "zh";
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [credits, setCredits] = useState(10);
  const [basePrice, setBasePrice] = useState(10);
  const [sortOrder, setSortOrder] = useState(0);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await adminListPackages();
      setRows(Array.isArray(r) ? r : r?.rows || []);
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminLayout title={t("admin.packages")}>
      <p className="text-body-sm text-ink-muted mb-4">
        {zh
          ? "套餐以人民币定价；用户选其它币种时按「法币汇率」自动折算，到账积分不变。"
          : "Giá gốc theo CNY; tiền tệ khác quy đổi theo tỷ giá, credits không đổi."}
      </p>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}

      <div className="rounded-lg border border-line bg-surface p-4 mb-6 flex flex-wrap gap-2 items-end">
        <label className="text-caption text-ink-muted">
          {zh ? "名称" : "Tên"}
          <input
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-32"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={zh ? "超值" : "Ưu đãi"}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {zh ? "积分" : "Credits"}
          <input
            type="number"
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-28"
            value={credits}
            onChange={(e) => setCredits(Number(e.target.value))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {zh ? "人民币价" : "Giá CNY"}
          <input
            type="number"
            step="0.01"
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-28"
            value={basePrice}
            onChange={(e) => setBasePrice(Number(e.target.value))}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {zh ? "排序" : "Thứ tự"}
          <input
            type="number"
            className="block mt-1 rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-20"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className={buttonVariants({ size: "sm" })}
          onClick={async () => {
            try {
              await adminCreatePackage({
                name: name.trim() || undefined,
                credits,
                basePrice,
                sortOrder,
                active: true,
              });
              setName("");
              await load();
            } catch (e: any) {
              setErr(e?.message || "failed");
            }
          }}
        >
          {zh ? "新增套餐" : "Thêm gói"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">{zh ? "名称" : "Tên"}</th>
              <th className="px-3 py-2">{zh ? "积分" : "Credits"}</th>
              <th className="px-3 py-2">{zh ? "人民币" : "CNY"}</th>
              <th className="px-3 py-2">{zh ? "排序" : "Sort"}</th>
              <th className="px-3 py-2">{zh ? "启用" : "Active"}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-caption">{r.id}</td>
                <td className="px-3 py-2">{r.name || "—"}</td>
                <td className="px-3 py-2 tabular-nums">{r.credits}</td>
                <td className="px-3 py-2 tabular-nums">¥{r.basePrice}</td>
                <td className="px-3 py-2">{r.sortOrder}</td>
                <td className="px-3 py-2">{r.active ? (zh ? "是" : "Có") : (zh ? "否" : "Không")}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    onClick={async () => {
                      try {
                        await adminUpdatePackage(String(r.id), { active: !r.active });
                        await load();
                      } catch (e: any) {
                        setErr(e?.message || "failed");
                      }
                    }}
                  >
                    {r.active ? (zh ? "停用" : "Tắt") : (zh ? "启用" : "Bật")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
