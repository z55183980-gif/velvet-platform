"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateRedeemBatch,
  adminExportRedeemBatchCsv,
  adminListRedeemBatches,
  adminListRedeemCodes,
  adminListRedemptions,
  adminVoidRedeemBatch,
  adminVoidRedeemCodes,
  asRows,
} from "@velvet/api-client";
import { Button, DataTable, Input, Select, fmtDate, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";

type Batch = { id: string; name?: string; type: string; vipDays?: number; creditsAmount?: number; quantity: number; unused?: number; used?: number; voided?: number; createdAt?: string };
type Code = { id: string; code?: string; batchId?: string; status?: string; expiresAt?: string; createdAt?: string };
type Redemption = { id: string; code?: string; type?: string; vipDays?: number; creditsAmount?: number; createdAt?: string; user?: { id?: string; nickname?: string; email?: string } };
type Tab = "batches" | "codes" | "redemptions";

export default function AdminRedeemCodesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("batches");
  const [form, setForm] = useState({ name: "", type: "VIP" as "VIP" | "CREDITS", vipDays: 30, creditsAmount: 50, quantity: 10 });
  const [createdCodes, setCreatedCodes] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const batchesQ = useQuery({ queryKey: ["admin", "redeem", "batches"], queryFn: async () => asRows<Batch>(await adminListRedeemBatches(1, 40)) });
  const codesQ = useQuery({ queryKey: ["admin", "redeem", "codes"], queryFn: async () => asRows<Code>(await adminListRedeemCodes({ page: 1, pageSize: 40 })) });
  const redemptionsQ = useQuery({ queryKey: ["admin", "redeem", "redemptions"], queryFn: async () => asRows<Redemption>(await adminListRedemptions(1, 40)) });
  const createMut = useMutation({
    mutationFn: () => adminCreateRedeemBatch({
      name: form.name || undefined,
      type: form.type,
      vipDays: form.type === "VIP" ? form.vipDays : undefined,
      creditsAmount: form.type === "CREDITS" ? form.creditsAmount : undefined,
      quantity: form.quantity,
    }),
    onSuccess: async (result: unknown) => {
      setCreatedCodes((result as { codes?: string[] }).codes ?? []);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "redeem"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const voidBatchMut = useMutation({
    mutationFn: adminVoidRedeemBatch,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "redeem"] }),
    onError: (e: Error) => setError(e.message),
  });
  const voidCodesMut = useMutation({
    mutationFn: () => adminVoidRedeemCodes([...selected]),
    onSuccess: async () => {
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["admin", "redeem", "codes"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const batchColumns: Column<Batch>[] = [
    { key: "id", header: "批次", cell: (row) => `${row.id} ${row.name || ""}` },
    { key: "type", header: "类型", cell: (row) => `${row.type}${row.type === "VIP" ? ` ${row.vipDays}天` : ` ${row.creditsAmount}积分`}` },
    { key: "qty", header: "数量", cell: (row) => String(row.quantity) },
    { key: "counts", header: "未用 / 已用 / 作废", cell: (row) => `${row.unused ?? 0} / ${row.used ?? 0} / ${row.voided ?? 0}` },
    { key: "time", header: t("time"), cell: (row) => fmtDate(row.createdAt) },
    { key: "actions", header: t("actions"), cell: (row) => (
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" onClick={() => adminExportRedeemBatchCsv(row.id).catch((e: Error) => setError(e.message))}>导出 CSV</Button>
        <Button size="sm" variant="danger" disabled={voidBatchMut.isPending} onClick={() => voidBatchMut.mutate(row.id)}>作废未用码</Button>
      </div>
    ) },
  ];
  const codeColumns: Column<Code>[] = [
    { key: "select", header: "", cell: (row) => <input type="checkbox" checked={selected.has(row.id)} onChange={(e) => setSelected((old) => { const next = new Set(old); e.target.checked ? next.add(row.id) : next.delete(row.id); return next; })} /> },
    { key: "code", header: "兑换码", cell: (row) => <span className="font-mono text-caption">{row.code || row.id}</span> },
    { key: "batch", header: "批次", cell: (row) => row.batchId || "—" },
    { key: "status", header: t("status"), cell: (row) => row.status || "—" },
    { key: "expires", header: "过期时间", cell: (row) => fmtDate(row.expiresAt) },
  ];
  const redemptionColumns: Column<Redemption>[] = [
    { key: "code", header: "兑换码", cell: (row) => <span className="font-mono text-caption">{row.code || "—"}</span> },
    { key: "user", header: "用户", cell: (row) => row.user?.nickname || row.user?.email || row.user?.id || "—" },
    { key: "type", header: "内容", cell: (row) => `${row.type || ""}${row.vipDays ? ` ${row.vipDays}天` : ""}${row.creditsAmount ? ` ${row.creditsAmount}积分` : ""}` },
    { key: "time", header: t("time"), cell: (row) => fmtDate(row.createdAt) },
  ];

  return (
    <AdminShell title={t("redeemCodes")}>
      <p className="mb-4 text-body-sm text-ink-muted">批量生成 VIP 或积分卡密。明文仅在创建时展示一次，请立即复制或导出 CSV。</p>
      {error || batchesQ.error || codesQ.error || redemptionsQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{error || (batchesQ.error as Error)?.message || (codesQ.error as Error)?.message || (redemptionsQ.error as Error)?.message}</p>
      ) : null}
      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-4">
        <Input className="w-36" placeholder="批次名称" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Select className="w-32" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "VIP" | "CREDITS" }))}>
          <option value="VIP">VIP</option><option value="CREDITS">积分</option>
        </Select>
        <Input type="number" className="w-28" value={form.type === "VIP" ? form.vipDays : form.creditsAmount} onChange={(e) => setForm((f) => ({ ...f, [form.type === "VIP" ? "vipDays" : "creditsAmount"]: Number(e.target.value) }))} />
        <Input type="number" className="w-24" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} />
        <Button size="sm" disabled={createMut.isPending} onClick={() => createMut.mutate()}>生成</Button>
      </div>
      {createdCodes ? (
        <div className="mb-6 rounded-lg border border-line bg-surface p-4">
          <p className="mb-2 font-medium">明文卡密（仅此一次）</p>
          <textarea readOnly className="h-32 w-full rounded-md border border-line bg-surface-2 p-2 font-mono text-caption" value={createdCodes.join("\n")} />
          <Button size="sm" variant="ghost" onClick={() => setCreatedCodes(null)}>关闭</Button>
        </div>
      ) : null}
      <div className="mb-4 flex gap-2">
        {([["batches", "批次"], ["codes", "兑换码"], ["redemptions", "兑换记录"]] as const).map(([key, label]) => (
          <Button key={key} size="sm" variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)}>{label}</Button>
        ))}
      </div>
      {tab === "batches" ? <DataTable columns={batchColumns} rows={batchesQ.data ?? []} loading={batchesQ.isFetching} emptyTitle={t("empty")} /> : null}
      {tab === "codes" ? (
        <>
          <Button className="mb-3" size="sm" variant="danger" disabled={!selected.size || voidCodesMut.isPending} onClick={() => voidCodesMut.mutate()}>作废已选 ({selected.size})</Button>
          <DataTable columns={codeColumns} rows={codesQ.data ?? []} loading={codesQ.isFetching} emptyTitle={t("empty")} />
        </>
      ) : null}
      {tab === "redemptions" ? <DataTable columns={redemptionColumns} rows={redemptionsQ.data ?? []} loading={redemptionsQ.isFetching} emptyTitle={t("empty")} /> : null}
    </AdminShell>
  );
}
