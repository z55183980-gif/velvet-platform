"use client";

import { useMemo, useState } from "react";
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
import { useI18n, statusLabel } from "@/lib/i18n";

type Batch = { id: string; name?: string; type: string; vipDays?: number; creditsAmount?: number; quantity: number; unused?: number; used?: number; voided?: number; createdAt?: string };
type Code = { id: string; code?: string; batchId?: string; status?: string; expiresAt?: string; createdAt?: string };
type Redemption = { id: string; code?: string; type?: string; vipDays?: number; creditsAmount?: number; createdAt?: string; user?: { id?: string; nickname?: string; email?: string } };
type Tab = "batches" | "codes" | "redemptions";

export default function AdminRedeemCodesPage() {
  const { t, locale } = useI18n();
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

  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const batchColumns: Column<Batch>[] = useMemo(
    () => [
      { key: "id", header: t("colBatch"), cell: (row) => `${row.id} ${row.name || ""}` },
      { key: "type", header: t("colType"), cell: (row) => `${row.type}${row.type === "VIP" ? ` ${t("daysUnit", { n: row.vipDays ?? 0 })}` : ` ${t("creditsUnit", { n: row.creditsAmount ?? 0 })}`}` },
      { key: "qty", header: t("colQty"), cell: (row) => String(row.quantity) },
      { key: "counts", header: t("colUnusedUsedVoided"), cell: (row) => `${row.unused ?? 0} / ${row.used ?? 0} / ${row.voided ?? 0}` },
      { key: "time", header: t("time"), cell: (row) => fmtDate(row.createdAt, dateLocale) },
      { key: "actions", header: t("actions"), cell: (row) => (
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => adminExportRedeemBatchCsv(row.id).catch((e: Error) => setError(e.message))}>{t("exportCsv")}</Button>
          <Button size="sm" variant="danger" disabled={voidBatchMut.isPending} onClick={() => voidBatchMut.mutate(row.id)}>{t("voidUnused")}</Button>
        </div>
      ) },
    ],
    [t, dateLocale, voidBatchMut],
  );
  const codeColumns: Column<Code>[] = useMemo(
    () => [
      { key: "select", header: "", cell: (row) => <input type="checkbox" checked={selected.has(row.id)} onChange={(e) => setSelected((old) => { const next = new Set(old); e.target.checked ? next.add(row.id) : next.delete(row.id); return next; })} /> },
      { key: "code", header: t("colCode"), cell: (row) => <span className="font-mono text-caption">{row.code || row.id}</span> },
      { key: "batch", header: t("colBatch"), cell: (row) => row.batchId || "—" },
      { key: "status", header: t("status"), cell: (row) => statusLabel(t, row.status) },
      { key: "expires", header: t("colExpires"), cell: (row) => fmtDate(row.expiresAt, dateLocale) },
    ],
    [t, dateLocale, selected],
  );
  const redemptionColumns: Column<Redemption>[] = useMemo(
    () => [
      { key: "code", header: t("colCode"), cell: (row) => <span className="font-mono text-caption">{row.code || "—"}</span> },
      { key: "user", header: t("colUser"), cell: (row) => row.user?.nickname || row.user?.email || row.user?.id || "—" },
      { key: "type", header: t("colContent"), cell: (row) => `${row.type || ""}${row.vipDays ? ` ${t("daysUnit", { n: row.vipDays })}` : ""}${row.creditsAmount ? ` ${t("creditsUnit", { n: row.creditsAmount })}` : ""}` },
      { key: "time", header: t("time"), cell: (row) => fmtDate(row.createdAt, dateLocale) },
    ],
    [t, dateLocale],
  );

  return (
    <AdminShell title={t("redeemCodes")}>
      <p className="mb-4 text-body-sm text-ink-muted">{t("redeemHint")}</p>
      {error || batchesQ.error || codesQ.error || redemptionsQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{error || (batchesQ.error as Error)?.message || (codesQ.error as Error)?.message || (redemptionsQ.error as Error)?.message}</p>
      ) : null}
      <div className="mb-6 flex flex-wrap items-end gap-2 card glass-card p-4">
        <Input className="w-36" placeholder={t("batchName")} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Select className="w-32" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "VIP" | "CREDITS" }))}>
          <option value="VIP">VIP</option><option value="CREDITS">{t("colCredits")}</option>
        </Select>
        <Input type="number" className="w-28" value={form.type === "VIP" ? form.vipDays : form.creditsAmount} onChange={(e) => setForm((f) => ({ ...f, [form.type === "VIP" ? "vipDays" : "creditsAmount"]: Number(e.target.value) }))} />
        <Input type="number" className="w-24" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} />
        <Button size="sm" disabled={createMut.isPending} onClick={() => createMut.mutate()}>{t("generate")}</Button>
      </div>
      {createdCodes ? (
        <div className="mb-6 card glass-card p-4">
          <p className="mb-2 font-medium">{t("plaintextCodesTitle")}</p>
          <textarea readOnly className="h-32 w-full rounded-md border border-line bg-surface-2 p-2 font-mono text-caption" value={createdCodes.join("\n")} />
          <Button size="sm" variant="ghost" onClick={() => setCreatedCodes(null)}>{t("close")}</Button>
        </div>
      ) : null}
      <div className="mb-4 flex gap-2">
        {([["batches", t("tabBatches")], ["codes", t("tabCodes")], ["redemptions", t("tabRedemptions")]] as const).map(([key, label]) => (
          <Button key={key} size="sm" variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)}>{label}</Button>
        ))}
      </div>
      {tab === "batches" ? <DataTable columns={batchColumns} rows={batchesQ.data ?? []} loading={batchesQ.isFetching} emptyTitle={t("empty")} /> : null}
      {tab === "codes" ? (
        <>
          <Button className="mb-3" size="sm" variant="danger" disabled={!selected.size || voidCodesMut.isPending} onClick={() => voidCodesMut.mutate()}>{t("voidSelected", { n: selected.size })}</Button>
          <DataTable columns={codeColumns} rows={codesQ.data ?? []} loading={codesQ.isFetching} emptyTitle={t("empty")} />
        </>
      ) : null}
      {tab === "redemptions" ? <DataTable columns={redemptionColumns} rows={redemptionsQ.data ?? []} loading={redemptionsQ.isFetching} emptyTitle={t("empty")} /> : null}
    </AdminShell>
  );
}
