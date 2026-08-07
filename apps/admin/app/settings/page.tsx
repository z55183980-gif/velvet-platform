"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminGetStripePaymentGateway,
  adminListSettings,
  adminUpdateSetting,
  adminUpdateStripePaymentGateway,
} from "@velvet/api-client";
import { Button, Input, Select, fmtDate } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { StripeSettingsPanel } from "@/components/stripe-settings-panel";
import { useI18n } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";

type Setting = {
  key: string;
  value: unknown;
  type?: string;
  labelZh?: string;
  labelEn?: string;
  updatedAt?: string;
};

type Tab = "config" | "payments";

function parseTab(raw: string | null): Tab {
  if (raw === "payments") return raw;
  return "config";
}

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
  const [tab, setTab] = useState<Tab>(() => parseTab(searchParams.get("tab")));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab(parseTab(searchParams.get("tab")));
  }, [searchParams]);

  const settingsQ = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const result = (await adminListSettings()) as { items?: Setting[] };
      return result.items ?? [];
    },
    enabled: tab === "config",
  });

  const stripeQ = useQuery({
    queryKey: ["admin", "payment-gateways", "stripe"],
    queryFn: () => adminGetStripePaymentGateway(),
    enabled: tab === "payments",
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

  const stripeMut = useMutation({
    mutationFn: adminUpdateStripePaymentGateway,
    onSuccess: (data) => {
      setError(null);
      qc.setQueryData(["admin", "payment-gateways", "stripe"], data);
    },
    onError: (e: Error) => setError(e.message),
  });

  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const switchTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "config") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const shellTitle = tab === "payments" ? t("paymentGateway") : t("settings");

  return (
    <AdminShell title={shellTitle}>
      {error || settingsQ.error || stripeQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error ||
            (settingsQ.error as Error)?.message ||
            (stripeQ.error as Error)?.message}
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
          variant={tab === "payments" ? "primary" : "secondary"}
          onClick={() => switchTab("payments")}
        >
          {t("paymentGateway")}
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
                    ? item.labelZh || item.labelEn || item.key
                    : item.labelEn || item.labelZh || item.key}
                </p>
                <p className="font-mono text-caption text-ink-muted">{item.key}</p>
                {item.updatedAt ? (
                  <p className="text-caption text-ink-muted">{fmtDate(item.updatedAt, dateLocale)}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {item.key === "episodeLockMode" ? (
                  <Select
                    className="w-52"
                    value={drafts[item.key] ?? String(item.value ?? "FREE_FIRST_N")}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [item.key]: e.target.value }))
                    }
                  >
                    <option value="FREE_FIRST_N">{t("lockModeFreeFirstN")}</option>
                    <option value="VIP_ALL">{t("lockModeVipAll")}</option>
                    <option value="ALL_FREE">{t("lockModeAllFree")}</option>
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
        <div className="space-y-3">
          {stripeQ.isLoading ? (
            <p className="text-body-sm text-ink-muted">{t("loading")}</p>
          ) : stripeQ.data ? (
            <StripeSettingsPanel
              settings={stripeQ.data}
              saving={stripeMut.isPending}
              onSave={async (payload) => {
                await stripeMut.mutateAsync(payload);
              }}
            />
          ) : null}
        </div>
      )}
    </AdminShell>
  );
}
