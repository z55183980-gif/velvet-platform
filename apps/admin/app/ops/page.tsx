"use client";

import { useQuery } from "@tanstack/react-query";
import { adminOpsDramaSales, adminOpsSummary } from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { DataTable, StatCard, fmtNum, type Column } from "@velvet/ui";

type SaleRow = {
  dramaId: string | number;
  titleZh?: string;
  titleVi?: string;
  orderCount?: number;
  credits?: string | number;
  amountVnd?: string | number;
};

export default function AdminOpsPage() {
  const summaryQ = useQuery({
    queryKey: ["admin", "ops", "summary"],
    queryFn: () => adminOpsSummary(),
  });
  const salesQ = useQuery({
    queryKey: ["admin", "ops", "sales"],
    queryFn: async () => {
      const d = await adminOpsDramaSales(undefined, undefined, 30);
      return (Array.isArray(d) ? d : []) as SaleRow[];
    },
  });

  const summary = summaryQ.data as any;
  const columns: Column<SaleRow>[] = [
    {
      key: "drama",
      header: "剧目",
      cell: (r) => (
        <span>
          {r.titleZh || r.titleVi}{" "}
          <span className="text-caption text-ink-muted">#{r.dramaId}</span>
        </span>
      ),
    },
    { key: "orders", header: "订单数", cell: (r) => String(r.orderCount ?? 0) },
    {
      key: "credits",
      header: "Credits",
      cell: (r) => fmtNum(r.credits),
      className: "tabular-nums",
    },
    {
      key: "vnd",
      header: "VND",
      cell: (r) => fmtNum(r.amountVnd),
      className: "tabular-nums",
    },
  ];

  return (
    <AdminShell title={t("ops")}>
      {summaryQ.error || salesQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {(summaryQ.error as Error)?.message || (salesQ.error as Error)?.message}
        </p>
      ) : null}

      {summary ? (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="有效 VIP 用户" value={summary.activeVipUsers ?? "—"} />
          <StatCard
            label="充值笔数 / 积分"
            value={`${summary.topup?.count ?? 0} / ${fmtNum(summary.topup?.credits)}`}
          />
          <StatCard
            label="VIP 订单 / VND"
            value={`${summary.vip?.count ?? 0} / ${fmtNum(summary.vip?.amountVnd)}`}
          />
          <StatCard
            label="解锁+买断 / 积分"
            value={`${(summary.unlock?.count ?? 0) + (summary.dramaBuyout?.count ?? 0)} / ${fmtNum(
              String(
                Number(summary.unlock?.credits || 0) + Number(summary.dramaBuyout?.credits || 0),
              ),
            )}`}
          />
        </div>
      ) : (
        <p className="mb-6 text-body-sm text-ink-muted">{t("loading")}</p>
      )}

      <h2 className="mb-2 text-h4 font-semibold">剧目销售排行</h2>
      <DataTable
        columns={columns}
        rows={salesQ.data || []}
        loading={salesQ.isFetching}
        emptyTitle={t("empty")}
        getRowKey={(r) => String(r.dramaId)}
      />
    </AdminShell>
  );
}
