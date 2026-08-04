"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminListAuditLogs,
  adminListRates,
  adminListSettings,
  adminSetRate,
  adminUpdateSetting,
  asRows,
} from "@velvet/api-client";
import { exchangeRateSchema } from "@velvet/validators";
import { Button, DataTable, Input, Select, fmtDate, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";

type Setting = {
  key: string;
  value: unknown;
  type?: string;
  labelZh?: string;
  labelVi?: string;
  updatedAt?: string;
};

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

type Tab = "config" | "rates";

function parseValue(setting: Setting, raw: string) {
  if (setting.type === "boolean") return raw === "true" || raw === "1";
  if (setting.type === "number") return Number(raw);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default function AdminSettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const searchParams = useLocationSearchParams();
  const [tab, setTab] = useState<Tab>(
    searchParams.get("tab") === "rates" ? "rates" : "config",
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("VND");
  const [cnyToFiat, setCnyToFiat] = useState(3500);
  const [formErr, setFormErr] = useState<string | null>(null);

  useEffect(() => {
    setTab(searchParams.get("tab") === "rates" ? "rates" : "config");
  }, [searchParams]);

  const settingsQ = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const result = (await adminListSettings()) as { items?: Setting[] };
      return result.items ?? [];
    },
    enabled: tab === "config",
  });

  const ratesQ = useQuery({
    queryKey: ["admin", "rates"],
    queryFn: async () => asRows<RateRow>(await adminListRates()),
    enabled: tab === "rates",
  });

  const historyQ = useQuery({
    queryKey: ["admin", "rates", "history"],
    queryFn: async () => {
      const h = await adminListAuditLogs({ action: "exchangeRate.upsert", pageSize: 30 });
      return asRows<AuditRow>(h);
    },
    enabled: tab === "rates",
  });

  useEffect(() => {
    if (!settingsQ.data) return;
    setDrafts(
      Object.fromEntries(
        settingsQ.data.map((item) => [
          item.key,
          typeof item.value === "string" ? item.value : JSON.stringify(item.value),
        ]),
      ),
    );
  }, [settingsQ.data]);

  const settingMut = useMutation({
    mutationFn: (setting: Setting) =>
      adminUpdateSetting(setting.key, parseValue(setting, drafts[setting.key] ?? "")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "settings"] }),
    onError: (e: Error) => setError(e.message),
  });

  const saveRateMut = useMutation({
    mutationFn: async () => {
      const parsed = exchangeRateSchema.safeParse({ currency, cnyToFiat, sellRate: cnyToFiat });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || t("validateFailed"));
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

  const dateLocale = locale === "en" ? "en-US" : "zh-CN";
  const preview = (10 * cnyToFiat).toLocaleString(dateLocale);
  const rateCols: Column<RateRow>[] = useMemo(
    () => [
      { key: "currency", header: t("colCurrency"), cell: (r) => r.currency },
      {
        key: "rate",
        header: t("cnyEquals"),
        cell: (r) => String(r.cnyToFiat ?? r.buyRate),
        className: "tabular-nums",
      },
      { key: "updated", header: t("colUpdated"), cell: (r) => fmtDate(r.updatedAt, dateLocale), className: "text-caption" },
    ],
    [t, dateLocale],
  );
  const histCols: Column<AuditRow>[] = useMemo(
    () => [
      { key: "time", header: t("time"), cell: (r) => fmtDate(r.createdAt, dateLocale), className: "text-caption" },
      { key: "action", header: t("colAction"), cell: (r) => r.action || "—" },
      {
        key: "payload",
        header: t("colPayload"),
        cell: (r) => (
          <span className="max-w-lg truncate font-mono text-caption">{JSON.stringify(r.payload)}</span>
        ),
      },
    ],
    [t, dateLocale],
  );

  const switchTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "rates") url.searchParams.set("tab", "rates");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  return (
    <AdminShell title={tab === "rates" ? t("rates") : t("settings")}>
      {error || formErr || settingsQ.error || ratesQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error ||
            formErr ||
            (settingsQ.error as Error)?.message ||
            (ratesQ.error as Error)?.message}
        </p>
      ) : null}

      <div className="mb-4 flex gap-2">
        <Button
          size="sm"
          variant={tab === "config" ? "primary" : "secondary"}
          onClick={() => switchTab("config")}
        >
          {t("settings")}
        </Button>
        <Button
          size="sm"
          variant={tab === "rates" ? "primary" : "secondary"}
          onClick={() => switchTab("rates")}
        >
          {t("rates")}
        </Button>
      </div>

      {tab === "config" ? (
        <div className="space-y-3">
          {/* Interface language — client preference */}
          <div className="card glass-card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-body-sm font-medium">{t("interfaceLanguage")}</p>
              <p className="text-caption text-ink-muted">{t("interfaceLanguageHint")}</p>
            </div>
            <Select
              className="w-40"
              value={locale}
              onChange={(e) => setLocale(e.target.value as "zh" | "en")}
            >
              <option value="zh">{t("languageZh")}</option>
              <option value="en">{t("languageEn")}</option>
            </Select>
          </div>

          {(settingsQ.data ?? []).map((item) => (
            <div
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-3 card glass-card p-4"
            >
              <div>
                <p className="text-body-sm font-medium">
                  {locale === "zh"
                    ? item.labelZh || item.labelVi || item.key
                    : item.labelZh || item.key}
                </p>
                <p className="font-mono text-caption text-ink-muted">{item.key}</p>
                {item.updatedAt ? (
                  <p className="text-caption text-ink-muted">{fmtDate(item.updatedAt, dateLocale)}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {item.type === "boolean" ? (
                  <Select
                    className="w-28"
                    value={drafts[item.key] ?? String(item.value)}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [item.key]: e.target.value }))
                    }
                  >
                    <option value="true">{t("enable")}</option>
                    <option value="false">{t("disable")}</option>
                  </Select>
                ) : (
                  <Input
                    className="w-52"
                    value={drafts[item.key] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [item.key]: e.target.value }))
                    }
                  />
                )}
                <Button
                  size="sm"
                  disabled={settingMut.isPending}
                  onClick={() => settingMut.mutate(item)}
                >
                  {t("save")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="mb-4 text-body-sm text-ink-muted">{t("ratesHint")}</p>
          <div className="mb-6 flex flex-wrap items-end gap-2 card glass-card p-4">
            <label className="text-caption text-ink-muted">
              {t("colCurrency")}
              <Input
                className="mt-1 w-28"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </label>
            <label className="text-caption text-ink-muted">
              {t("cnyEquals")}
              <Input
                type="number"
                step="any"
                className="mt-1 w-36"
                value={cnyToFiat}
                onChange={(e) => setCnyToFiat(Number(e.target.value))}
              />
            </label>
            <p className="pb-2 text-caption text-ink-subtle">
              {t("ratePreview", { n: preview, currency })}
            </p>
            <Button size="sm" onClick={() => saveRateMut.mutate()} disabled={saveRateMut.isPending}>
              {t("save")}
            </Button>
          </div>

          <h2 className="mb-2 text-h4">{t("currentRates")}</h2>
          <div className="mb-8">
            <DataTable
              columns={rateCols}
              rows={ratesQ.data || []}
              loading={ratesQ.isFetching}
              emptyTitle={t("empty")}
              getRowKey={(r) => r.currency || String(r.id)}
            />
          </div>

          <h2 className="mb-2 text-h4">{t("rateHistory")}</h2>
          <DataTable
            columns={histCols}
            rows={historyQ.data || []}
            loading={historyQ.isFetching}
            emptyTitle={t("empty")}
          />
        </>
      )}
    </AdminShell>
  );
}
