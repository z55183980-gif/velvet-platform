"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminWalletAdjust, adminWalletLedger, asRows } from "@velvet/api-client";
import { walletAdjustSchema } from "@velvet/validators";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, DataTable, Input, Select, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { useState } from "react";

type Row = {
  id: string | number;
  walletUserId?: string | number;
  type?: string;
  amountCredits?: string | number;
  balanceAfter?: string | number;
  remark?: string | null;
  createdAt?: string;
};

export default function AdminWalletPage() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [type, setType] = useState("ALL");
  const [applied, setApplied] = useState({ userId: "", type: "ALL" });
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "wallet", applied],
    queryFn: async () =>
      asRows<Row>(
        await adminWalletLedger({
          userId: applied.userId || undefined,
          type: applied.type,
          page: 1,
          pageSize: 50,
        }),
      ),
  });

  const adjustMut = useMutation({
    mutationFn: async () => {
      const parsed = walletAdjustSchema.safeParse({ deltaCredits: delta, reason });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "校验失败");
      if (!userId.trim()) throw new Error("请填写 userId");
      return adminWalletAdjust(userId.trim(), parsed.data.deltaCredits, parsed.data.reason);
    },
    onSuccess: async () => {
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["admin", "wallet"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const columns: Column<Row>[] = [
    { key: "id", header: "ID", cell: (r) => String(r.id) },
    { key: "user", header: "User", cell: (r) => String(r.walletUserId ?? "—") },
    { key: "type", header: "Type", cell: (r) => r.type || "—" },
    {
      key: "delta",
      header: "Δ",
      cell: (r) => fmtNum(r.amountCredits),
      className: "tabular-nums",
    },
    {
      key: "after",
      header: "After",
      cell: (r) => fmtNum(r.balanceAfter),
      className: "tabular-nums",
    },
    {
      key: "remark",
      header: "Remark",
      cell: (r) => r.remark || "—",
      className: "max-w-xs truncate text-caption",
    },
    { key: "time", header: "Time", cell: (r) => fmtDate(r.createdAt), className: "text-caption" },
  ];

  return (
    <AdminShell title={t("wallet")}>
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-caption text-ink-muted">
          userId
          <Input className="mt-1 w-40" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </label>
        <label className="text-caption text-ink-muted">
          type
          <Select className="mt-1 w-36" value={type} onChange={(e) => setType(e.target.value)}>
            {["ALL", "TOPUP", "UNLOCK", "REFUND", "ADJUST"].map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </label>
        <Button size="sm" onClick={() => setApplied({ userId, type })}>
          查询
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-4">
        <p className="w-full text-body-sm font-medium">人工调账（SUPER_ADMIN）</p>
        <Input
          className="w-32"
          placeholder="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <Input
          type="number"
          className="w-28"
          value={delta}
          onChange={(e) => setDelta(Number(e.target.value))}
        />
        <Input
          className="w-56"
          placeholder="理由"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button size="sm" disabled={adjustMut.isPending} onClick={() => adjustMut.mutate()}>
          提交调账
        </Button>
      </div>

      <DataTable columns={columns} rows={listQ.data || []} loading={listQ.isFetching} emptyTitle={t("empty")} />
    </AdminShell>
  );
}
