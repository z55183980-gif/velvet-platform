"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminDownloadCsv,
  adminListReconciliations,
  adminRerunReconcile,
  asRows,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, DataTable, Input, fmtDate, type Column } from "@velvet/ui";
import { useState } from "react";

type Row = {
  id?: string | number;
  date?: string;
  reconcileDate?: string;
  provider?: string;
  status?: string;
  localPaidCnt?: number;
  localCount?: number;
  remotePaidCnt?: number;
  remoteCount?: number;
  diff?: unknown;
  updatedAt?: string;
  createdAt?: string;
};

export default function AdminReconcilePage() {
  const qc = useQueryClient();
  const [days, setDays] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "reconcile"],
    queryFn: async () => asRows<Row>(await adminListReconciliations(1, 50)),
  });

  const rerunMut = useMutation({
    mutationFn: () => adminRerunReconcile(days),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "reconcile"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const exportMut = useMutation({
    mutationFn: () => adminDownloadCsv("reconciliations"),
    onError: (e: Error) => setErr(e.message),
  });

  const columns: Column<Row>[] = [
    { key: "date", header: "Date", cell: (r) => r.date || r.reconcileDate || "—" },
    { key: "provider", header: "Provider", cell: (r) => r.provider || "—" },
    { key: "status", header: "Status", cell: (r) => r.status || "—" },
    {
      key: "local",
      header: "Local",
      cell: (r) => String(r.localPaidCnt ?? r.localCount ?? "—"),
    },
    {
      key: "remote",
      header: "Remote",
      cell: (r) => String(r.remotePaidCnt ?? r.remoteCount ?? "—"),
    },
    {
      key: "diff",
      header: "Diff",
      cell: (r) => (
        <span className="max-w-xs truncate font-mono text-caption">
          {typeof r.diff === "object" ? JSON.stringify(r.diff) : String(r.diff ?? "—")}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      cell: (r) => fmtDate(r.updatedAt || r.createdAt),
      className: "text-caption",
    },
  ];

  return (
    <AdminShell title={t("reconcile")}>
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={1}
          max={30}
          className="w-20"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <Button size="sm" disabled={rerunMut.isPending} onClick={() => rerunMut.mutate()}>
          重新对账
        </Button>
        <Button size="sm" variant="secondary" onClick={() => listQ.refetch()} disabled={listQ.isFetching}>
          {t("refresh")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={exportMut.isPending}
          onClick={() => exportMut.mutate()}
        >
          {t("exportCsv")}
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={listQ.data || []}
        loading={listQ.isFetching}
        emptyTitle={t("empty")}
        getRowKey={(r, i) => String(r.id || `${r.date}-${r.provider}-${i}`)}
      />
    </AdminShell>
  );
}
