"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminListUsers, asRows } from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, DataTable, Input, Select, fmtDate, fmtNum, type Column } from "@velvet/ui";

type Row = {
  id: string | number;
  nickname?: string | null;
  email?: string | null;
  phone?: string | null;
  locale?: string;
  status?: string;
  createdAt?: string;
  wallet?: { balanceCredits?: string | number };
};

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [applied, setApplied] = useState({ q: "", status: "ALL" });

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["admin", "users", applied],
    queryFn: async () => {
      const res = await adminListUsers({
        q: applied.q || undefined,
        status: applied.status,
        page: 1,
        pageSize: 40,
      });
      return { rows: asRows<Row>(res), total: (res as { total?: number })?.total ?? 0 };
    },
  });

  const columns: Column<Row>[] = [
    { key: "id", header: "ID", cell: (r) => String(r.id), className: "tabular-nums" },
    {
      key: "user",
      header: "User",
      cell: (r) => (
        <div>
          <div>{r.nickname || "—"}</div>
          <div className="text-caption text-ink-muted">{r.email || r.phone}</div>
        </div>
      ),
    },
    { key: "locale", header: "Locale", cell: (r) => r.locale || "—" },
    { key: "status", header: t("status"), cell: (r) => r.status || "—" },
    {
      key: "credits",
      header: "Credits",
      cell: (r) => fmtNum(r.wallet?.balanceCredits),
      className: "tabular-nums",
    },
    { key: "created", header: "Created", cell: (r) => fmtDate(r.createdAt), className: "text-caption" },
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <Link href={`/users/${r.id}`} className="text-body-sm text-brand hover:underline">
          详情
        </Link>
      ),
    },
  ];

  return (
    <AdminShell title={t("users")}>
      {error ? <p className="mb-3 text-body-sm text-danger">{(error as Error).message}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="w-56"
          placeholder="email / phone / nick"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["ALL", "ACTIVE", "SUSPENDED", "BANNED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => setApplied({ q, status })}>
          查询
        </Button>
        <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {t("refresh")}
        </Button>
      </div>
      <p className="mb-2 text-caption text-ink-muted">共 {data?.total ?? 0}</p>
      <DataTable columns={columns} rows={data?.rows || []} loading={isFetching} emptyTitle={t("empty")} />
    </AdminShell>
  );
}
