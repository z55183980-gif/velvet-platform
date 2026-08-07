"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { adminWalletLedger, type Paginated } from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { orderTypeLabel, useI18n, type LabelKey } from "@/lib/i18n";
import { Button, DataTable, Input, Select, cn, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { useMemo, useState } from "react";

type UsageFilter = "ALL" | "EPISODE_UNLOCK" | "DRAMA_BUYOUT";

type Row = {
  id: string | number;
  orderId?: string | number;
  orderNo?: string;
  walletUserId?: string | number;
  usageType?: string;
  amountCredits?: string | number;
  creditsSpent?: string | number;
  balanceAfter?: string | number | null;
  remark?: string | null;
  createdAt?: string;
  user?: {
    id?: string;
    email?: string | null;
    phone?: string | null;
    nickname?: string | null;
  } | null;
  drama?: {
    id?: string | number;
    titleEn?: string | null;
    titleZh?: string | null;
    slug?: string | null;
  } | null;
  episode?: {
    id?: string | number;
    episodeNumber?: number | null;
    title?: string | null;
  } | null;
};

const PAGE_SIZE_OPTIONS = [20, 40, 50] as const;
const USAGE_TYPES: UsageFilter[] = ["ALL", "EPISODE_UNLOCK", "DRAMA_BUYOUT"];

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

function userLabel(row: Row) {
  const u = row.user;
  if (u) {
    return u.email || u.phone || u.nickname || u.id || String(row.walletUserId ?? "—");
  }
  return String(row.walletUserId ?? "—");
}

function contentLabel(row: Row, locale: string, t: (key: LabelKey) => string) {
  const title =
    locale === "zh"
      ? row.drama?.titleZh || row.drama?.titleEn
      : row.drama?.titleEn || row.drama?.titleZh;
  if (row.usageType === "EPISODE_UNLOCK") {
    const ep = row.episode?.episodeNumber;
    if (title && ep != null) return `${title} · EP${ep}`;
    if (title) return title;
    if (ep != null) return `EP${ep}`;
    return t("orderTypeUnlock");
  }
  if (row.usageType === "DRAMA_BUYOUT") {
    return title || t("orderTypeBuyout");
  }
  return title || row.remark || "—";
}

export default function AdminWalletPage() {
  const { t, locale } = useI18n();
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const [userId, setUserId] = useState("");
  const [usage, setUsage] = useState<UsageFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({
    userId: "",
    usage: "ALL" as UsageFilter,
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);

  const listQ = useQuery({
    queryKey: ["admin", "wallet", { ...applied, page, pageSize }],
    queryFn: async () => {
      const data = (await adminWalletLedger({
        userId: applied.userId || undefined,
        usage: applied.usage,
        from: applied.from || undefined,
        to: applied.to || undefined,
        page,
        pageSize,
      })) as Paginated<Row>;
      return {
        rows: data?.rows ?? data?.items ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? page,
        pageSize: data?.pageSize ?? pageSize,
      };
    },
  });

  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rows = listQ.data?.rows ?? [];

  function applyFilters() {
    setApplied({ userId: userId.trim(), usage, from, to });
    setPage(1);
  }

  function clearFilters() {
    setUserId("");
    setUsage("ALL");
    setFrom("");
    setTo("");
    setApplied({ userId: "", usage: "ALL", from: "", to: "" });
    setPage(1);
  }

  const columns: Column<Row>[] = useMemo(
    () => [
      {
        key: "time",
        header: t("time"),
        cell: (r) => fmtDate(r.createdAt, dateLocale),
        className: "whitespace-nowrap text-caption",
      },
      {
        key: "user",
        header: t("colUser"),
        cell: (r) => {
          const id = String(r.user?.id || r.walletUserId || "");
          const label = userLabel(r);
          if (!id) return label;
          return (
            <Link href={`/users/${id}`} className="text-brand hover:underline">
              <span className="block max-w-[12rem] truncate" title={label}>
                {label}
              </span>
              <span className="block text-caption text-ink-subtle">#{id}</span>
            </Link>
          );
        },
      },
      {
        key: "usage",
        header: t("colUsage"),
        cell: (r) => orderTypeLabel(t, r.usageType),
      },
      {
        key: "content",
        header: t("colContent"),
        cell: (r) => (
          <span className="max-w-[16rem] truncate" title={contentLabel(r, locale, t)}>
            {contentLabel(r, locale, t)}
          </span>
        ),
      },
      {
        key: "spent",
        header: t("colCreditsSpent"),
        cell: (r) => {
          const spent = r.creditsSpent ?? (r.amountCredits != null ? Math.abs(Number(r.amountCredits)) : null);
          return (
            <span className="tabular-nums font-medium text-danger">
              −{fmtNum(spent)}
            </span>
          );
        },
        className: "tabular-nums",
      },
      {
        key: "after",
        header: t("colBalanceAfter"),
        cell: (r) => (r.balanceAfter != null ? fmtNum(r.balanceAfter) : "—"),
        className: "tabular-nums",
      },
      {
        key: "order",
        header: t("colOrderNo"),
        cell: (r) => r.orderNo || "—",
        className: "text-caption",
      },
    ],
    [t, dateLocale, locale],
  );

  return (
    <AdminShell title={t("wallet")}>
      <p className="mb-4 text-body-sm text-ink-muted">{t("walletHint")}</p>

      {listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{(listQ.error as Error).message}</p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-caption text-ink-muted">
          {t("walletUserId")}
          <Input
            className="mt-1 w-40"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("colUsage")}
          <Select
            className="mt-1 w-40"
            value={usage}
            onChange={(e) => setUsage(e.target.value as UsageFilter)}
          >
            {USAGE_TYPES.map((x) => (
              <option key={x} value={x}>
                {x === "ALL" ? t("usageTypeAll") : orderTypeLabel(t, x)}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-caption text-ink-muted">
          {t("dateFrom")}
          <Input
            type="date"
            className="mt-1 w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-caption text-ink-muted">
          {t("dateTo")}
          <Input
            type="date"
            className="mt-1 w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button size="sm" onClick={applyFilters}>
          {t("query")}
        </Button>
        <Button size="sm" variant="secondary" onClick={clearFilters}>
          {t("clearFilters")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => listQ.refetch()}
          disabled={listQ.isFetching}
        >
          {t("refresh")}
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={listQ.isFetching}
        emptyTitle={t("empty")}
        getRowKey={(r) => String(r.id)}
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
              disabled={page <= 1 || listQ.isFetching}
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
                    disabled={listQ.isFetching}
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
              disabled={page >= totalPages || listQ.isFetching}
              onClick={() => setPage(page + 1)}
            >
              {t("nextPage")}
            </Button>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
