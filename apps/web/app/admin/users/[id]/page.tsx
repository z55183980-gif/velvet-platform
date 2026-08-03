"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { adminForceLogout, adminGetUser, adminSetUserStatus, adminSetUserVip, adminWalletAdjust } from "@/lib/api";
import { AdminLayout, fmtDate, fmtNum } from "@/components/admin/AdminLayout";
import { buttonVariants } from "@/components/ui/button";
import { adminPath } from "@/lib/admin-path";

export default function AdminUserDetailPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const id = String(useParams().id);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [delta, setDelta] = useState(0);
  const [adjReason, setAdjReason] = useState("");
  const [extendDays, setExtendDays] = useState(30);
  const [vipDate, setVipDate] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await adminGetUser(id));
    } catch (e: any) {
      setErr(e?.message || "failed");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const user = data?.user;

  return (
    <AdminLayout title={user?.nickname || user?.email || (zh ? "用户详情" : "Chi tiết user")}>
      <Link href={adminPath("/users")} className="text-body-sm text-ink-muted hover:text-ink mb-4 inline-block">
        ← {zh ? "返回" : "Quay lại"}
      </Link>
      {err ? <p className="text-danger text-body-sm mb-3">{err}</p> : null}
      {user ? (
        <>
          <div className="rounded-lg border border-line bg-surface p-4 mb-6 text-body-sm space-y-2">
            <p>
              ID {String(user.id)} · {user.email || "—"} · {user.phone || "—"} · {user.locale} ·{" "}
              <strong>{user.status}</strong>
            </p>
            <p>
              {zh ? "余额" : "Số dư"} {fmtNum(user.wallet?.balanceCredits)} credits ·{" "}
              {zh ? "累计充值" : "Nạp"} {fmtNum(user.wallet?.totalRechargedCredits)} ·{" "}
              {zh ? "累计消费" : "Chi"} {fmtNum(user.wallet?.totalSpentCredits)}
            </p>
            <p className="text-caption text-ink-muted">{fmtDate(user.createdAt)}</p>
            <div className="flex flex-wrap gap-2 items-center pt-2">
              <input
                className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-56"
                placeholder={zh ? "操作理由" : "Lý do"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                type="button"
                className={buttonVariants({ size: "sm" })}
                onClick={async () => {
                  try {
                    await adminSetUserStatus(id, "ACTIVE", reason || "restore");
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                ACTIVE
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                onClick={async () => {
                  try {
                    await adminSetUserStatus(id, "SUSPENDED", reason);
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                SUSPEND
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                onClick={async () => {
                  try {
                    await adminSetUserStatus(id, "BANNED", reason);
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                BAN
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                onClick={async () => {
                  try {
                    await adminForceLogout(id);
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                {zh ? "强制登出" : "Force logout"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-line">
              <div className="w-full flex items-center justify-between gap-2 mb-1">
                <p className="text-body-sm font-medium">
                  VIP{" "}
                  <span
                    className={
                      user.vipExpireAt && new Date(user.vipExpireAt) > new Date()
                        ? "text-success"
                        : "text-ink-muted"
                    }
                  >
                    {user.vipExpireAt
                      ? fmtDate(user.vipExpireAt)
                      : zh
                        ? "未开通"
                        : "Chưa có"}
                  </span>
                </p>
              </div>
              <input
                type="number"
                className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-28"
                value={extendDays}
                onChange={(e) => setExtendDays(Number(e.target.value))}
                placeholder={zh ? "延长天数" : "Gia hạn ngày"}
              />
              <button
                type="button"
                className={buttonVariants({ size: "sm" })}
                onClick={async () => {
                  try {
                    await adminSetUserVip(id, { extendDays });
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                {zh ? "延长 VIP" : "Gia hạn VIP"}
              </button>
              <input
                type="datetime-local"
                className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm"
                value={vipDate}
                onChange={(e) => setVipDate(e.target.value)}
              />
              <button
                type="button"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                onClick={async () => {
                  try {
                    await adminSetUserVip(id, {
                      vipExpireAt: vipDate ? new Date(vipDate).toISOString() : null,
                    });
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                {zh ? "设置到期" : "Set hết hạn"}
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                onClick={async () => {
                  try {
                    await adminSetUserVip(id, { vipExpireAt: null });
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                {zh ? "清空 VIP" : "Xóa VIP"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-line">
              <input
                type="number"
                className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-28"
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
                placeholder="±credits"
              />
              <input
                className="rounded-md bg-surface-2 border border-line px-3 py-2 text-body-sm w-48"
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder={zh ? "调账理由" : "Lý do điều chỉnh"}
              />
              <button
                type="button"
                className={buttonVariants({ size: "sm" })}
                onClick={async () => {
                  try {
                    await adminWalletAdjust(id, delta, adjReason);
                    await load();
                  } catch (e: any) {
                    setErr(e?.message || "failed");
                  }
                }}
              >
                {zh ? "调账" : "Điều chỉnh ví"}
              </button>
            </div>
          </div>

          <Section title={zh ? "近期流水" : "Giao dịch gần đây"} rows={data.transactions} cols={["type", "amountCredits", "balanceAfter", "remark", "createdAt"]} />
          <Section title={zh ? "订单" : "Đơn hàng"} rows={data.orders} cols={["orderNo", "orderType", "paymentStatus", "amountVnd", "createdAt"]} />
          <Section title={zh ? "会话" : "Sessions"} rows={data.user?.sessions || []} cols={["id", "ipAddress", "createdAt", "expiresAt"]} />
        </>
      ) : null}
    </AdminLayout>
  );
}

function Section({ title, rows, cols }: { title: string; rows: any[]; cols: string[] }) {
  if (!rows?.length) return null;
  return (
    <div className="mb-6">
      <h2 className="text-h4 mb-2">{title}</h2>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-2 text-ink-muted text-left">
            <tr>
              {cols.map((c) => (
                <th key={c} className="px-3 py-2">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r, i) => (
              <tr key={i} className="border-t border-line">
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2 text-caption max-w-[200px] truncate">
                    {c.includes("At") || c === "expiresAt"
                      ? fmtDate(r[c])
                      : c.includes("amount") || c.includes("balance") || c.includes("Credits") || c.includes("Vnd")
                        ? fmtNum(r[c])
                        : String(r[c] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
