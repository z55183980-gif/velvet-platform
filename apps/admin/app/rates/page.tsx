"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminListAuditLogs, adminListRates, adminSetRate, asRows } from "@velvet/api-client";
import { exchangeRateSchema } from "@velvet/validators";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";
import { Button, DataTable, Input, fmtDate, type Column } from "@velvet/ui";
import { useState } from "react";

type RateRow = {
  id?: string;
  currency: string;
  cnyToFiat?: string | number;
  buyRate?: string | number;
  updatedAt?: string;
};

type AuditRow = {
  id: string | number;
  createdAt?: string;
  action?: string;
  payload?: unknown;
};

export default function AdminRatesPage() {
  const qc = useQueryClient();
  const [currency, setCurrency] = useState("VND");
  const [cnyToFiat, setCnyToFiat] = useState(3500);
  const [formErr, setFormErr] = useState<string | null>(null);

  const ratesQ = useQuery({
    queryKey: ["admin", "rates"],
    queryFn: async () => {
      const r = await adminListRates();
      return asRows<RateRow>(r);
    },
  });

  const historyQ = useQuery({
    queryKey: ["admin", "rates", "history"],
    queryFn: async () => {
      const h = await adminListAuditLogs({ action: "exchangeRate.upsert", pageSize: 30 });
      return asRows<AuditRow>(h);
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsed = exchangeRateSchema.safeParse({ currency, cnyToFiat, sellRate: cnyToFiat });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || "校验失败");
      }
      return adminSetRate(parsed.data);
    },
    onSuccess: async () => {
      setFormErr(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "rates"] }),
        qc.invalidateQueries({ queryKey: ["admin", "rates", "history"] }),
      ]);
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const preview = (10 * cnyToFiat).toLocaleString("zh-CN");
  const rateCols: Column<RateRow>[] = [
    { key: "currency", header: "Currency", cell: (r) => r.currency },
    {
      key: "rate",
      header: "1 CNY =",
      cell: (r) => String(r.cnyToFiat ?? r.buyRate),
      className: "tabular-nums",
    },
    { key: "updated", header: "Updated", cell: (r) => fmtDate(r.updatedAt), className: "text-caption" },
  ];
  const histCols: Column<AuditRow>[] = [
    { key: "time", header: "Time", cell: (r) => fmtDate(r.createdAt), className: "text-caption" },
    { key: "action", header: "Action", cell: (r) => r.action || "—" },
    {
      key: "payload",
      header: "Payload",
      cell: (r) => (
        <span className="max-w-lg truncate font-mono text-caption">{JSON.stringify(r.payload)}</span>
      ),
    },
  ];

  return (
    <AdminShell title={t("rates")}>
      <p className="mb-4 text-body-sm text-ink-muted">
        含义：1 人民币 = N 该币种。例：1 CNY = 3500 VND → ¥10 套餐应付 35000 VND，到账积分仍以套餐为准。
      </p>
      {formErr || ratesQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {formErr || (ratesQ.error as Error)?.message}
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-4">
        <label className="text-caption text-ink-muted">
          Currency
          <Input
            className="mt-1 w-28"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <label className="text-caption text-ink-muted">
          1 CNY =
          <Input
            type="number"
            step="any"
            className="mt-1 w-36"
            value={cnyToFiat}
            onChange={(e) => setCnyToFiat(Number(e.target.value))}
          />
        </label>
        <p className="pb-2 text-caption text-ink-subtle">预览：¥10 ≈ {preview} {currency}</p>
        <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {t("save")}
        </Button>
      </div>

      <h2 className="mb-2 text-h4">当前汇率</h2>
      <div className="mb-8">
        <DataTable
          columns={rateCols}
          rows={ratesQ.data || []}
          loading={ratesQ.isFetching}
          emptyTitle={t("empty")}
          getRowKey={(r) => r.currency || String(r.id)}
        />
      </div>

      <h2 className="mb-2 text-h4">变更历史（审计）</h2>
      <DataTable
        columns={histCols}
        rows={historyQ.data || []}
        loading={historyQ.isFetching}
        emptyTitle={t("empty")}
      />
    </AdminShell>
  );
}
