"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminListCreators, asRows } from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, DataTable, Input, Select, fmtNum, type Column } from "@velvet/ui";

type Row = {
  id: string | number;
  displayName?: string;
  kycStatus?: string;
  earnings?: {
    availableVnd?: string | number;
    pendingVnd?: string | number;
    withdrawnVnd?: string | number;
    totalEarnedVnd?: string | number;
  };
  user?: { email?: string | null; phone?: string | null };
  _count?: { dramas?: number };
};

export default function AdminCreatorsPage() {
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState("ALL");
  const [sort, setSort] = useState("available");
  const [applied, setApplied] = useState({ q: "", kyc: "ALL", sort: "available" });

  const listQ = useQuery({
    queryKey: ["admin", "creators", applied],
    queryFn: async () =>
      asRows<Row>(
        await adminListCreators({
          q: applied.q || undefined,
          kyc: applied.kyc,
          sort: applied.sort,
          page: 1,
          pageSize: 40,
        }),
      ),
  });

  const columns: Column<Row>[] = [
    {
      key: "creator",
      header: "Creator",
      cell: (r) => (
        <div>
          <div>{r.displayName}</div>
          <div className="text-caption text-ink-muted">{r.user?.email || r.user?.phone}</div>
        </div>
      ),
    },
    { key: "kyc", header: "KYC", cell: (r) => r.kycStatus || "—" },
    {
      key: "available",
      header: "可提现",
      cell: (r) => fmtNum(r.earnings?.availableVnd),
      className: "tabular-nums",
    },
    {
      key: "pending",
      header: "冻结中",
      cell: (r) => fmtNum(r.earnings?.pendingVnd),
      className: "tabular-nums",
    },
    {
      key: "withdrawn",
      header: "已提现",
      cell: (r) => fmtNum(r.earnings?.withdrawnVnd),
      className: "tabular-nums",
    },
    {
      key: "total",
      header: "累计",
      cell: (r) => fmtNum(r.earnings?.totalEarnedVnd),
      className: "tabular-nums",
    },
    { key: "dramas", header: "Dramas", cell: (r) => String(r._count?.dramas ?? "—") },
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <Link href={`/creators/${r.id}`} className="text-body-sm text-brand hover:underline">
          详情
        </Link>
      ),
    },
  ];

  return (
    <AdminShell title={t("creators")}>
      {listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{(listQ.error as Error).message}</p>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="w-48"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="name / email"
        />
        <Select className="w-40" value={kyc} onChange={(e) => setKyc(e.target.value)}>
          {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
            <option key={s} value={s}>
              KYC {s}
            </option>
          ))}
        </Select>
        <Select className="w-40" value={sort} onChange={(e) => setSort(e.target.value)}>
          {["available", "pending", "withdrawn", "total"].map((s) => (
            <option key={s} value={s}>
              sort: {s}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => setApplied({ q, kyc, sort })}>
          查询
        </Button>
      </div>
      <DataTable columns={columns} rows={listQ.data || []} loading={listQ.isFetching} emptyTitle={t("empty")} />
    </AdminShell>
  );
}
