"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApproveRefund, adminListRefunds, adminRefuseRefund, asRows } from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { useI18n } from "@/lib/i18n";
import { Button, DataTable, Input, fmtNum, type Column } from "@velvet/ui";
import { useMemo, useState } from "react";

type RefundRow = {
  orderNo: string;
  orderType?: string;
  refundNote?: string | null;
  amountCredits?: string | number;
  user?: { email?: string | null; phone?: string | null };
};

export default function AdminRefundsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [refuseReason, setRefuseReason] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const refundsQ = useQuery({
    queryKey: ["admin", "refunds"],
    queryFn: async () => asRows<RefundRow>(await adminListRefunds(1, 40)),
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["admin", "refunds"] });
  };

  const approveRefundMut = useMutation({
    mutationFn: (orderNo: string) => adminApproveRefund(orderNo),
    onSuccess: invalidate,
    onError: (e: Error) => setErr(e.message),
  });

  const refuseRefundMut = useMutation({
    mutationFn: ({ orderNo, reason }: { orderNo: string; reason: string }) =>
      adminRefuseRefund(orderNo, reason),
    onSuccess: invalidate,
    onError: (e: Error) => setErr(e.message),
  });

  const refundCols: Column<RefundRow>[] = useMemo(
    () => [
      { key: "no", header: t("colOrderNo"), cell: (r) => r.orderNo, className: "font-mono text-caption" },
      { key: "type", header: t("colType"), cell: (r) => r.orderType || "—" },
      { key: "user", header: t("colUser"), cell: (r) => r.user?.email || r.user?.phone || "—" },
      { key: "note", header: t("colNote"), cell: (r) => r.refundNote || "—" },
      {
        key: "credits",
        header: t("colCredits"),
        cell: (r) => fmtNum(r.amountCredits),
        className: "tabular-nums",
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (r) => (
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" onClick={() => approveRefundMut.mutate(r.orderNo)}>
              {t("approve")}
            </Button>
            <Input
              className="w-32"
              placeholder={t("rejectReasonPlaceholder")}
              value={refuseReason[r.orderNo] || ""}
              onChange={(e) => setRefuseReason((m) => ({ ...m, [r.orderNo]: e.target.value }))}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                refuseRefundMut.mutate({
                  orderNo: r.orderNo,
                  reason: refuseReason[r.orderNo] || "",
                })
              }
            >
              {t("reject")}
            </Button>
          </div>
        ),
      },
    ],
    [t, refuseReason, approveRefundMut, refuseRefundMut],
  );

  return (
    <AdminShell title={t("refunds")}>
      {err || refundsQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {err || (refundsQ.error as Error)?.message}
        </p>
      ) : null}

      <DataTable
        columns={refundCols}
        rows={refundsQ.data || []}
        loading={refundsQ.isFetching}
        emptyTitle={t("emptyRefunds")}
        getRowKey={(r) => r.orderNo}
      />
    </AdminShell>
  );
}
