"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminForceLogout, adminGetUser, adminSetUserStatus, adminSetUserVip, adminWalletAdjust } from "@velvet/api-client";
import { Button, DataTable, Input, StatCard, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";

type RecordRow = { id?: string | number; [key: string]: unknown };
type User = {
  id: string | number; nickname?: string; email?: string; phone?: string; locale?: string; status?: string;
  createdAt?: string; vipExpireAt?: string | null;
  wallet?: { balanceCredits?: number; totalRechargedCredits?: number; totalSpentCredits?: number };
  sessions?: RecordRow[];
};
type Detail = { user?: User; transactions?: RecordRow[]; orders?: RecordRow[] };

function Section({ title, rows, fields }: { title: string; rows?: RecordRow[]; fields: string[] }) {
  const columns: Column<RecordRow>[] = fields.map((field) => ({
    key: field,
    header: field,
    cell: (row) => {
      const value = row[field];
      if (field.includes("At") || field === "expiresAt") return fmtDate(value as string);
      if (/amount|balance|Credits|Vnd/i.test(field)) return fmtNum(value as number);
      return String(value ?? "—");
    },
  }));
  if (!rows?.length) return null;
  return <div className="mb-6"><h2 className="mb-2 text-h4">{title}</h2><DataTable columns={columns} rows={rows.slice(0, 15)} /></div>;
}

export default function AdminUserDetailPage() {
  const id = String(useParams().id);
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [delta, setDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const [extendDays, setExtendDays] = useState(30);
  const [vipDate, setVipDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const detailQ = useQuery({ queryKey: ["admin", "user", id], queryFn: () => adminGetUser(id) as Promise<Detail> });
  const actionMut = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "user", id] });
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const act = (action: () => Promise<unknown>) => actionMut.mutate(action);
  const user = detailQ.data?.user;

  return (
    <AdminShell title={user?.nickname || user?.email || "用户详情"}>
      <Link href="/users" className="mb-4 inline-block text-body-sm text-ink-muted hover:text-ink">← 返回用户列表</Link>
      {error || detailQ.error ? <p className="mb-3 text-body-sm text-danger">{error || (detailQ.error as Error).message}</p> : null}
      {detailQ.isLoading ? <p className="text-ink-muted">加载中…</p> : null}
      {user ? (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard label="积分余额" value={fmtNum(user.wallet?.balanceCredits)} />
            <StatCard label="累计充值" value={fmtNum(user.wallet?.totalRechargedCredits)} />
            <StatCard label="累计消费" value={fmtNum(user.wallet?.totalSpentCredits)} />
          </div>
          <div className="mb-6 space-y-3 rounded-lg border border-line bg-surface p-4 text-body-sm">
            <p>ID {String(user.id)} · {user.email || "—"} · {user.phone || "—"} · {user.locale || "—"} · <strong>{user.status}</strong></p>
            <p className="text-caption text-ink-muted">注册时间 {fmtDate(user.createdAt)}</p>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Input className="w-56" placeholder="状态变更理由" value={reason} onChange={(e) => setReason(e.target.value)} />
              {(["ACTIVE", "SUSPENDED", "BANNED"] as const).map((status) => (
                <Button key={status} size="sm" variant={status === "ACTIVE" ? "primary" : "danger"} disabled={actionMut.isPending} onClick={() => act(() => adminSetUserStatus(id, status, reason || (status === "ACTIVE" ? "restore" : "")))}>{status}</Button>
              ))}
              <Button size="sm" variant="secondary" disabled={actionMut.isPending} onClick={() => act(() => adminForceLogout(id))}>强制登出</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span>VIP 到期：{user.vipExpireAt ? fmtDate(user.vipExpireAt) : "未开通"}</span>
              <Input type="number" className="w-28" value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value))} />
              <Button size="sm" disabled={actionMut.isPending} onClick={() => act(() => adminSetUserVip(id, { extendDays }))}>延长 VIP</Button>
              <Input type="datetime-local" className="w-52" value={vipDate} onChange={(e) => setVipDate(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={actionMut.isPending} onClick={() => act(() => adminSetUserVip(id, { vipExpireAt: vipDate ? new Date(vipDate).toISOString() : null }))}>设置到期</Button>
              <Button size="sm" variant="ghost" disabled={actionMut.isPending} onClick={() => act(() => adminSetUserVip(id, { vipExpireAt: null }))}>清空 VIP</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Input type="number" className="w-28" value={delta} onChange={(e) => setDelta(Number(e.target.value))} placeholder="±积分" />
              <Input className="w-48" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="调账理由" />
              <Button size="sm" disabled={actionMut.isPending} onClick={() => act(() => adminWalletAdjust(id, delta, adjustReason))}>调整余额</Button>
            </div>
          </div>
          <Section title="近期流水" rows={detailQ.data?.transactions} fields={["type", "amountCredits", "balanceAfter", "remark", "createdAt"]} />
          <Section title="订单" rows={detailQ.data?.orders} fields={["orderNo", "orderType", "paymentStatus", "amountVnd", "createdAt"]} />
          <Section title="会话" rows={user.sessions} fields={["id", "ipAddress", "createdAt", "expiresAt"]} />
        </>
      ) : null}
    </AdminShell>
  );
}
