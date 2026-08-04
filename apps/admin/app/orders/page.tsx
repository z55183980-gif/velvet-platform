"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminDownloadCsv,
  adminListOrders,
  adminMarkPaid,
  asRows,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { useI18n, statusLabel } from "@/lib/i18n";
import { Button, DataTable, Input, Select, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { useMemo, useState } from "react";

type OrderRow = {
  orderNo: string;
  orderType?: string;
  userId?: string | number;
  amountVnd?: string | number;
  amountCredits?: string | number;
  paymentMethod?: string;
  paymentStatus?: string;
  createdAt?: string;
  user?: { email?: string | null; phone?: string | null };
};

export default function AdminOrdersPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [status, setStatus] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [method, setMethod] = useState("ALL");
  const [markRef, setMarkRef] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const ordersQ = useQuery({
    queryKey: ["admin", "orders", { status, type, method }],
    queryFn: async () =>
      asRows<OrderRow>(await adminListOrders({ status, type, method, page: 1, pageSize: 40 })),
  });

  const markMut = useMutation({
    mutationFn: ({ orderNo, ref }: { orderNo: string; ref: string }) => adminMarkPaid(orderNo, ref),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "orders"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const exportMut = useMutation({
    mutationFn: () => adminDownloadCsv("orders"),
    onError: (e: Error) => setErr(e.message),
  });

  const orderCols: Column<OrderRow>[] = useMemo(
    () => [
      { key: "no", header: t("colOrderNo"), cell: (r) => r.orderNo, className: "font-mono text-caption" },
      { key: "type", header: t("colType"), cell: (r) => r.orderType || "—" },
      {
        key: "user",
        header: t("colUser"),
        cell: (r) => r.user?.email || r.user?.phone || String(r.userId ?? "—"),
      },
      {
        key: "amount",
        header: t("colVndCredits"),
        cell: (r) => `${fmtNum(r.amountVnd)} / ${fmtNum(r.amountCredits)}`,
        className: "tabular-nums",
      },
      { key: "pay", header: t("colPay"), cell: (r) => r.paymentMethod || "—" },
      { key: "status", header: t("status"), cell: (r) => statusLabel(t, r.paymentStatus) },
      {
        key: "time",
        header: t("time"),
        cell: (r) => fmtDate(r.createdAt, locale === "en" ? "en-US" : "zh-CN"),
        className: "text-caption",
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (r) =>
          r.paymentStatus === "PENDING" ? (
            <div className="flex items-center gap-1">
              <Input
                className="w-28"
                placeholder={t("externalRef")}
                value={markRef[r.orderNo] || ""}
                onChange={(e) => setMarkRef((m) => ({ ...m, [r.orderNo]: e.target.value }))}
              />
              <Button
                size="sm"
                onClick={() =>
                  markMut.mutate({ orderNo: r.orderNo, ref: markRef[r.orderNo] || "manual" })
                }
              >
                {t("markPaid")}
              </Button>
            </div>
          ) : (
            "—"
          ),
      },
    ],
    [t, locale, markRef, markMut],
  );

  return (
    <AdminShell title={t("orders")}>
      {err || ordersQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {err || (ordersQ.error as Error)?.message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["ALL", "PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select className="w-44" value={type} onChange={(e) => setType(e.target.value)}>
          {["ALL", "TOPUP", "EPISODE_UNLOCK", "VIP_SUB", "DRAMA_BUYOUT"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select className="w-40" value={method} onChange={(e) => setMethod(e.target.value)}>
          {[
            "ALL",
            "BANK_TRANSFER",
            "VIETQR",
            "ALIPAY",
            "WECHAT",
            "STRIPE",
            "WALLET",
            "MOMO",
            "ZALOPAY",
          ].map((s) => (
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
        columns={orderCols}
        rows={ordersQ.data || []}
        loading={ordersQ.isFetching}
        emptyTitle={t("empty")}
        getRowKey={(r) => r.orderNo}
      />
    </AdminShell>
  );
}
