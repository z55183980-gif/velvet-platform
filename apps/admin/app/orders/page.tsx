"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveRefund,
  adminDownloadCsv,
  adminListOrders,
  adminListRefunds,
  adminMarkPaid,
  adminRefuseRefund,
  asRows,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, DataTable, Input, Select, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { useState } from "react";

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

type RefundRow = {
  orderNo: string;
  orderType?: string;
  refundNote?: string | null;
  amountCredits?: string | number;
  user?: { email?: string | null; phone?: string | null };
};

export default function AdminOrdersPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"orders" | "refunds">("orders");
  const [status, setStatus] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [method, setMethod] = useState("ALL");
  const [markRef, setMarkRef] = useState<Record<string, string>>({});
  const [refuseReason, setRefuseReason] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const ordersQ = useQuery({
    queryKey: ["admin", "orders", { status, type, method }],
    queryFn: async () =>
      asRows<OrderRow>(await adminListOrders({ status, type, method, page: 1, pageSize: 40 })),
    enabled: tab === "orders",
  });

  const refundsQ = useQuery({
    queryKey: ["admin", "refunds"],
    queryFn: async () => asRows<RefundRow>(await adminListRefunds(1, 40)),
    enabled: tab === "refunds",
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin", "orders"] }),
      qc.invalidateQueries({ queryKey: ["admin", "refunds"] }),
    ]);
  };

  const markMut = useMutation({
    mutationFn: ({ orderNo, ref }: { orderNo: string; ref: string }) => adminMarkPaid(orderNo, ref),
    onSuccess: invalidate,
    onError: (e: Error) => setErr(e.message),
  });

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

  const exportMut = useMutation({
    mutationFn: () => adminDownloadCsv("orders"),
    onError: (e: Error) => setErr(e.message),
  });

  const orderCols: Column<OrderRow>[] = [
    { key: "no", header: "orderNo", cell: (r) => r.orderNo, className: "font-mono text-caption" },
    { key: "type", header: "Type", cell: (r) => r.orderType || "—" },
    {
      key: "user",
      header: t("users"),
      cell: (r) => r.user?.email || r.user?.phone || String(r.userId ?? "—"),
    },
    {
      key: "amount",
      header: "₫ / credits",
      cell: (r) => `${fmtNum(r.amountVnd)} / ${fmtNum(r.amountCredits)}`,
      className: "tabular-nums",
    },
    { key: "pay", header: "Pay", cell: (r) => r.paymentMethod || "—" },
    { key: "status", header: t("status"), cell: (r) => r.paymentStatus || "—" },
    { key: "time", header: t("time"), cell: (r) => fmtDate(r.createdAt), className: "text-caption" },
    {
      key: "actions",
      header: t("actions"),
      cell: (r) =>
        r.paymentStatus === "PENDING" ? (
          <div className="flex items-center gap-1">
            <Input
              className="w-28"
              placeholder="externalRef"
              value={markRef[r.orderNo] || ""}
              onChange={(e) => setMarkRef((m) => ({ ...m, [r.orderNo]: e.target.value }))}
            />
            <Button
              size="sm"
              onClick={() =>
                markMut.mutate({ orderNo: r.orderNo, ref: markRef[r.orderNo] || "manual" })
              }
            >
              入账
            </Button>
          </div>
        ) : (
          "—"
        ),
    },
  ];

  const refundCols: Column<RefundRow>[] = [
    { key: "no", header: "orderNo", cell: (r) => r.orderNo, className: "font-mono text-caption" },
    { key: "type", header: "Type", cell: (r) => r.orderType || "—" },
    { key: "user", header: "User", cell: (r) => r.user?.email || r.user?.phone || "—" },
    { key: "note", header: "Note", cell: (r) => r.refundNote || "—" },
    {
      key: "credits",
      header: "Credits",
      cell: (r) => fmtNum(r.amountCredits),
      className: "tabular-nums",
    },
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" onClick={() => approveRefundMut.mutate(r.orderNo)}>
            批准
          </Button>
          <Input
            className="w-32"
            placeholder="拒绝理由"
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
            拒绝
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminShell title={t("orders")}>
      {err || ordersQ.error || refundsQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {err || (ordersQ.error as Error)?.message || (refundsQ.error as Error)?.message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={tab === "orders" ? "primary" : "secondary"}
          onClick={() => setTab("orders")}
        >
          订单
        </Button>
        <Button
          size="sm"
          variant={tab === "refunds" ? "primary" : "secondary"}
          onClick={() => setTab("refunds")}
        >
          {t("refunds")}
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

      {tab === "orders" ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
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
          </div>
          <DataTable
            columns={orderCols}
            rows={ordersQ.data || []}
            loading={ordersQ.isFetching}
            emptyTitle={t("empty")}
            getRowKey={(r) => r.orderNo}
          />
        </>
      ) : (
        <DataTable
          columns={refundCols}
          rows={refundsQ.data || []}
          loading={refundsQ.isFetching}
          emptyTitle="暂无退款工单"
          getRowKey={(r) => r.orderNo}
        />
      )}
    </AdminShell>
  );
}
