"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { adminGetCreator } from "@/lib/api";
import { AdminLayout, fmtNum } from "@/components/admin/AdminLayout";
import { adminPath } from "@/lib/admin-path";

export default function AdminCreatorDetailPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const id = String(useParams().id);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await adminGetCreator(id));
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const c = data?.creator;
  const s = data?.summary;

  return (
    <AdminLayout title={c?.displayName || (zh ? "创作者详情" : "Chi tiết creator")}>
      <Link href={adminPath("/creators")} className="text-body-sm text-ink-muted hover:text-ink mb-4 inline-block">
        ← {zh ? "返回" : "Quay lại"}
      </Link>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      {c ? (
        <>
          <div className="rounded-lg border border-line bg-surface p-4 mb-6 text-body-sm space-y-2">
            <p>
              {c.displayName} · KYC {c.kycStatus} · {c.user?.email || c.user?.phone}
            </p>
            <p>
              available {fmtNum(c.earnings?.availableVnd)} · pending {fmtNum(c.earnings?.pendingVnd)} ·
              withdrawn {fmtNum(c.earnings?.withdrawnVnd)} · total {fmtNum(c.earnings?.totalEarnedVnd)}
            </p>
            <p className="text-ink-muted">
              {zh ? "本月收入" : "Thu nhập tháng"} {fmtNum(s?.monthIncome)} · orders {s?.paidOrders} ·
              GMV {fmtNum(s?.gmvTotal)}
            </p>
          </div>
          <h2 className="text-h4 mb-2">{zh ? "按剧收益" : "Theo phim"}</h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-body-sm">
              <thead className="bg-surface-2 text-ink-muted text-left">
                <tr>
                  <th className="px-3 py-2">{zh ? "短剧" : "Phim"}</th>
                  <th className="px-3 py-2">{zh ? "创作者收入" : "Income"}</th>
                  <th className="px-3 py-2">GMV</th>
                  <th className="px-3 py-2">Orders</th>
                </tr>
              </thead>
              <tbody>
                {(data.perDrama || []).map((p: any, i: number) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-2">
                      {p.drama ? (
                        <Link href={adminPath(`/content/${p.drama.id}`)} className="hover:text-brand">
                          {zh ? p.drama.titleZh || p.drama.titleVi : p.drama.titleVi}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtNum(p.incomeVnd)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtNum(p.amountVnd)}</td>
                    <td className="px-3 py-2">{p.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </AdminLayout>
  );
}
