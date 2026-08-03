"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveWithdraw,
  adminDownloadCsv,
  adminListWithdraws,
  adminRejectWithdraw,
  asRows,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, DataTable, Input, Select, fmtDate, fmtNum, hoursAgo, type Column } from "@velvet/ui";
import { useEffect, useState } from "react";

type Row = {
  id: string | number;
  requestNo?: string;
  status?: string;
  createdAt?: string;
  amountVnd?: string | number;
  pitVnd?: string | number;
  netVnd?: string | number;
  creator?: { displayName?: string };
};

export default function AdminWithdrawsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("PENDING");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s) setStatus(s);
  }, []);

  const listQ = useQuery({
    queryKey: ["admin", "withdraws", status],
    queryFn: async () => asRows<Row>(await adminListWithdraws({ status, page: 1, pageSize: 50 })),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApproveWithdraw(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "withdraws"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminRejectWithdraw(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "withdraws"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const exportMut = useMutation({
    mutationFn: () => adminDownloadCsv("withdraws"),
    onError: (e: Error) => setErr(e.message),
  });

  const columns: Column<Row>[] = [
    { key: "no", header: "No", cell: (r) => r.requestNo || "—", className: "font-mono text-caption" },
    { key: "creator", header: t("creators"), cell: (r) => r.creator?.displayName || "—" },
    {
      key: "amount",
      header: "申请额",
      cell: (r) => fmtNum(r.amountVnd),
      className: "tabular-nums",
    },
    {
      key: "net",
      header: "税后",
      cell: (r) => {
        const pit = Number(r.pitVnd ?? Math.floor(Number(r.amountVnd) * 0.05));
        const net = Number(r.netVnd ?? Number(r.amountVnd) - pit);
        return (
          <span className="tabular-nums">
            {fmtNum(net)}
            <span className="ml-1 text-caption text-ink-muted">(PIT {fmtNum(pit)})</span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: t("status"),
      cell: (r) => {
        const overdue = r.status === "PENDING" && hoursAgo(r.createdAt) > 24;
        return (
          <span>
            {r.status}
            {overdue ? <span className="ml-1 text-caption text-danger">{t("slaWarn")}</span> : null}
          </span>
        );
      },
    },
    { key: "time", header: t("time"), cell: (r) => fmtDate(r.createdAt), className: "text-caption" },
    {
      key: "actions",
      header: t("actions"),
      cell: (r) =>
        r.status === "PENDING" ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" onClick={() => approveMut.mutate(String(r.id))}>
              {t("approve")}
            </Button>
            <Input
              className="w-28"
              placeholder="拒绝理由"
              value={reasons[String(r.id)] || ""}
              onChange={(e) => setReasons((m) => ({ ...m, [String(r.id)]: e.target.value }))}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                rejectMut.mutate({ id: String(r.id), reason: reasons[String(r.id)] || "" })
              }
            >
              {t("reject")}
            </Button>
          </div>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <AdminShell title={t("withdraws")}>
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["ALL", "PENDING", "APPROVED", "PAID", "REJECTED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
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
        getRowKey={(r, i) => String(r.id ?? i)}
      />
    </AdminShell>
  );
}
