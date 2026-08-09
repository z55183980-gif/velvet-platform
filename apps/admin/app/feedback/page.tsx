"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminListFeedback, adminSetFeedbackStatus } from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { AdminListPagination } from "@/components/admin-list-pagination";
import { GlassModal } from "@/components/glass-modal";
import {
  asPaginatedList,
  parseAdminPage,
  parseAdminPageSize,
  patchListPaginationUrl,
} from "@/lib/admin-list-pagination";
import { useI18n, statusLabel } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";
import { Button, DataTable, fmtDate, type Column } from "@velvet/ui";

type FeedbackRow = {
  id: string;
  category?: string;
  contactEmail?: string | null;
  body?: string;
  locale?: string | null;
  status?: string;
  createdAt?: string;
  reviewedAt?: string | null;
  user?: {
    id?: string;
    email?: string | null;
    phone?: string | null;
    nickname?: string | null;
  } | null;
};

type StatusFilter = "NEW" | "REVIEWING" | "CLOSED" | "ALL";

function statusFromSearch(raw: string | null): StatusFilter {
  if (!raw) return "NEW";
  const upper = raw.toUpperCase();
  if (upper === "NEW" || upper === "REVIEWING" || upper === "CLOSED" || upper === "ALL") {
    return upper;
  }
  return "NEW";
}

function truncate(text: string | undefined, max = 72): string {
  const s = (text || "").trim();
  if (s.length <= max) return s || "—";
  return `${s.slice(0, max)}…`;
}

export default function AdminFeedbackPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const searchParams = useLocationSearchParams();
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const [status, setStatus] = useState<StatusFilter>(() =>
    statusFromSearch(searchParams.get("status")),
  );
  const [page, setPage] = useState(() => parseAdminPage(searchParams.get("page")));
  const [pageSize, setPageSize] = useState(() => parseAdminPageSize(searchParams.get("pageSize")));
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<FeedbackRow | null>(null);

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
          if (next.status === "NEW") url.searchParams.delete("status");
          else url.searchParams.set("status", next.status);
        },
      });
    },
    [],
  );

  const patchStatus = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
    syncUrl({ status: next, page: 1, pageSize });
  };

  const listQ = useQuery({
    queryKey: ["admin", "feedback", status, page, pageSize],
    queryFn: async () =>
      asPaginatedList<FeedbackRow>(
        await adminListFeedback({
          status,
          page,
          pageSize,
        }),
      ),
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["admin", "feedback"] });
  };

  const statusMut = useMutation({
    mutationFn: ({ id, next }: { id: string; next: "NEW" | "REVIEWING" | "CLOSED" }) =>
      adminSetFeedbackStatus(id, next),
    onSuccess: async () => {
      setErr(null);
      await invalidate();
      setDetail(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const categoryLabel = (c?: string) => {
    if (c === "complaint") return t("feedbackCatComplaint");
    if (c === "suggestion") return t("feedbackCatSuggestion");
    if (c === "feedback") return t("feedbackCatFeedback");
    return c || "—";
  };

  const cols: Column<FeedbackRow>[] = useMemo(
    () => [
      {
        key: "createdAt",
        header: t("createdAt"),
        cell: (r) => (r.createdAt ? fmtDate(r.createdAt, dateLocale) : "—"),
        className: "whitespace-nowrap text-caption",
      },
      {
        key: "category",
        header: t("colType"),
        cell: (r) => categoryLabel(r.category),
      },
      {
        key: "email",
        header: t("feedbackContactEmail"),
        cell: (r) => r.contactEmail || r.user?.email || "—",
        className: "max-w-[12rem] truncate",
      },
      {
        key: "body",
        header: t("feedbackBody"),
        cell: (r) => (
          <button
            type="button"
            className="max-w-[20rem] truncate text-left text-ink hover:underline"
            onClick={() => setDetail(r)}
            title={r.body}
          >
            {truncate(r.body)}
          </button>
        ),
      },
      {
        key: "status",
        header: t("status"),
        cell: (r) => statusLabel(t, r.status),
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (r) => (
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => setDetail(r)}>
              {t("openDetail")}
            </Button>
            {r.status === "NEW" ? (
              <Button
                size="sm"
                onClick={() => statusMut.mutate({ id: r.id, next: "REVIEWING" })}
                disabled={statusMut.isPending}
              >
                {t("feedbackMarkReviewing")}
              </Button>
            ) : null}
            {r.status !== "CLOSED" ? (
              <Button
                size="sm"
                variant="success"
                onClick={() => statusMut.mutate({ id: r.id, next: "CLOSED" })}
                disabled={statusMut.isPending}
              >
                {t("feedbackMarkClosed")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => statusMut.mutate({ id: r.id, next: "NEW" })}
                disabled={statusMut.isPending}
              >
                {t("feedbackReopen")}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [t, dateLocale, statusMut],
  );

  const filters: StatusFilter[] = ["NEW", "REVIEWING", "CLOSED", "ALL"];
  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;

  return (
    <AdminShell title={t("feedback")}>
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {err || (listQ.error as Error)?.message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {filters.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "primary" : "secondary"}
            onClick={() => patchStatus(s)}
          >
            {statusLabel(t, s)}
          </Button>
        ))}
      </div>

      <DataTable
        columns={cols}
        rows={rows}
        emptyTitle={t("empty")}
        loading={listQ.isLoading}
        getRowKey={(r) => r.id}
      />

      <AdminListPagination
        page={page}
        pageSize={pageSize}
        total={total}
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

      <GlassModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={t("feedbackDetail")}
      >
        {detail ? (
          <div className="space-y-3 text-body-sm text-ink">
            <p>
              <span className="text-ink-muted">{t("colType")}：</span>
              {categoryLabel(detail.category)}
            </p>
            <p>
              <span className="text-ink-muted">{t("feedbackContactEmail")}：</span>
              {detail.contactEmail || "—"}
            </p>
            <p>
              <span className="text-ink-muted">{t("status")}：</span>
              {statusLabel(t, detail.status)}
            </p>
            <p>
              <span className="text-ink-muted">{t("createdAt")}：</span>
              {detail.createdAt ? fmtDate(detail.createdAt, dateLocale) : "—"}
            </p>
            <div className="rounded-md border border-line bg-surface-2 px-3 py-3 whitespace-pre-wrap">
              {detail.body || "—"}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {detail.status === "NEW" ? (
                <Button
                  size="sm"
                  onClick={() => statusMut.mutate({ id: detail.id, next: "REVIEWING" })}
                  disabled={statusMut.isPending}
                >
                  {t("feedbackMarkReviewing")}
                </Button>
              ) : null}
              {detail.status !== "CLOSED" ? (
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => statusMut.mutate({ id: detail.id, next: "CLOSED" })}
                  disabled={statusMut.isPending}
                >
                  {t("feedbackMarkClosed")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => statusMut.mutate({ id: detail.id, next: "NEW" })}
                  disabled={statusMut.isPending}
                >
                  {t("feedbackReopen")}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </GlassModal>
    </AdminShell>
  );
}
