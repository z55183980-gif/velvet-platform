"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { adminGetCreator } from "@velvet/api-client";
import { DataTable, StatCard, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { ADMIN_TEXT_LINK_CLASS } from "@/lib/admin-action-styles";
import { contentDetailHref } from "@/lib/content-href";
import { useI18n, statusLabel } from "@/lib/i18n";

type DramaIncome = {
  id?: string | number;
  drama?: { id: string | number; titleZh?: string; titleEn?: string };
  incomeVnd?: number;
  amountVnd?: number;
  orders?: number;
};
type CreatorDetail = {
  creator?: {
    displayName?: string;
    kycStatus?: string;
    user?: { email?: string; phone?: string };
    earnings?: {
      availableVnd?: number;
      pendingVnd?: number;
      withdrawnVnd?: number;
      totalEarnedVnd?: number;
    };
  };
  summary?: { monthIncome?: number; paidOrders?: number; gmvTotal?: number };
  perDrama?: DramaIncome[];
};

export default function AdminCreatorDetailPage() {
  const { t } = useI18n();
  const id = String(useParams().id);
  const detailQ = useQuery({
    queryKey: ["admin", "creator", id],
    queryFn: () => adminGetCreator(id) as Promise<CreatorDetail>,
  });
  const creator = detailQ.data?.creator;
  const summary = detailQ.data?.summary;
  const columns: Column<DramaIncome>[] = useMemo(
    () => [
      {
        key: "drama",
        header: t("drama"),
        cell: (row) =>
          row.drama ? (
            <Link href={contentDetailHref(String(row.drama.id))} className={ADMIN_TEXT_LINK_CLASS}>
              {row.drama.titleZh || row.drama.titleEn || "—"}
            </Link>
          ) : (
            "—"
          ),
      },
      {
        key: "income",
        header: t("creatorIncome"),
        cell: (row) => fmtNum(row.incomeVnd),
        className: "tabular-nums",
      },
      {
        key: "gmv",
        header: t("colGmv"),
        cell: (row) => fmtNum(row.amountVnd),
        className: "tabular-nums",
      },
      { key: "orders", header: t("orderCount"), cell: (row) => String(row.orders ?? 0) },
    ],
    [t],
  );

  return (
    <AdminShell title={creator?.displayName || t("creatorDetail")}>
      <Link href="/creators" className={`mb-4 shrink-0 ${ADMIN_TEXT_LINK_CLASS}`}>
        ← {t("backToCreators")}
      </Link>
      {detailQ.error ? (
        <p className="mb-3 shrink-0 text-body-sm text-danger">{(detailQ.error as Error).message}</p>
      ) : null}
      {detailQ.isLoading ? <p className="text-ink-muted">{t("loading")}</p> : null}
      {creator ? (
        <>
          <div className="mb-6 card glass-card shrink-0 p-4 text-body-sm">
            <div className="font-medium">{creator.displayName}</div>
            <div className="mt-1 text-caption text-ink-muted">
              KYC {statusLabel(t, creator.kycStatus)} · {creator.user?.email || creator.user?.phone || "—"}
            </div>
          </div>
          <div className="mb-6 grid shrink-0 gap-3 sm:grid-cols-4">
            <StatCard label={t("withdrawable")} value={fmtNum(creator.earnings?.availableVnd)} />
            <StatCard label={t("earningsFrozen")} value={fmtNum(creator.earnings?.pendingVnd)} />
            <StatCard label={t("earningsWithdrawn")} value={fmtNum(creator.earnings?.withdrawnVnd)} />
            <StatCard label={t("totalEarned")} value={fmtNum(creator.earnings?.totalEarnedVnd)} />
          </div>
          <div className="mb-6 grid shrink-0 gap-3 sm:grid-cols-3">
            <StatCard label={t("monthIncome")} value={fmtNum(summary?.monthIncome)} />
            <StatCard label={t("paidOrdersLabel")} value={fmtNum(summary?.paidOrders)} />
            <StatCard label={t("colGmv")} value={fmtNum(summary?.gmvTotal)} />
          </div>
          <h2 className="mb-2 shrink-0 text-h4">{t("incomeByDrama")}</h2>
          <DataTable
            columns={columns}
            rows={detailQ.data?.perDrama ?? []}
            emptyTitle={t("emptyIncomeData")}
            getRowKey={(row, i) => String(row.id ?? row.drama?.id ?? i)}
          />
        </>
      ) : null}
    </AdminShell>
  );
}
