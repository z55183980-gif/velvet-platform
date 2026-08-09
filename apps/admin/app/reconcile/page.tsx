"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminDownloadCsv,
  adminListReconciliations,
  adminListSettings,
  adminRerunReconcile,
  adminSettleT7,
  asRows,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { useI18n } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";
import { Button, DataTable, Input, fmtDate, type Column } from "@velvet/ui";

type Row = {
  id?: string | number;
  date?: string;
  reconcileDate?: string;
  provider?: string;
  status?: string;
  localPaidCnt?: number;
  localCount?: number;
  remotePaidCnt?: number;
  remoteCount?: number;
  diff?: unknown;
  updatedAt?: string;
  createdAt?: string;
};

type Tab = "reconcile" | "settle";

export default function AdminReconcilePage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const searchParams = useLocationSearchParams();
  const [tab, setTab] = useState<Tab>(
    searchParams.get("tab") === "settle" ? "settle" : "reconcile",
  );
  const [days, setDays] = useState(1);
  const [settleDays, setSettleDays] = useState(7);
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTab(searchParams.get("tab") === "settle" ? "settle" : "reconcile");
  }, [searchParams]);

  const listQ = useQuery({
    queryKey: ["admin", "reconcile"],
    queryFn: async () => asRows<Row>(await adminListReconciliations(1, 50)),
    enabled: tab === "reconcile",
  });

  const settleSettingsQ = useQuery({
    queryKey: ["admin", "settings", "creatorSettleDays"],
    queryFn: async () => {
      const result = (await adminListSettings()) as {
        items?: Array<{ key: string; value: unknown }>;
      };
      const raw = result.items?.find((item) => item.key === "creatorSettleDays")?.value;
      const n = Math.floor(Number(raw));
      return Number.isFinite(n) ? Math.min(365, Math.max(0, n)) : 7;
    },
    enabled: tab === "settle",
  });

  useEffect(() => {
    if (settleSettingsQ.data == null) return;
    setSettleDays(settleSettingsQ.data);
  }, [settleSettingsQ.data]);

  const rerunMut = useMutation({
    mutationFn: () => adminRerunReconcile(days),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "reconcile"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const exportMut = useMutation({
    mutationFn: () => adminDownloadCsv("reconciliations"),
    onError: (e: Error) => setErr(e.message),
  });

  const settleMut = useMutation({
    mutationFn: () => adminSettleT7(settleDays),
    onSuccess: (data) => {
      setResult(data);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const switchTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "settle") url.searchParams.set("tab", "settle");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const columns: Column<Row>[] = useMemo(
    () => [
      { key: "date", header: t("colDate"), cell: (r) => r.date || r.reconcileDate || "—" },
      { key: "provider", header: t("colProvider"), cell: (r) => r.provider || "—" },
      { key: "status", header: t("status"), cell: (r) => r.status || "—" },
      {
        key: "local",
        header: t("colLocal"),
        cell: (r) => String(r.localPaidCnt ?? r.localCount ?? "—"),
      },
      {
        key: "remote",
        header: t("colRemote"),
        cell: (r) => String(r.remotePaidCnt ?? r.remoteCount ?? "—"),
      },
      {
        key: "diff",
        header: t("colDiff"),
        cell: (r) => (
          <span className="max-w-xs truncate font-mono text-caption">
            {typeof r.diff === "object" ? JSON.stringify(r.diff) : String(r.diff ?? "—")}
          </span>
        ),
      },
      {
        key: "updated",
        header: t("colUpdated"),
        cell: (r) => fmtDate(r.updatedAt || r.createdAt, locale === "en" ? "en-US" : "zh-CN"),
        className: "text-caption",
      },
    ],
    [t, locale],
  );

  return (
    <AdminShell title={tab === "settle" ? t("settle") : t("reconcile")}>
      {err || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{err || (listQ.error as Error).message}</p>
      ) : null}

      <div className="mb-4 flex gap-2">
        <Button
          size="sm"
          variant={tab === "reconcile" ? "primary" : "secondary"}
          onClick={() => switchTab("reconcile")}
        >
          {t("reconcileTab")}
        </Button>
        <Button
          size="sm"
          variant={tab === "settle" ? "primary" : "secondary"}
          onClick={() => switchTab("settle")}
        >
          {t("settle")}
        </Button>
      </div>

      {tab === "reconcile" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              max={30}
              className="w-20"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
            <Button size="sm" disabled={rerunMut.isPending} onClick={() => rerunMut.mutate()}>
              {t("rerunReconcile")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => listQ.refetch()}
              disabled={listQ.isFetching}
            >
              {t("refresh")}
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
            rows={listQ.data || []}
            loading={listQ.isFetching}
            emptyTitle={t("empty")}
            getRowKey={(r, i) => String(r.id || `${r.date}-${r.provider}-${i}`)}
          />
        </>
      ) : (
        <>
          <div className="mb-6 max-w-xl space-y-4 card glass-card p-4">
            <p className="text-body-sm text-ink-muted">{t("settleDescription")}</p>
            <label className="block text-caption text-ink-muted">
              {t("settleWindowDays")}
              <Input
                type="number"
                className="mt-1 w-32"
                min={0}
                value={settleDays}
                onChange={(e) => setSettleDays(Number(e.target.value))}
              />
            </label>
            <Button size="sm" disabled={settleMut.isPending} onClick={() => settleMut.mutate()}>
              {settleMut.isPending ? t("settling") : t("runSettleT7")}
            </Button>
          </div>
          {result != null ? (
            <pre className="max-h-96 overflow-auto rounded-lg bg-surface-2 p-4 text-caption">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
