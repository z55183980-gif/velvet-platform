"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveWithdraw,
  adminDownloadCsv,
  adminListWithdraws,
  adminRejectWithdraw,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { AdminListPagination } from "@/components/admin-list-pagination";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { ADMIN_TEXT_LINK_CLASS } from "@/lib/admin-action-styles";
import {
  asPaginatedList,
  parseAdminPage,
  parseAdminPageSize,
  patchListPaginationUrl,
} from "@/lib/admin-list-pagination";
import { useAdminSession } from "@/lib/admin-session";
import { useI18n, statusLabel } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";
import { Button, DataTable, Input, Select, fmtDate, fmtNum, hoursAgo, type Column } from "@velvet/ui";

type BankInfo = {
  bank?: string;
  account?: string;
  name?: string;
  holder?: string;
};

type WithdrawRow = {
  id: string | number;
  requestNo?: string;
  status?: string;
  createdAt?: string;
  paidAt?: string | null;
  amountVnd?: string | number;
  pitVnd?: string | number | null;
  netVnd?: string | number | null;
  rejectReason?: string | null;
  bankInfo?: BankInfo | null;
  creator?: {
    id?: string | number;
    displayName?: string;
    taxCode?: string | null;
    kycStatus?: string;
    user?: { email?: string | null; phone?: string | null };
  };
};

type StatusFilter = "PENDING" | "REVIEWED" | "ALL" | "PAID" | "REJECTED" | "CANCELLED" | "APPROVED";

function parseBankInfo(raw: unknown): BankInfo | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as BankInfo;
}

function bankSummary(info: BankInfo | null | undefined): string {
  if (!info) return "—";
  const bank = info.bank?.trim() || "—";
  const account = info.account?.trim() || "—";
  const holder = (info.name || info.holder || "").trim();
  return holder ? `${bank} · ${account} · ${holder}` : `${bank} · ${account}`;
}

function statusFromSearch(raw: string | null): StatusFilter {
  if (!raw) return "PENDING";
  const upper = raw.toUpperCase();
  if (
    upper === "PENDING" ||
    upper === "REVIEWED" ||
    upper === "ALL" ||
    upper === "PAID" ||
    upper === "REJECTED" ||
    upper === "CANCELLED" ||
    upper === "APPROVED"
  ) {
    return upper as StatusFilter;
  }
  return "PENDING";
}

export function WithdrawsReviewPage() {
  const { t, locale } = useI18n();
  const { admin } = useAdminSession();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";
  const qc = useQueryClient();
  const searchParams = useLocationSearchParams();
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const [status, setStatus] = useState<StatusFilter>(() =>
    statusFromSearch(searchParams.get("status")),
  );
  const [page, setPage] = useState(() => parseAdminPage(searchParams.get("page")));
  const [pageSize, setPageSize] = useState(() => parseAdminPageSize(searchParams.get("pageSize")));
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<WithdrawRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WithdrawRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    setStatus(statusFromSearch(searchParams.get("status")));
    setPage(parseAdminPage(searchParams.get("page")));
    setPageSize(parseAdminPageSize(searchParams.get("pageSize")));
  }, [searchParams]);

  const syncUrl = useCallback(
    (next: { status: StatusFilter; page: number; pageSize: number }) => {
      patchListPaginationUrl({
        page: next.page,
        pageSize: next.pageSize,
        extra: (url) => {
          if (next.status === "PENDING") url.searchParams.set("status", "PENDING");
          else if (next.status === "ALL") url.searchParams.delete("status");
          else url.searchParams.set("status", next.status);
        },
      });
    },
    [],
  );

  const patchStatus = useCallback(
    (next: StatusFilter) => {
      setStatus(next);
      setPage(1);
      syncUrl({ status: next, page: 1, pageSize });
    },
    [pageSize, syncUrl],
  );

  const listQ = useQuery({
    queryKey: ["admin", "withdraws", status, page, pageSize],
    queryFn: async () => {
      const res = await adminListWithdraws({
        status,
        page,
        pageSize,
      });
      const { rows, total } = asPaginatedList<WithdrawRow>(res);
      return {
        rows: rows.map((r) => ({
          ...r,
          id: String(r.id),
          bankInfo: parseBankInfo(r.bankInfo),
        })),
        total,
      };
    },
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApproveWithdraw(id),
    onSuccess: async () => {
      setErr(null);
      setApproveTarget(null);
      setToast(t("withdrawApproveOk"));
      await qc.invalidateQueries({ queryKey: ["admin", "withdraws"] });
    },
    onError: (e: Error) => {
      setApproveTarget(null);
      setErr(e.message);
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminRejectWithdraw(id, reason),
    onSuccess: async () => {
      setErr(null);
      setRejectTarget(null);
      setRejectReason("");
      setToast(t("withdrawRejectOk"));
      await qc.invalidateQueries({ queryKey: ["admin", "withdraws"] });
    },
    onError: (e: Error) => {
      setErr(e.message);
    },
  });

  const exportMut = useMutation({
    mutationFn: () => adminDownloadCsv("withdraws"),
    onSuccess: () => setToast(t("exportCsv")),
    onError: (e: Error) => setErr(e.message),
  });

  const columns: Column<WithdrawRow>[] = useMemo(
    () => [
      {
        key: "no",
        header: t("colRequestNo"),
        cell: (r) => r.requestNo || "—",
        className: "font-mono text-caption",
      },
      {
        key: "creator",
        header: t("colCreator"),
        cell: (r) => (
          <div>
            {r.creator?.id ? (
              <Link href={`/creators/${r.creator.id}`} className={ADMIN_TEXT_LINK_CLASS}>
                {r.creator.displayName || String(r.creator.id)}
              </Link>
            ) : (
              <span>{r.creator?.displayName || "—"}</span>
            )}
            <div className="text-caption text-ink-muted">
              {r.creator?.user?.email || r.creator?.user?.phone || "—"}
            </div>
          </div>
        ),
      },
      {
        key: "bank",
        header: t("withdrawBankInfo"),
        cell: (r) => (
          <div className="max-w-[220px] text-caption leading-snug text-ink-muted">
            {bankSummary(r.bankInfo)}
          </div>
        ),
      },
      {
        key: "amount",
        header: t("applyAmount"),
        cell: (r) => fmtNum(r.amountVnd),
        className: "tabular-nums",
      },
      {
        key: "net",
        header: t("afterTax"),
        cell: (r) => {
          const amount = Number(r.amountVnd ?? 0);
          const pit = Number(r.pitVnd ?? 0);
          const net = Number(r.netVnd ?? amount - pit);
          if (!r.pitVnd && !r.netVnd && r.status === "PENDING") {
            return <span className="text-caption text-ink-subtle">{t("withdrawTaxOnPay")}</span>;
          }
          return (
            <span className="tabular-nums">
              {fmtNum(net)}
              <span className="ml-1 text-caption text-ink-muted">
                (PIT {fmtNum(pit)})
              </span>
            </span>
          );
        },
      },
      {
        key: "status",
        header: t("status"),
        cell: (r) => {
          const overdue = r.status === "PENDING" && hoursAgo(r.createdAt) > 24;
          return (
            <div>
              <span>{statusLabel(t, r.status)}</span>
              {overdue ? <span className="ml-1 text-caption text-danger">{t("slaWarn")}</span> : null}
              {r.status === "REJECTED" && r.rejectReason ? (
                <div className="mt-0.5 max-w-[180px] text-caption text-danger">{r.rejectReason}</div>
              ) : null}
            </div>
          );
        },
      },
      {
        key: "time",
        header: t("time"),
        cell: (r) => (
          <div className="text-caption">
            <div>{fmtDate(r.createdAt, dateLocale)}</div>
            {r.paidAt ? (
              <div className="text-ink-muted">
                {t("withdrawPaidAt")}: {fmtDate(r.paidAt, dateLocale)}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: "actions",
        header: "",
        cell: (r) => {
          if (r.status !== "PENDING") return "—";
          if (!isSuperAdmin) {
            return <span className="text-caption text-ink-subtle">{t("dangerOpsSuperOnly")}</span>;
          }
          return (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="success"
                disabled={approveMut.isPending || rejectMut.isPending}
                onClick={() => setApproveTarget(r)}
              >
                {t("approve")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={approveMut.isPending || rejectMut.isPending}
                onClick={() => {
                  setRejectReason("");
                  setRejectTarget(r);
                }}
              >
                {t("reject")}
              </Button>
            </div>
          );
        },
      },
    ],
    [t, dateLocale, isSuperAdmin, approveMut.isPending, rejectMut.isPending],
  );

  const filterOptions: StatusFilter[] = ["PENDING", "REVIEWED", "ALL", "PAID", "REJECTED", "CANCELLED"];
  const moreValue = ["PENDING", "REVIEWED", "ALL"].includes(status) ? "" : status;

  return (
    <AdminShell title={t("withdraws")}>
      {toast ? (
        <div className="mb-3 shrink-0 rounded-xl border border-success/20 bg-success-soft px-3 py-2 text-body-sm text-success">
          {toast}
        </div>
      ) : null}
      {err || listQ.error ? (
        <p className="mb-3 shrink-0 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}

      <div className="mb-4 flex shrink-0 flex-wrap gap-2">
        {(["PENDING", "REVIEWED", "ALL"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={status === key ? "primary" : "secondary"}
            onClick={() => patchStatus(key)}
          >
            {key === "PENDING"
              ? t("withdrawFilterPending")
              : key === "REVIEWED"
                ? t("withdrawFilterReviewed")
                : t("all")}
          </Button>
        ))}
      </div>

      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-white/45 p-3">
        <Select
          className="w-40"
          value={moreValue}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            patchStatus(v as StatusFilter);
          }}
        >
          <option value="">{t("withdrawFilterMore")}</option>
          {filterOptions
            .filter((s) => s !== "PENDING" && s !== "REVIEWED" && s !== "ALL")
            .map((s) => (
              <option key={s} value={s}>
                {statusLabel(t, s)}
              </option>
            ))}
        </Select>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setPage(1);
            syncUrl({ status, page: 1, pageSize });
            void listQ.refetch();
          }}
        >
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

      <DataTable
        columns={columns}
        rows={listQ.data?.rows || []}
        loading={listQ.isFetching && !listQ.data}
        emptyTitle={t("empty")}
        getRowKey={(r, i) => String(r.id ?? i)}
      />

      <AdminListPagination
        page={page}
        pageSize={pageSize}
        total={listQ.data?.total ?? 0}
        loading={listQ.isFetching}
        onPageChange={(next) => {
          setPage(next);
          syncUrl({ status, page: next, pageSize });
        }}
        onPageSizeChange={(next) => {
          setPageSize(next);
          setPage(1);
          syncUrl({ status, page: 1, pageSize: next });
        }}
      />

      <ConfirmModal
        open={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        busy={approveMut.isPending}
        title={t("approve")}
        message={t("confirmApproveWithdraw", {
          no: approveTarget?.requestNo || String(approveTarget?.id ?? ""),
          amount: fmtNum(approveTarget?.amountVnd),
        })}
        confirmLabel={t("approveAndPay")}
        confirmVariant="success"
        onConfirm={() => {
          if (!approveTarget) return;
          approveMut.mutate(String(approveTarget.id));
        }}
      />

      <GlassModal
        open={!!rejectTarget}
        onClose={() => {
          if (rejectMut.isPending) return;
          setRejectTarget(null);
          setRejectReason("");
        }}
        title={t("reject")}
        size="sm"
      >
        <p className="mb-3 text-body-sm text-ink-muted">
          {t("confirmRejectWithdraw", {
            no: rejectTarget?.requestNo || String(rejectTarget?.id ?? ""),
          })}
        </p>
        <Input
          className="mb-4 w-full"
          placeholder={t("rejectReasonPlaceholder")}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          disabled={rejectMut.isPending}
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={rejectMut.isPending}
            onClick={() => {
              setRejectTarget(null);
              setRejectReason("");
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={rejectMut.isPending || !rejectReason.trim()}
            onClick={() => {
              if (!rejectTarget || !rejectReason.trim()) return;
              rejectMut.mutate({ id: String(rejectTarget.id), reason: rejectReason.trim() });
            }}
          >
            {t("reject")}
          </Button>
        </div>
      </GlassModal>
    </AdminShell>
  );
}
