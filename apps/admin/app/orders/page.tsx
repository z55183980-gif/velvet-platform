"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CreditCard, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminDownloadCsv,
  adminGetOrder,
  adminListOrders,
  adminMarkPaid,
  type AdminOrderRow,
} from "@velvet/api-client";
import { Badge, Button, DataTable, Input, Select, cn, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { GlassModal } from "@/components/glass-modal";
import {
  orderTypeLabel,
  paymentMethodLabel,
  statusLabel,
  useI18n,
  type LabelKey,
} from "@/lib/i18n";

type Tab = "all" | "topup" | "vip";

const PAGE_SIZE_OPTIONS = [20, 40, 50] as const;

const PAY_STATUSES = ["ALL", "PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"] as const;
const ORDER_TYPES = ["ALL", "TOPUP", "VIP_SUB", "EPISODE_UNLOCK", "DRAMA_BUYOUT"] as const;

function paginationItems(page: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const visible = new Set([1, total, page - 1, page, page + 1]);
  const pages = [...visible].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  pages.forEach((value, index) => {
    if (index > 0 && value - pages[index - 1]! > 1) result.push("ellipsis");
    result.push(value);
  });
  return result;
}

function payStatusTone(status?: string | null): "default" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "PAID":
      return "success";
    case "PENDING":
      return "warning";
    case "FAILED":
    case "CANCELLED":
      return "danger";
    case "REFUNDED":
      return "info";
    default:
      return "default";
  }
}

function productLabel(row: AdminOrderRow, locale: string, t: (key: LabelKey) => string) {
  if (row.orderType === "TOPUP") {
    const pkg = row.package;
    if (!pkg) return t("orderTypeTopup");
    const name = pkg.name?.trim();
    const credits = fmtNum(pkg.credits ?? row.amountCredits);
    return name ? `${name} · ${credits}` : `${t("orderTypeTopup")} · ${credits}`;
  }
  if (row.orderType === "VIP_SUB") {
    const plan = row.vipPlan;
    if (!plan) return t("orderTypeVip");
    const name =
      locale === "zh"
        ? plan.nameZh || plan.name || plan.nameEn
        : plan.nameEn || plan.name || plan.nameZh;
    const days = plan.durationDays != null ? `${plan.durationDays}d` : "";
    return [name, days].filter(Boolean).join(" · ") || t("orderTypeVip");
  }
  if (row.orderType === "EPISODE_UNLOCK") {
    const title =
      locale === "zh"
        ? row.drama?.titleZh || row.drama?.titleEn
        : row.drama?.titleEn || row.drama?.titleZh;
    const ep = row.episode?.episodeNumber;
    if (title && ep != null) return `${title} · EP${ep}`;
    if (title) return title;
    return t("orderTypeUnlock");
  }
  if (row.orderType === "DRAMA_BUYOUT") {
    const title =
      locale === "zh"
        ? row.drama?.titleZh || row.drama?.titleEn
        : row.drama?.titleEn || row.drama?.titleZh;
    return title || t("orderTypeBuyout");
  }
  return "—";
}

function userLabel(row: AdminOrderRow) {
  return row.user?.email || row.user?.phone || row.user?.nickname || String(row.userId ?? "—");
}

function amountLabel(row: AdminOrderRow, creditsLabel: string) {
  if (row.orderType === "TOPUP" || row.orderType === "VIP_SUB") {
    const currency = row.payCurrency || "USD";
    const paid = row.payAmount != null && row.payAmount !== "" ? fmtNum(row.payAmount) : null;
    if (paid != null) return `${currency} ${paid}`;
    return `${currency} ${fmtNum(row.amountVnd)}`;
  }
  return `${fmtNum(row.amountCredits)} ${creditsLabel}`;
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="mt-1 break-words text-body-sm text-ink">{children}</div>
    </div>
  );
}

export default function AdminOrdersPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [status, setStatus] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [detailOrderNo, setDetailOrderNo] = useState<string | null>(null);
  const [markRef, setMarkRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const tabType = tab === "topup" ? "TOPUP" : tab === "vip" ? "VIP_SUB" : type;

  const ordersQ = useQuery({
    queryKey: [
      "admin",
      "orders",
      { tab, page, pageSize, status, type: tabType, from, to, appliedQuery },
    ],
    queryFn: () =>
      adminListOrders({
        page,
        pageSize,
        status,
        type: tabType,
        from: from || undefined,
        to: to || undefined,
        q: appliedQuery || undefined,
      }),
  });

  const detailQ = useQuery({
    queryKey: ["admin", "orders", "detail", detailOrderNo],
    queryFn: () => adminGetOrder(detailOrderNo!),
    enabled: !!detailOrderNo,
  });

  const total = ordersQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rows = ordersQ.data?.rows ?? [];

  const markMut = useMutation({
    mutationFn: ({ orderNo, ref }: { orderNo: string; ref: string }) =>
      adminMarkPaid(orderNo, ref),
    onSuccess: async () => {
      setMarkRef("");
      setToast(t("markPaid"));
      await qc.invalidateQueries({ queryKey: ["admin", "orders"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const exportMut = useMutation({
    mutationFn: () => adminDownloadCsv("orders"),
    onError: (e: Error) => setError(e.message),
  });

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
    if (next !== "all") setType("ALL");
  }

  function applySearch() {
    setAppliedQuery(query.trim());
    setPage(1);
  }

  function clearFilters() {
    setStatus("ALL");
    setType("ALL");
    setFrom("");
    setTo("");
    setQuery("");
    setAppliedQuery("");
    setPage(1);
  }

  const columns: Column<AdminOrderRow>[] = useMemo(
    () => [
      {
        key: "no",
        header: t("colOrderNo"),
        cell: (r) => (
          <button
            type="button"
            className="font-mono text-caption text-brand hover:underline"
            onClick={() => {
              setMarkRef("");
              setDetailOrderNo(r.orderNo);
            }}
          >
            {r.orderNo}
          </button>
        ),
      },
      {
        key: "type",
        header: t("colType"),
        cell: (r) => <Badge>{orderTypeLabel(t, r.orderType)}</Badge>,
      },
      {
        key: "product",
        header: t("orderProduct"),
        cell: (r) => (
          <span className="max-w-[14rem] truncate block" title={productLabel(r, locale, t)}>
            {productLabel(r, locale, t)}
          </span>
        ),
      },
      {
        key: "user",
        header: t("colUser"),
        cell: (r) =>
          r.userId != null ? (
            <Link
              href={`/users/${r.userId}`}
              className="max-w-[12rem] truncate block text-ink hover:text-brand"
              title={userLabel(r)}
            >
              {userLabel(r)}
            </Link>
          ) : (
            "—"
          ),
      },
      {
        key: "amount",
        header: t("colAmount"),
        cell: (r) => amountLabel(r, t("colCredits")),
        className: "tabular-nums whitespace-nowrap",
      },
      {
        key: "credits",
        header: t("colCredits"),
        cell: (r) => fmtNum(r.amountCredits),
        className: "tabular-nums",
      },
      {
        key: "pay",
        header: t("colPay"),
        cell: (r) => paymentMethodLabel(t, r.paymentMethod),
      },
      {
        key: "status",
        header: t("status"),
        cell: (r) => (
          <Badge tone={payStatusTone(r.paymentStatus)}>{statusLabel(t, r.paymentStatus)}</Badge>
        ),
      },
      {
        key: "time",
        header: t("time"),
        cell: (r) => fmtDate(r.createdAt, dateLocale),
        className: "text-caption whitespace-nowrap",
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (r) => (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setMarkRef("");
              setDetailOrderNo(r.orderNo);
            }}
          >
            {t("viewDetail")}
          </Button>
        ),
      },
    ],
    [t, locale, dateLocale],
  );

  const detail = detailQ.data;
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "all", label: t("orderTabAll") },
    { id: "topup", label: t("orderTabTopup") },
    { id: "vip", label: t("orderTabVip") },
  ];

  return (
    <AdminShell title={t("orders")}>
      {error || ordersQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error || (ordersQ.error as Error)?.message}
        </p>
      ) : null}
      {toast ? <p className="mb-3 text-body-sm text-success">{toast}</p> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-line bg-white/45 p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => switchTab(item.id)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-caption font-medium transition",
                tab === item.id
                  ? "bg-brand text-white shadow-brand"
                  : "text-ink-muted hover:bg-white hover:text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={ordersQ.isFetching}
            onClick={() => void ordersQ.refetch()}
          >
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", ordersQ.isFetching && "animate-spin")} />
            {t("query")}
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
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white/45 p-3">
        <label className="block min-w-[16rem] flex-1 text-caption font-medium text-ink-muted">
          {t("query")}
          <Input
            className="mt-1"
            value={query}
            placeholder={t("orderSearchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
          />
        </label>
        <label className="block text-caption font-medium text-ink-muted">
          {t("status")}
          <Select
            className="mt-1 w-36"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {PAY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(t, s)}
              </option>
            ))}
          </Select>
        </label>
        {tab === "all" ? (
          <label className="block text-caption font-medium text-ink-muted">
            {t("colType")}
            <Select
              className="mt-1 w-40"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              {ORDER_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? t("statusAll") : orderTypeLabel(t, s)}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="block text-caption font-medium text-ink-muted">
          {t("dateFrom")}
          <Input
            className="mt-1 w-40"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="block text-caption font-medium text-ink-muted">
          {t("dateTo")}
          <Input
            className="mt-1 w-40"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <Button size="sm" onClick={applySearch}>
          {t("query")}
        </Button>
        <Button size="sm" variant="secondary" onClick={clearFilters}>
          {t("clearFilters")}
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={ordersQ.isFetching}
        emptyTitle={t("orderEmpty")}
        getRowKey={(r) => r.orderNo}
      />

      {total > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/45 px-3 py-2 text-caption text-ink-muted">
          <div className="flex items-center gap-3">
            <span>{t("totalCount", { n: total })}</span>
            <Select
              className="h-8 w-28 text-caption"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / {t("page")}
                </option>
              ))}
            </Select>
            <span>
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1 || ordersQ.isFetching}
              onClick={() => setPage(page - 1)}
            >
              {t("previousPage")}
            </Button>
            <div className="hidden items-center gap-1 sm:flex">
              {paginationItems(page, totalPages).map((item, index) =>
                item === "ellipsis" ? (
                  <span
                    key={`ellipsis-${index}`}
                    className="grid h-9 w-7 place-items-center text-ink-subtle"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    aria-current={item === page ? "page" : undefined}
                    disabled={ordersQ.isFetching}
                    onClick={() => setPage(item)}
                    className={cn(
                      "grid h-9 min-w-9 place-items-center rounded-xl px-2 font-medium transition",
                      item === page
                        ? "bg-brand text-white shadow-brand"
                        : "border border-white/70 bg-white/65 text-ink-muted hover:-translate-y-0.5 hover:bg-white hover:text-ink hover:shadow-sm",
                    )}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages || ordersQ.isFetching}
              onClick={() => setPage(page + 1)}
            >
              {t("nextPage")}
            </Button>
          </div>
        </div>
      ) : null}

      <GlassModal
        open={!!detailOrderNo}
        onClose={() => {
          if (!markMut.isPending) {
            setDetailOrderNo(null);
            setMarkRef("");
          }
        }}
        size="lg"
        title={
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-brand">
              <CreditCard className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-bold tracking-tight text-slate-900">
                {t("orderDetail")}
              </span>
              <span className="mt-0.5 block font-mono text-xs font-normal text-slate-500">
                {detailOrderNo}
              </span>
            </span>
          </div>
        }
      >
        {detailQ.isFetching && !detail ? (
          <p className="text-body-sm text-ink-muted">{t("loading")}</p>
        ) : detailQ.error ? (
          <p className="text-body-sm text-danger">{(detailQ.error as Error).message}</p>
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{orderTypeLabel(t, detail.orderType)}</Badge>
              <Badge tone={payStatusTone(detail.paymentStatus)}>
                {statusLabel(t, detail.paymentStatus)}
              </Badge>
              <Badge tone="default">{paymentMethodLabel(t, detail.paymentMethod)}</Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <DetailField label={t("orderProduct")}>{productLabel(detail, locale, t)}</DetailField>
              <DetailField label={t("colUser")}>
                {detail.userId != null ? (
                  <Link href={`/users/${detail.userId}`} className="text-brand hover:underline">
                    {userLabel(detail)}
                  </Link>
                ) : (
                  "—"
                )}
              </DetailField>
              <DetailField label={t("colAmount")}>{amountLabel(detail, t("colCredits"))}</DetailField>
              <DetailField label={t("colCredits")}>{fmtNum(detail.amountCredits)}</DetailField>
              <DetailField label={t("orderPayAmount")}>
                {detail.payAmount != null
                  ? `${detail.payCurrency || ""} ${fmtNum(detail.payAmount)}`.trim()
                  : "—"}
              </DetailField>
              <DetailField label={t("orderExternalRef")}>{detail.externalRef || "—"}</DetailField>
              <DetailField label={t("colCreated")}>
                {fmtDate(detail.createdAt, dateLocale)}
              </DetailField>
              <DetailField label={t("orderPaidAt")}>
                {detail.paidAt ? fmtDate(detail.paidAt, dateLocale) : "—"}
              </DetailField>
              <DetailField label={t("orderRefundAt")}>
                {detail.refundedAt ? fmtDate(detail.refundedAt, dateLocale) : "—"}
              </DetailField>
              <DetailField label={t("orderUserVipExpire")}>
                {detail.user?.vipExpireAt
                  ? fmtDate(detail.user.vipExpireAt, dateLocale)
                  : "—"}
              </DetailField>
              {detail.vipPlan ? (
                <DetailField label={t("vipPlans")}>
                  {[
                    locale === "zh"
                      ? detail.vipPlan.nameZh || detail.vipPlan.nameEn
                      : detail.vipPlan.nameEn || detail.vipPlan.nameZh,
                    detail.vipPlan.durationDays != null
                      ? `${detail.vipPlan.durationDays}d`
                      : null,
                    detail.vipPlan.basePrice != null
                      ? `${detail.vipPlan.baseCurrency || "USD"} ${fmtNum(detail.vipPlan.basePrice)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </DetailField>
              ) : null}
              {detail.package ? (
                <DetailField label={t("orderTypeTopup")}>
                  {[
                    detail.package.name,
                    `${fmtNum(detail.package.credits)} credits`,
                    detail.package.basePrice != null
                      ? `${detail.package.baseCurrency || "USD"} ${fmtNum(detail.package.basePrice)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </DetailField>
              ) : null}
            </div>

            {detail.refundNote || detail.refundReason || detail.refundStatus ? (
              <div className="rounded-xl border border-line bg-white/50 p-3 text-body-sm">
                <div className="font-medium text-ink">{t("refunds")}</div>
                <div className="mt-2 space-y-1 text-ink-muted">
                  {detail.refundStatus ? <div>Status: {detail.refundStatus}</div> : null}
                  {detail.refundReason ? <div>{detail.refundReason}</div> : null}
                  {detail.refundNote ? <div>{detail.refundNote}</div> : null}
                </div>
              </div>
            ) : null}

            {detail.meta != null ? (
              <div className="rounded-xl border border-line bg-white/50 p-3">
                <div className="mb-2 text-caption font-medium text-ink-muted">{t("orderMeta")}</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-ink-muted">
                  {typeof detail.meta === "string"
                    ? detail.meta
                    : JSON.stringify(detail.meta, null, 2)}
                </pre>
              </div>
            ) : null}

            {detail.paymentStatus === "PENDING" ? (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-warning/30 bg-warning-soft/40 p-3">
                <label className="block min-w-[14rem] flex-1 text-caption font-medium text-ink-muted">
                  {t("externalRef")}
                  <Input
                    className="mt-1"
                    value={markRef}
                    placeholder={t("externalRef")}
                    onChange={(e) => setMarkRef(e.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  disabled={markMut.isPending || !markRef.trim()}
                  onClick={() =>
                    markMut.mutate({
                      orderNo: detail.orderNo,
                      ref: markRef.trim(),
                    })
                  }
                >
                  {t("markPaid")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </GlassModal>
    </AdminShell>
  );
}
