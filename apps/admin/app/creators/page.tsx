"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveKyc,
  adminCloseCreator,
  adminListCreators,
  adminListKyc,
  adminRejectKyc,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { AdminListPagination } from "@/components/admin-list-pagination";
import { ConfirmModal } from "@/components/glass-modal";
import { ADMIN_TEXT_ACTION_CLASS, ADMIN_TEXT_LINK_CLASS } from "@/lib/admin-action-styles";
import {
  asPaginatedList,
  parseAdminPage,
  parseAdminPageSize,
  patchListPaginationUrl,
} from "@/lib/admin-list-pagination";
import { useAdminSession } from "@/lib/admin-session";
import { useI18n, statusLabel } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";
import { Button, DataTable, EmptyState, Input, Select, Skeleton, fmtNum, type Column } from "@velvet/ui";

type CreatorRow = {
  id: string | number;
  displayName?: string;
  kycStatus?: string;
  earnings?: {
    availableVnd?: string | number;
    pendingVnd?: string | number;
    withdrawnVnd?: string | number;
    totalEarnedVnd?: string | number;
  };
  user?: { id?: string | number; email?: string | null; phone?: string | null; status?: string };
  _count?: { dramas?: number };
};

type KycRow = {
  id: string | number;
  displayName?: string;
  cccdNumber?: string;
  kycStatus?: string;
  kycRejectReason?: string | null;
  cccdFrontUrl?: string | null;
  cccdBackUrl?: string | null;
  user?: { email?: string | null; phone?: string | null };
};

/** "pending" is an alias of "kyc" (legacy tab=pending redirects here). */
type Tab = "all" | "kyc";

function tabFromSearch(v: string | null): Tab {
  if (v === "kyc" || v === "pending") return "kyc";
  return "all";
}

export default function AdminCreatorsPage() {
  const { t } = useI18n();
  const { admin } = useAdminSession();
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";
  const qc = useQueryClient();
  const searchParams = useLocationSearchParams();
  const [tab, setTab] = useState<Tab>(() => tabFromSearch(searchParams.get("tab")));
  const [q, setQ] = useState(() => searchParams.get("q") || "");
  const [kyc, setKyc] = useState(() => searchParams.get("kyc") || "ALL");
  const [sort, setSort] = useState(() => searchParams.get("sort") || "available");
  const [applied, setApplied] = useState({
    q: searchParams.get("q") || "",
    kyc: searchParams.get("kyc") || "ALL",
    sort: searchParams.get("sort") || "available",
  });
  const [kycStatus, setKycStatus] = useState(() => searchParams.get("kycStatus") || "PENDING");
  const [page, setPage] = useState(() => parseAdminPage(searchParams.get("page")));
  const [pageSize, setPageSize] = useState(() => parseAdminPageSize(searchParams.get("pageSize")));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<CreatorRow | null>(null);

  useEffect(() => {
    setTab(tabFromSearch(searchParams.get("tab")));
    setPage(parseAdminPage(searchParams.get("page")));
    setPageSize(parseAdminPageSize(searchParams.get("pageSize")));
    if (searchParams.get("tab") === "kyc" || searchParams.get("tab") === "pending") {
      setKycStatus(searchParams.get("kycStatus") || "PENDING");
    } else {
      setApplied({
        q: searchParams.get("q") || "",
        kyc: searchParams.get("kyc") || "ALL",
        sort: searchParams.get("sort") || "available",
      });
      setQ(searchParams.get("q") || "");
      setKyc(searchParams.get("kyc") || "ALL");
      setSort(searchParams.get("sort") || "available");
    }
  }, [searchParams]);

  // Search box: debounce apply; KYC/sort still via 查询 button (and button applies immediately).
  useEffect(() => {
    if (tab !== "all") return;
    const trimmed = q.trim();
    if (trimmed === applied.q) return;
    const timer = window.setTimeout(() => {
      setApplied((prev) => ({ ...prev, q: trimmed }));
      setPage(1);
      syncListUrl({ tab: "all", q: trimmed, kyc: applied.kyc, sort: applied.sort, page: 1, pageSize });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [q, applied.q, applied.kyc, applied.sort, tab, pageSize]);

  function syncListUrl(opts: {
    tab: Tab;
    page: number;
    pageSize: number;
    q?: string;
    kyc?: string;
    sort?: string;
    kycStatus?: string;
  }) {
    patchListPaginationUrl({
      page: opts.page,
      pageSize: opts.pageSize,
      extra: (url) => {
        if (opts.tab === "kyc") {
          url.searchParams.set("tab", "kyc");
          url.searchParams.delete("q");
          url.searchParams.delete("kyc");
          url.searchParams.delete("sort");
          if (opts.kycStatus && opts.kycStatus !== "PENDING") {
            url.searchParams.set("kycStatus", opts.kycStatus);
          } else {
            url.searchParams.delete("kycStatus");
          }
        } else {
          url.searchParams.delete("tab");
          url.searchParams.delete("kycStatus");
          if (opts.q) url.searchParams.set("q", opts.q);
          else url.searchParams.delete("q");
          if (opts.kyc && opts.kyc !== "ALL") url.searchParams.set("kyc", opts.kyc);
          else url.searchParams.delete("kyc");
          if (opts.sort && opts.sort !== "available") url.searchParams.set("sort", opts.sort);
          else url.searchParams.delete("sort");
        }
      },
    });
  }

  const listQ = useQuery({
    queryKey: ["admin", "creators", applied, page, pageSize],
    queryFn: async () =>
      asPaginatedList<CreatorRow>(
        await adminListCreators({
          q: applied.q || undefined,
          kyc: applied.kyc,
          sort: applied.sort,
          page,
          pageSize,
        }),
      ),
    enabled: tab === "all",
  });

  const kycQ = useQuery({
    queryKey: ["admin", "kyc", kycStatus, page, pageSize],
    queryFn: async () =>
      asPaginatedList<KycRow>(
        await adminListKyc({ status: kycStatus, page, pageSize }),
      ),
    enabled: tab === "kyc",
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApproveKyc(id),
    onSuccess: async () => {
      setErr(null);
      setToast(t("approveReviewOk"));
      await qc.invalidateQueries({ queryKey: ["admin", "kyc"] });
      await qc.invalidateQueries({ queryKey: ["admin", "creators"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminRejectKyc(id, reason),
    onSuccess: async () => {
      setErr(null);
      setToast(t("rejectReviewOk"));
      await qc.invalidateQueries({ queryKey: ["admin", "kyc"] });
      await qc.invalidateQueries({ queryKey: ["admin", "creators"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const closeMut = useMutation({
    mutationFn: (id: string) => adminCloseCreator(id),
    onSuccess: async (res) => {
      setErr(null);
      setCloseTarget(null);
      setToast(res?.alreadyClosed ? t("closeAccountAlready") : t("closeAccountOk"));
      await qc.invalidateQueries({ queryKey: ["admin", "creators"] });
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => {
      setCloseTarget(null);
      setErr(e.message);
    },
  });

  const switchTab = (next: Tab) => {
    setTab(next);
    setPage(1);
    syncListUrl({
      tab: next,
      page: 1,
      pageSize,
      q: applied.q,
      kyc: applied.kyc,
      sort: applied.sort,
      kycStatus,
    });
  };

  const applyAllFilters = () => {
    const next = { q: q.trim(), kyc, sort };
    setApplied(next);
    setPage(1);
    syncListUrl({ tab: "all", ...next, page: 1, pageSize });
  };

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    syncListUrl({
      tab,
      page: nextPage,
      pageSize,
      q: applied.q,
      kyc: applied.kyc,
      sort: applied.sort,
      kycStatus,
    });
  };

  const changePageSize = (nextSize: number) => {
    setPageSize(nextSize);
    setPage(1);
    syncListUrl({
      tab,
      page: 1,
      pageSize: nextSize,
      q: applied.q,
      kyc: applied.kyc,
      sort: applied.sort,
      kycStatus,
    });
  };

  const columns: Column<CreatorRow>[] = useMemo(
    () => [
      {
        key: "creator",
        header: t("colCreator"),
        cell: (r) => (
          <div>
            <div>{r.displayName}</div>
            <div className="text-caption text-ink-muted">{r.user?.email || r.user?.phone}</div>
          </div>
        ),
      },
      { key: "kyc", header: t("colKyc"), cell: (r) => statusLabel(t, r.kycStatus) },
      {
        key: "account",
        header: t("status"),
        cell: (r) => statusLabel(t, r.user?.status || "ACTIVE"),
      },
      {
        key: "available",
        header: t("withdrawable"),
        cell: (r) => fmtNum(r.earnings?.availableVnd),
        className: "tabular-nums",
      },
      {
        key: "pending",
        header: t("earningsFrozen"),
        cell: (r) => fmtNum(r.earnings?.pendingVnd),
        className: "tabular-nums",
      },
      {
        key: "withdrawn",
        header: t("earningsWithdrawn"),
        cell: (r) => fmtNum(r.earnings?.withdrawnVnd),
        className: "tabular-nums",
      },
      {
        key: "total",
        header: t("earningsTotal"),
        cell: (r) => fmtNum(r.earnings?.totalEarnedVnd),
        className: "tabular-nums",
      },
      { key: "dramas", header: t("colDramas"), cell: (r) => String(r._count?.dramas ?? "—") },
      {
        key: "actions",
        header: "",
        cell: (r) => {
          const closed = r.user?.status === "BANNED";
          return (
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/creators/${r.id}`} className={ADMIN_TEXT_LINK_CLASS}>
                {t("details")}
              </Link>
              {isSuperAdmin ? (
                closed ? (
                  <span className="text-body-sm text-ink-subtle">{t("closeAccountAlready")}</span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={ADMIN_TEXT_ACTION_CLASS}
                    disabled={closeMut.isPending}
                    onClick={() => setCloseTarget(r)}
                  >
                    {t("closeAccount")}
                  </Button>
                )
              ) : null}
            </div>
          );
        },
      },
    ],
    [t, isSuperAdmin, closeMut.isPending],
  );

  const activeError = tab === "all" ? listQ.error : kycQ.error;
  const kycRows = kycQ.data?.rows || [];
  const listTotal = tab === "all" ? (listQ.data?.total ?? 0) : (kycQ.data?.total ?? 0);
  const listLoading = tab === "all" ? listQ.isFetching : kycQ.isFetching;

  return (
    <AdminShell title={tab === "kyc" ? t("kyc") : t("creators")}>
      {toast ? (
        <div className="mb-3 shrink-0 rounded-xl border border-success/20 bg-success-soft px-3 py-2 text-body-sm text-success">
          {toast}
        </div>
      ) : null}
      {err || activeError ? (
        <p className="mb-3 shrink-0 text-body-sm text-danger">
          {err || (activeError as Error).message}
        </p>
      ) : null}

      <div className="mb-4 flex shrink-0 flex-wrap gap-2">
        <Button
          size="sm"
          variant={tab === "all" ? "primary" : "secondary"}
          onClick={() => switchTab("all")}
        >
          {t("all")}
        </Button>
        <Button
          size="sm"
          variant={tab === "kyc" ? "primary" : "secondary"}
          onClick={() => switchTab("kyc")}
        >
          {t("kyc")}
        </Button>
      </div>

      {tab === "all" ? (
        <>
          <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-white/45 p-3">
            <Input
              className="w-48"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("creatorSearchPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyAllFilters();
              }}
            />
            <Select className="w-40" value={kyc} onChange={(e) => setKyc(e.target.value)}>
              {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
                <option key={s} value={s}>
                  KYC {statusLabel(t, s)}
                </option>
              ))}
            </Select>
            <Select className="w-40" value={sort} onChange={(e) => setSort(e.target.value)}>
              {["available", "pending", "withdrawn", "total"].map((s) => (
                <option key={s} value={s}>
                  {t("colSort")}: {s}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="primary" onClick={applyAllFilters}>
              {t("query")}
            </Button>
          </div>
          <DataTable
            columns={columns}
            rows={listQ.data?.rows || []}
            loading={listQ.isFetching && !listQ.data}
            emptyTitle={t("empty")}
            getRowKey={(r, i) => String(r.id ?? i)}
          />
        </>
      ) : null}

      {tab === "kyc" ? (
        <>
          <p className="mb-4 shrink-0 text-body-sm text-ink-muted">{t("kycTabHint")}</p>
          <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-white/45 p-3">
            <Select
              className="w-40"
              value={kycStatus}
              onChange={(e) => {
                const next = e.target.value;
                setKycStatus(next);
                setPage(1);
                syncListUrl({ tab: "kyc", page: 1, pageSize, kycStatus: next });
              }}
            >
              {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
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
                syncListUrl({ tab: "kyc", page: 1, pageSize, kycStatus });
                void kycQ.refetch();
              }}
            >
              {t("query")}
            </Button>
          </div>

          {kycQ.isFetching && !kycRows.length ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full" />
              ))}
            </div>
          ) : !kycRows.length ? (
            <EmptyState title={t("empty")} className="card glass-card admin-fill" />
          ) : (
            <div className="space-y-4">
              {kycRows.map((r) => (
                <div key={String(r.id)} className="card glass-card p-4">
                  <div className="mb-3 flex flex-wrap justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.displayName}</p>
                      <p className="text-caption text-ink-muted">
                        {r.user?.email || r.user?.phone} · CCCD {r.cccdNumber || "—"} · {statusLabel(t, r.kycStatus)}
                      </p>
                      {r.kycRejectReason ? (
                        <p className="mt-1 text-caption text-danger">{r.kycRejectReason}</p>
                      ) : null}
                      <Link href={`/creators/${r.id}`} className={`mt-1 ${ADMIN_TEXT_LINK_CLASS}`}>
                        {t("details")}
                      </Link>
                    </div>
                    {r.kycStatus === "PENDING" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="success"
                          onClick={() => approveMut.mutate(String(r.id))}
                        >
                          {t("approve")}
                        </Button>
                        <Input
                          className="w-40"
                          placeholder={t("rejectReasonPlaceholder")}
                          value={reasons[String(r.id)] || ""}
                          onChange={(e) =>
                            setReasons((m) => ({ ...m, [String(r.id)]: e.target.value }))
                          }
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            rejectMut.mutate({
                              id: String(r.id),
                              reason: reasons[String(r.id)] || "",
                            })
                          }
                        >
                          {t("reject")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { url: r.cccdFrontUrl, label: t("cccdFront") },
                      { url: r.cccdBackUrl, label: t("cccdBack") },
                    ].map((d) =>
                      d.url ? (
                        <button
                          key={d.label}
                          type="button"
                          className="text-left"
                          onClick={() => setPreview(d.url!)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={d.url}
                            alt={d.label}
                            className="h-28 w-44 rounded border border-line bg-surface-2 object-cover"
                          />
                          <span className="mt-1 block text-caption text-ink-muted">{d.label}</span>
                        </button>
                      ) : (
                        <div
                          key={d.label}
                          className="flex h-28 w-44 items-center justify-center rounded border border-dashed border-line text-caption text-ink-muted"
                        >
                          {d.label}: —
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      <AdminListPagination
        page={page}
        pageSize={pageSize}
        total={listTotal}
        loading={listLoading}
        onPageChange={goToPage}
        onPageSizeChange={changePageSize}
      />

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : null}

      <ConfirmModal
        open={!!closeTarget}
        onClose={() => setCloseTarget(null)}
        busy={closeMut.isPending}
        title={t("closeAccount")}
        message={t("confirmCloseCreatorAccount", {
          name: closeTarget?.displayName || String(closeTarget?.id ?? ""),
        })}
        confirmLabel={t("closeAccount")}
        confirmVariant="danger"
        onConfirm={() => {
          if (!closeTarget) return;
          closeMut.mutate(String(closeTarget.id));
        }}
      />
    </AdminShell>
  );
}
