"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminGetStripePaymentGateway,
  adminListSettings,
  adminUpdateSetting,
  adminUpdateStripePaymentGateway,
} from "@velvet/api-client";
import { Button, Input, Select, cn, fmtDate } from "@velvet/ui";
import { Save } from "lucide-react";
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

type LockMode = "FREE_FIRST_N" | "VIP_ALL" | "ALL_FREE";

type Tab = "config" | "commercial" | "policy" | "payments";

const POLICY_KEYS = new Set([
  "episodeLockMode",
  "defaultFreeEpisodes",
  "defaultPreviewSeconds",
]);

const GENERAL_KEYS = [
  "siteName",
  "supportEmail",
  "supportUrl",
  "termsUrl",
  "privacyUrl",
  "maintenanceMode",
  "maintenanceMessage",
] as const;

const COMMERCIAL_KEYS = ["revenueShareDefault", "minWithdrawVnd", "pitRate"] as const;

function parseTab(raw: string | null): Tab {
  if (raw === "payments" || raw === "policy" || raw === "commercial") return raw;
  return "config";
}

function parseLockMode(raw: unknown): LockMode {
  if (raw === "VIP_ALL" || raw === "ALL_FREE" || raw === "FREE_FIRST_N") return raw;
  return "FREE_FIRST_N";
}

function settingValue(items: Setting[] | undefined, key: string) {
  return items?.find((item) => item.key === key)?.value;
}

function toPercentInput(raw: unknown, fallback: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(fallback);
  return String(Math.round(n * 10000) / 100);
}

function fromPercentInput(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return Math.min(100, Math.max(0, n)) / 100;
}

export default function AdminSettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const searchParams = useLocationSearchParams();
  const [tab, setTab] = useState<Tab>(() => parseTab(searchParams.get("tab")));

  const [siteName, setSiteName] = useState("Velvet");
  const [supportEmail, setSupportEmail] = useState("support@velvetmovie.space");
  const [supportUrl, setSupportUrl] = useState("");
  const [termsUrl, setTermsUrl] = useState("/terms");
  const [privacyUrl, setPrivacyUrl] = useState("/privacy");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");

  const [revenueSharePercent, setRevenueSharePercent] = useState("70");
  const [minWithdrawVnd, setMinWithdrawVnd] = useState("100000");
  const [pitRatePercent, setPitRatePercent] = useState("5");

  const [lockMode, setLockMode] = useState<LockMode>("FREE_FIRST_N");
  const [freeEpisodes, setFreeEpisodes] = useState("3");
  const [allowPreview, setAllowPreview] = useState(false);
  const [previewSeconds, setPreviewSeconds] = useState(10);
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
    enabled: tab === "config" || tab === "commercial" || tab === "policy",
  });

  const stripeQ = useQuery({
    queryKey: ["admin", "payment-gateways", "stripe"],
    queryFn: () => adminGetStripePaymentGateway(),
    enabled: tab === "payments",
  });

  useEffect(() => {
    if (!settingsQ.data) return;
    setSiteName(String(settingValue(settingsQ.data, "siteName") ?? "Velvet"));
    setSupportEmail(
      String(settingValue(settingsQ.data, "supportEmail") ?? "support@velvetmovie.space"),
    );
    setSupportUrl(String(settingValue(settingsQ.data, "supportUrl") ?? ""));
    setTermsUrl(String(settingValue(settingsQ.data, "termsUrl") ?? "/terms"));
    setPrivacyUrl(String(settingValue(settingsQ.data, "privacyUrl") ?? "/privacy"));
    setMaintenanceMode(Boolean(settingValue(settingsQ.data, "maintenanceMode")));
    setMaintenanceMessage(String(settingValue(settingsQ.data, "maintenanceMessage") ?? ""));

    setRevenueSharePercent(toPercentInput(settingValue(settingsQ.data, "revenueShareDefault"), 70));
    setMinWithdrawVnd(String(settingValue(settingsQ.data, "minWithdrawVnd") ?? 100000));
    setPitRatePercent(toPercentInput(settingValue(settingsQ.data, "pitRate"), 5));

    setLockMode(parseLockMode(settingValue(settingsQ.data, "episodeLockMode")));
    const freeRaw = settingValue(settingsQ.data, "defaultFreeEpisodes");
    setFreeEpisodes(
      typeof freeRaw === "number" || typeof freeRaw === "string" ? String(freeRaw) : "3",
    );
    const previewRaw = Number(settingValue(settingsQ.data, "defaultPreviewSeconds"));
    const previewN = Number.isFinite(previewRaw) ? Math.max(0, Math.floor(previewRaw)) : 0;
    setAllowPreview(previewN > 0);
    setPreviewSeconds(previewN > 0 ? previewN : 10);
  }, [settingsQ.data]);

  const generalMut = useMutation({
    mutationFn: async () => {
      if (!siteName.trim()) throw new Error(t("settingsSiteNameRequired"));
      await adminUpdateSetting("siteName", siteName.trim());
      await adminUpdateSetting("supportEmail", supportEmail.trim());
      await adminUpdateSetting("supportUrl", supportUrl.trim());
      await adminUpdateSetting("termsUrl", termsUrl.trim() || "/terms");
      await adminUpdateSetting("privacyUrl", privacyUrl.trim() || "/privacy");
      await adminUpdateSetting("maintenanceMode", maintenanceMode);
      await adminUpdateSetting("maintenanceMessage", maintenanceMessage.trim());
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const commercialMut = useMutation({
    mutationFn: async () => {
      const share = fromPercentInput(revenueSharePercent);
      const pit = fromPercentInput(pitRatePercent);
      const min = Math.floor(Number(minWithdrawVnd));
      if (!Number.isFinite(share)) throw new Error(t("settingsRevenueShareInvalid"));
      if (!Number.isFinite(pit)) throw new Error(t("settingsPitRateInvalid"));
      if (!Number.isFinite(min) || min < 0) throw new Error(t("settingsMinWithdrawInvalid"));
      await adminUpdateSetting("revenueShareDefault", share);
      await adminUpdateSetting("minWithdrawVnd", min);
      await adminUpdateSetting("pitRate", pit);
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const policyMut = useMutation({
    mutationFn: async () => {
      const n = Math.floor(Number(freeEpisodes));
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(t("settingsPolicyFreeCountInvalid"));
      }
      const previewN = allowPreview
        ? Math.max(1, Math.floor(Number(previewSeconds) || 10))
        : 0;
      if (allowPreview && !Number.isFinite(Number(previewSeconds))) {
        throw new Error(t("settingsPolicyPreviewInvalid"));
      }
      await adminUpdateSetting("episodeLockMode", lockMode);
      await adminUpdateSetting("defaultFreeEpisodes", n);
      await adminUpdateSetting("defaultPreviewSeconds", previewN);
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
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

  const latestUpdatedAt = (keys: readonly string[]) => {
    const times = (settingsQ.data ?? [])
      .filter((item) => keys.includes(item.key) && item.updatedAt)
      .map((item) => item.updatedAt as string);
    if (!times.length) return null;
    return times.sort().at(-1) ?? null;
  };

  const policyUpdatedAt = useMemo(
    () => latestUpdatedAt([...POLICY_KEYS]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settingsQ.data],
  );
  const generalUpdatedAt = useMemo(
    () => latestUpdatedAt(GENERAL_KEYS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settingsQ.data],
  );
  const commercialUpdatedAt = useMemo(
    () => latestUpdatedAt(COMMERCIAL_KEYS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settingsQ.data],
  );

  const freeCountPreview = Math.max(0, Math.floor(Number(freeEpisodes) || 0));
  const previewSecondsPreview = allowPreview
    ? Math.max(1, Math.floor(Number(previewSeconds) || 10))
    : 0;
  const previewSuffix =
    lockMode !== "ALL_FREE" && previewSecondsPreview > 0
      ? t("settingsPolicyPreviewTrialSuffix", { seconds: previewSecondsPreview })
      : "";

  const policyPreviewText =
    (lockMode === "ALL_FREE"
      ? t("settingsPolicyPreviewAllFree")
      : lockMode === "VIP_ALL"
        ? t("settingsPolicyPreviewVipAll")
        : t("settingsPolicyPreviewFreeFirstN", { n: freeCountPreview })) +
    previewSuffix;

  const shellTitle =
    tab === "payments"
      ? t("paymentGateway")
      : tab === "policy"
        ? t("uploadSectionPolicy")
        : tab === "commercial"
          ? t("settingsCommercial")
          : t("settingsGeneral");

  return (
    <AdminShell title={shellTitle}>
      {error || settingsQ.error || stripeQ.error ? (
        <p className="mb-3 text-body-sm text-danger">
          {error ||
            (settingsQ.error as Error)?.message ||
            (stripeQ.error as Error)?.message}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={tab === "config" ? "primary" : "secondary"}
          onClick={() => switchTab("config")}
        >
          {t("settingsGeneral")}
        </Button>
        <Button
          size="sm"
          variant={tab === "commercial" ? "primary" : "secondary"}
          onClick={() => switchTab("commercial")}
        >
          {t("settingsCommercial")}
        </Button>
        <Button
          size="sm"
          variant={tab === "policy" ? "primary" : "secondary"}
          onClick={() => switchTab("policy")}
        >
          {t("uploadSectionPolicy")}
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
          <div className="card glass-card flex flex-wrap items-center justify-between gap-3 p-4">
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

          <section className="upload-panel space-y-4">
            <div className="upload-panel__head">
              <div>
                <h2>{t("settingsGeneral")}</h2>
                <p>{t("settingsGeneralHint")}</p>
                {generalUpdatedAt ? (
                  <p className="mt-1 text-caption text-ink-subtle">
                    {fmtDate(generalUpdatedAt, dateLocale)}
                  </p>
                ) : null}
              </div>
            </div>

            {settingsQ.isLoading ? (
              <p className="text-body-sm text-ink-muted">{t("loading")}</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="upload-field">
                    <span>{t("settingsSiteName")}</span>
                    <Input
                      value={siteName}
                      disabled={generalMut.isPending}
                      onChange={(e) => setSiteName(e.target.value)}
                    />
                  </label>
                  <label className="upload-field">
                    <span>{t("settingsSupportEmail")}</span>
                    <Input
                      type="email"
                      value={supportEmail}
                      disabled={generalMut.isPending}
                      onChange={(e) => setSupportEmail(e.target.value)}
                    />
                  </label>
                  <label className="upload-field sm:col-span-2">
                    <span>{t("settingsSupportUrl")}</span>
                    <Input
                      value={supportUrl}
                      placeholder="https://"
                      disabled={generalMut.isPending}
                      onChange={(e) => setSupportUrl(e.target.value)}
                    />
                    <small className="text-caption text-ink-subtle">{t("settingsSupportUrlHint")}</small>
                  </label>
                  <label className="upload-field">
                    <span>{t("settingsTermsUrl")}</span>
                    <Input
                      value={termsUrl}
                      disabled={generalMut.isPending}
                      onChange={(e) => setTermsUrl(e.target.value)}
                    />
                  </label>
                  <label className="upload-field">
                    <span>{t("settingsPrivacyUrl")}</span>
                    <Input
                      value={privacyUrl}
                      disabled={generalMut.isPending}
                      onChange={(e) => setPrivacyUrl(e.target.value)}
                    />
                  </label>
                </div>

                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--color-brand)]"
                      checked={maintenanceMode}
                      disabled={generalMut.isPending}
                      onChange={(e) => setMaintenanceMode(e.target.checked)}
                    />
                    <span>
                      <strong className="text-body-sm">{t("settingsMaintenanceMode")}</strong>
                      <p className="text-caption text-ink-muted">{t("settingsMaintenanceModeHint")}</p>
                    </span>
                  </label>
                  {maintenanceMode ? (
                    <label className="upload-field mt-3 block">
                      <span>{t("settingsMaintenanceMessage")}</span>
                      <Input
                        value={maintenanceMessage}
                        disabled={generalMut.isPending}
                        onChange={(e) => setMaintenanceMessage(e.target.value)}
                        placeholder={t("settingsMaintenanceMessagePh")}
                      />
                    </label>
                  ) : null}
                </div>

                <div className="flex justify-end border-t border-line pt-3">
                  <Button
                    size="sm"
                    disabled={generalMut.isPending}
                    onClick={() => generalMut.mutate()}
                  >
                    <Save className="h-4 w-4" />
                    {generalMut.isPending ? t("loading") : t("save")}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {tab === "commercial" ? (
        <section className="upload-panel space-y-4">
          <div className="upload-panel__head">
            <div>
              <h2>{t("settingsCommercial")}</h2>
              <p>{t("settingsCommercialHint")}</p>
              {commercialUpdatedAt ? (
                <p className="mt-1 text-caption text-ink-subtle">
                  {fmtDate(commercialUpdatedAt, dateLocale)}
                </p>
              ) : null}
            </div>
          </div>

          {settingsQ.isLoading ? (
            <p className="text-body-sm text-ink-muted">{t("loading")}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="upload-field">
                  <span>{t("settingsRevenueShare")}</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={revenueSharePercent}
                    disabled={commercialMut.isPending}
                    onChange={(e) => setRevenueSharePercent(e.target.value)}
                  />
                  <small className="text-caption text-ink-subtle">
                    {t("settingsRevenueShareHint")}
                  </small>
                </label>
                <label className="upload-field">
                  <span>{t("settingsMinWithdraw")}</span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={minWithdrawVnd}
                    disabled={commercialMut.isPending}
                    onChange={(e) => setMinWithdrawVnd(e.target.value)}
                  />
                  <small className="text-caption text-ink-subtle">
                    {t("settingsMinWithdrawHint")}
                  </small>
                </label>
                <label className="upload-field">
                  <span>{t("settingsPitRate")}</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={pitRatePercent}
                    disabled={commercialMut.isPending}
                    onChange={(e) => setPitRatePercent(e.target.value)}
                  />
                  <small className="text-caption text-ink-subtle">{t("settingsPitRateHint")}</small>
                </label>
              </div>

              <div className="policy-preview is-partial">
                <span className="policy-preview__dot" aria-hidden />
                <p>
                  {t("settingsCommercialPreview", {
                    share: revenueSharePercent || "0",
                    min: minWithdrawVnd || "0",
                    pit: pitRatePercent || "0",
                  })}
                </p>
              </div>

              <div className="flex justify-end border-t border-line pt-3">
                <Button
                  size="sm"
                  disabled={commercialMut.isPending}
                  onClick={() => commercialMut.mutate()}
                >
                  <Save className="h-4 w-4" />
                  {commercialMut.isPending ? t("loading") : t("save")}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "policy" ? (
        <section className="upload-panel space-y-3">
          <div className="upload-panel__head">
            <div>
              <h2>{t("uploadSectionPolicy")}</h2>
              <p>{t("uploadSectionPolicyHint")}</p>
              <p className="mt-1 text-caption text-ink-muted">{t("settingsPolicyGlobalHint")}</p>
              {policyUpdatedAt ? (
                <p className="mt-1 text-caption text-ink-subtle">
                  {fmtDate(policyUpdatedAt, dateLocale)}
                </p>
              ) : null}
            </div>
          </div>

          {settingsQ.isLoading ? (
            <p className="text-body-sm text-ink-muted">{t("loading")}</p>
          ) : (
            <>
              <div
                className="policy-mode-grid"
                role="radiogroup"
                aria-label={t("uploadSectionPolicy")}
              >
                <div
                  className={cn(
                    "policy-mode-card",
                    (lockMode === "ALL_FREE" || lockMode === "FREE_FIRST_N") && "is-selected",
                  )}
                >
                  <div className="policy-mode-card__body">
                    <strong>{t("policyAllFree")}</strong>
                    <small>{t("policyModeHint")}</small>
                    <div className="policy-preview-choices">
                      <label className="policy-preview-toggle">
                        <input
                          type="radio"
                          name="global-playback-policy"
                          checked={lockMode === "ALL_FREE"}
                          disabled={policyMut.isPending}
                          onChange={() => setLockMode("ALL_FREE")}
                        />
                        <span>{t("lockModeAllFree")}</span>
                      </label>
                      <label className="policy-preview-toggle">
                        <input
                          type="radio"
                          name="global-playback-policy"
                          checked={lockMode === "FREE_FIRST_N"}
                          disabled={policyMut.isPending}
                          onChange={() => setLockMode("FREE_FIRST_N")}
                        />
                        <span>{t("lockModeFreeFirstN")}</span>
                      </label>
                    </div>
                    <div className="policy-range-grid">
                      <label className="upload-field">
                        <span>{t("freeEpisodes")}</span>
                        <Input
                          type="number"
                          min={0}
                          value={freeEpisodes}
                          disabled={policyMut.isPending || lockMode !== "FREE_FIRST_N"}
                          onChange={(e) => setFreeEpisodes(e.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div
                  className={cn(
                    "policy-mode-card",
                    lockMode === "VIP_ALL" && "is-selected",
                  )}
                >
                  <div className="policy-mode-card__body">
                    <strong>{t("policyPartialFree")}</strong>
                    <small>{t("policyMemberHint")}</small>
                    <div className="policy-preview-choices">
                      <label className="policy-preview-toggle">
                        <input
                          type="radio"
                          name="global-playback-policy"
                          checked={lockMode === "VIP_ALL"}
                          disabled={policyMut.isPending}
                          onChange={() => setLockMode("VIP_ALL")}
                        />
                        <span>{t("lockModeVipAll")}</span>
                      </label>
                    </div>
                    <div className="policy-preview-options">
                      <div
                        className="policy-preview-choices"
                        role="radiogroup"
                        aria-label={t("policyAllowPreview")}
                      >
                        <label className="policy-preview-toggle">
                          <input
                            type="radio"
                            name="global-member-preview-policy"
                            checked={!allowPreview}
                            disabled={policyMut.isPending || lockMode === "ALL_FREE"}
                            onChange={() => setAllowPreview(false)}
                          />
                          <span>{t("policyPreviewDisabled")}</span>
                        </label>
                        <label className="policy-preview-toggle">
                          <input
                            type="radio"
                            name="global-member-preview-policy"
                            checked={allowPreview}
                            disabled={policyMut.isPending || lockMode === "ALL_FREE"}
                            onChange={() => setAllowPreview(true)}
                          />
                          <span>{t("policyAllowPreview")}</span>
                        </label>
                      </div>
                      {allowPreview && lockMode !== "ALL_FREE" ? (
                        <label className="upload-field">
                          <span>{t("policyPreviewSeconds")}</span>
                          <Input
                            type="number"
                            min={1}
                            value={previewSeconds}
                            disabled={policyMut.isPending}
                            onChange={(e) =>
                              setPreviewSeconds(Math.max(1, Number(e.target.value) || 10))
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[0.7rem] leading-snug text-ink-subtle">
                      {t("settingsPolicyMemberSideHint")}
                    </p>
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  "policy-preview",
                  lockMode === "ALL_FREE" ? "is-free" : "is-partial",
                )}
              >
                <span className="policy-preview__dot" aria-hidden />
                <p>{policyPreviewText}</p>
              </div>

              <div className="flex justify-end border-t border-line pt-3">
                <Button
                  size="sm"
                  disabled={policyMut.isPending}
                  onClick={() => policyMut.mutate()}
                >
                  <Save className="h-4 w-4" />
                  {policyMut.isPending ? t("loading") : t("saveLockPolicy")}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "payments" ? (
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
      ) : null}
    </AdminShell>
  );
}
