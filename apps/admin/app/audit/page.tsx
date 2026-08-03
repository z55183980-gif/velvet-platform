"use client";

import { useQuery } from "@tanstack/react-query";
import { asRows, adminListAuditLogs } from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, DataTable, Input, fmtDate, type Column } from "@velvet/ui";
import { useState } from "react";

type Row = {
  id: string | number;
  createdAt?: string;
  actorId?: string | number | null;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: string;
  payload?: unknown;
};

export default function AdminAuditPage() {
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [actorId, setActorId] = useState("");
  const [applied, setApplied] = useState({ action: "", targetType: "", actorId: "" });

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["admin", "audit", applied],
    queryFn: async () => {
      const res = await adminListAuditLogs({
        action: applied.action || undefined,
        targetType: applied.targetType || undefined,
        actorId: applied.actorId || undefined,
        page: 1,
        pageSize: 50,
      });
      return asRows<Row>(res);
    },
  });

  const columns: Column<Row>[] = [
    { key: "time", header: t("time"), cell: (r) => fmtDate(r.createdAt) },
    {
      key: "actor",
      header: "Actor",
      cell: (r) => (r.actorId != null ? String(r.actorId) : "system"),
    },
    { key: "action", header: "Action", cell: (r) => r.action || "—" },
    {
      key: "target",
      header: "Target",
      cell: (r) => `${r.targetType || "—"}/${r.targetId || "—"}`,
      className: "text-caption",
    },
    { key: "result", header: "Result", cell: (r) => r.result || "—" },
    {
      key: "payload",
      header: "Payload",
      cell: (r) => (
        <span className="max-w-md truncate font-mono text-caption">{JSON.stringify(r.payload)}</span>
      ),
    },
  ];

  return (
    <AdminShell title={t("audit")}>
      {error ? <p className="mb-3 text-body-sm text-danger">{(error as Error).message}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="w-40" placeholder="action" value={action} onChange={(e) => setAction(e.target.value)} />
        <Input
          className="w-36"
          placeholder="targetType"
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
        />
        <Input className="w-28" placeholder="actorId" value={actorId} onChange={(e) => setActorId(e.target.value)} />
        <Button size="sm" onClick={() => setApplied({ action, targetType, actorId })}>
          {t("filter")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {t("refresh")}
        </Button>
      </div>
      <DataTable columns={columns} rows={data || []} loading={isFetching} emptyTitle={t("empty")} />
    </AdminShell>
  );
}
