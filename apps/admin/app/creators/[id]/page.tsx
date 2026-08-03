"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { adminGetCreator } from "@velvet/api-client";
import { DataTable, StatCard, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";

type DramaIncome = {
  id?: string | number;
  drama?: { id: string | number; titleZh?: string; titleVi?: string };
  incomeVnd?: number;
  amountVnd?: number;
  orders?: number;
};
type CreatorDetail = {
  creator?: {
    displayName?: string;
    kycStatus?: string;
    user?: { email?: string; phone?: string };
    earnings?: { availableVnd?: number; pendingVnd?: number; withdrawnVnd?: number; totalEarnedVnd?: number };
  };
  summary?: { monthIncome?: number; paidOrders?: number; gmvTotal?: number };
  perDrama?: DramaIncome[];
};

export default function AdminCreatorDetailPage() {
  const id = String(useParams().id);
  const detailQ = useQuery({
    queryKey: ["admin", "creator", id],
    queryFn: () => adminGetCreator(id) as Promise<CreatorDetail>,
  });
  const creator = detailQ.data?.creator;
  const summary = detailQ.data?.summary;
  const columns: Column<DramaIncome>[] = [
    {
      key: "drama",
      header: "短剧",
      cell: (row) => row.drama ? (
        <Link href={`/content/${row.drama.id}`} className="text-brand hover:underline">
          {row.drama.titleZh || row.drama.titleVi || "—"}
        </Link>
      ) : "—",
    },
    { key: "income", header: "创作者收入", cell: (row) => fmtNum(row.incomeVnd), className: "tabular-nums" },
    { key: "gmv", header: "GMV", cell: (row) => fmtNum(row.amountVnd), className: "tabular-nums" },
    { key: "orders", header: "订单数", cell: (row) => String(row.orders ?? 0) },
  ];

  return (
    <AdminShell title={creator?.displayName || "创作者详情"}>
      <Link href="/creators" className="mb-4 inline-block text-body-sm text-ink-muted hover:text-ink">← 返回创作者列表</Link>
      {detailQ.error ? <p className="mb-3 text-body-sm text-danger">{(detailQ.error as Error).message}</p> : null}
      {detailQ.isLoading ? <p className="text-ink-muted">加载中…</p> : null}
      {creator ? (
        <>
          <div className="mb-6 rounded-lg border border-line bg-surface p-4 text-body-sm">
            {creator.displayName} · KYC {creator.kycStatus || "—"} · {creator.user?.email || creator.user?.phone || "—"}
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <StatCard label="可提现" value={fmtNum(creator.earnings?.availableVnd)} />
            <StatCard label="冻结中" value={fmtNum(creator.earnings?.pendingVnd)} />
            <StatCard label="已提现" value={fmtNum(creator.earnings?.withdrawnVnd)} />
            <StatCard label="累计收入" value={fmtNum(creator.earnings?.totalEarnedVnd)} />
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard label="本月收入" value={fmtNum(summary?.monthIncome)} />
            <StatCard label="已支付订单" value={fmtNum(summary?.paidOrders)} />
            <StatCard label="GMV" value={fmtNum(summary?.gmvTotal)} />
          </div>
          <h2 className="mb-2 text-h4">按剧收益</h2>
          <DataTable columns={columns} rows={detailQ.data?.perDrama ?? []} emptyTitle="暂无收益数据" />
        </>
      ) : null}
    </AdminShell>
  );
}
