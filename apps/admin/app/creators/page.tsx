"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminApproveKyc,
  adminListCreators,
  adminListKyc,
  adminPendingCreators,
  adminRejectKyc,
  asRows,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
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
  user?: { email?: string | null; phone?: string | null };
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

type Tab = "all" | "pending" | "kyc";

export default function AdminCreatorsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const searchParams = useLocationSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const v = searchParams.get("tab");
    return v === "kyc" || v === "pending" ? v : "all";
  });
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState("ALL");
  const [sort, setSort] = useState("available");
  const [applied, setApplied] = useState({ q: "", kyc: "ALL", sort: "available" });
  const [kycStatus, setKycStatus] = useState("PENDING");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const v = searchParams.get("tab");
    setTab(v === "kyc" || v === "pending" ? v : "all");
  }, [searchParams]);

  const listQ = useQuery({
    queryKey: ["admin", "creators", applied],
    queryFn: async () =>
      asRows<CreatorRow>(
        await adminListCreators({
          q: applied.q || undefined,
          kyc: applied.kyc,
          sort: applied.sort,
          page: 1,
          pageSize: 40,
        }),
      ),
    enabled: tab === "all",
  });

  const pendingQ = useQuery({
    queryKey: ["admin", "creators", "pending"],
    queryFn: async () => {
      const data = await adminPendingCreators();
      return (Array.isArray(data) ? data : asRows<CreatorRow>(data)).map((row) => ({
        ...row,
        id: typeof row.id === "bigint" ? row.id.toString() : row.id,
      }));
    },
    enabled: tab === "pending",
  });

  const kycQ = useQuery({
    queryKey: ["admin", "kyc", kycStatus],
    queryFn: async () => asRows<KycRow>(await adminListKyc({ status: kycStatus, page: 1, pageSize: 40 })),
    enabled: tab === "kyc",
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApproveKyc(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "kyc"] });
      await qc.invalidateQueries({ queryKey: ["admin", "creators"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminRejectKyc(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "kyc"] });
      await qc.invalidateQueries({ queryKey: ["admin", "creators"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const switchTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.pathname + url.search);
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
        cell: (r) => (
          <Link href={`/creators/${r.id}`} className="text-body-sm text-brand hover:underline">
            {t("details")}
          </Link>
        ),
      },
    ],
    [t],
  );

  const pendingColumns: Column<CreatorRow>[] = useMemo(
    () => [
      {
        key: "creator",
        header: t("colCreator"),
        cell: (r) => <div>{r.displayName || String(r.id)}</div>,
      },
      { key: "kyc", header: t("colKyc"), cell: (r) => statusLabel(t, r.kycStatus || "PENDING") },
      {
        key: "actions",
        header: "",
        cell: (r) => (
          <div className="flex gap-2">
            <Link href={`/creators/${r.id}`} className="text-body-sm text-brand hover:underline">
              {t("details")}
            </Link>
            <button
              type="button"
              className="text-body-sm text-brand hover:underline"
              onClick={() => switchTab("kyc")}
            >
              {t("goKycReview")}
            </button>
          </div>
        ),
      },
    ],
    [t],
  );

  const activeError =
    tab === "all" ? listQ.error : tab === "pending" ? pendingQ.error : kycQ.error;
  const kycRows = kycQ.data || [];

  return (
    <AdminShell title={tab === "kyc" ? t("kyc") : t("creators")}>
      {err || activeError ? (
        <p className="mb-3 text-body-sm text-danger">
          {err || (activeError as Error).message}
        </p>
      ) : null}

      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === "all" ? "primary" : "secondary"} onClick={() => switchTab("all")}>
          {t("all")}
        </Button>
        <Button
          size="sm"
          variant={tab === "pending" ? "primary" : "secondary"}
          onClick={() => switchTab("pending")}
        >
          {t("pendingCreators")}
        </Button>
        <Button size="sm" variant={tab === "kyc" ? "primary" : "secondary"} onClick={() => switchTab("kyc")}>
          {t("kyc")}
        </Button>
      </div>

      {tab === "all" ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Input
              className="w-48"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("creatorSearchPlaceholder")}
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
            <Button size="sm" onClick={() => setApplied({ q, kyc, sort })}>
              {t("query")}
            </Button>
          </div>
          <DataTable
            columns={columns}
            rows={listQ.data || []}
            loading={listQ.isFetching}
            emptyTitle={t("empty")}
          />
        </>
      ) : null}

      {tab === "pending" ? (
        <>
          <p className="mb-4 text-body-sm text-ink-muted">{t("pendingCreatorsHint")}</p>
          <DataTable
            columns={pendingColumns}
            rows={pendingQ.data || []}
            loading={pendingQ.isFetching}
            emptyTitle={t("empty")}
          />
        </>
      ) : null}

      {tab === "kyc" ? (
        <>
          <Select
            className="mb-4 w-40"
            value={kycStatus}
            onChange={(e) => setKycStatus(e.target.value)}
          >
            {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
              <option key={s} value={s}>
                {statusLabel(t, s)}
              </option>
            ))}
          </Select>

          {kycQ.isFetching && !kycRows.length ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full" />
              ))}
            </div>
          ) : !kycRows.length ? (
            <EmptyState title={t("empty")} />
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
                    </div>
                    {r.kycStatus === "PENDING" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => approveMut.mutate(String(r.id))}>
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

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : null}
    </AdminShell>
  );
}
