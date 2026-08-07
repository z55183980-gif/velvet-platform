"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, Copy, CreditCard, ExternalLink, Settings } from "lucide-react";
import type { StripePaymentGatewaySettings } from "@velvet/api-client";
import { Badge, Button, Input, cn } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";
import { useAdminSession } from "@/lib/admin-session";

function secretFieldClass(configured: boolean, editing: boolean): string {
  const base =
    "h-10 w-full rounded-md border px-3 font-mono text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20";
  if (configured && !editing) {
    return cn(base, "border-success/30 bg-success-soft/70 text-ink-muted placeholder:text-success/70");
  }
  return cn(base, "border-line bg-white");
}

export function StripeSettingsPanel({
  settings,
  saving,
  onSave,
}: {
  settings: StripePaymentGatewaySettings;
  saving?: boolean;
  onSave: (payload: {
    enabled: boolean;
    secret_key: string;
    webhook_signing_secret: string;
    enabled_events: string[];
  }) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { admin } = useAdminSession();
  const canSave = admin?.role === "SUPER_ADMIN";
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(settings.enabled_events);
  const [customEvent, setCustomEvent] = useState("");
  const [form, setForm] = useState({
    enabled: settings.enabled,
    secret_key: "",
    webhook_signing_secret: "",
  });

  useEffect(() => {
    setSelectedEvents(settings.enabled_events);
    setForm({
      enabled: settings.enabled,
      secret_key: "",
      webhook_signing_secret: "",
    });
  }, [settings]);

  const webhookUrl =
    settings.webhook_endpoint_url?.trim() || settings.webhook_receiver_url?.trim() || "";

  const allEventOptions = Array.from(
    new Set([...settings.recommended_events, ...selectedEvents, ...settings.enabled_events]),
  );

  function toggleEvent(event: string) {
    setSelectedEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    );
  }

  function addCustomEvent() {
    const value = customEvent.trim();
    if (!value || selectedEvents.includes(value)) return;
    setSelectedEvents((current) => [...current, value]);
    setCustomEvent("");
  }

  async function copyWebhookUrl() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(t("stripeCopyFailed"));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    const secret = form.webhook_signing_secret.trim();
    try {
      await onSave({
        enabled: form.enabled,
        secret_key: form.secret_key.trim(),
        webhook_signing_secret: secret || settings.webhook_signing_secret,
        enabled_events: selectedEvents,
      });
      setForm((current) => ({ ...current, secret_key: "", webhook_signing_secret: "" }));
    } catch {
      // Parent surfaces error; keep typed secrets so the admin can retry.
    }
  }

  const configStatus = [
    { label: t("stripeStatusApiKey"), ok: settings.has_secret_key },
    { label: t("stripeStatusCheckout"), ok: settings.checkout_enabled },
    { label: t("stripeStatusWebhook"), ok: settings.has_webhook_signing_secret },
  ];
  const gatewayReady = configStatus.every((item) => item.ok);
  const dashboardDevelopers =
    settings.docs.dashboard_developers || "https://dashboard.stripe.com/developers";
  const dashboardWebhooks =
    settings.docs.dashboard_webhooks || "https://dashboard.stripe.com/webhooks";

  return (
    <div className="card glass-card p-4 md:p-5">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard size={17} />
            <h2 className="text-body-sm font-semibold">{t("stripeGatewayTitle")}</h2>
          </div>
          <p className="mt-1 text-caption text-ink-muted">{t("stripeGatewayHint")}</p>
          {settings.updated_at ? (
            <p className="mt-1 text-caption text-ink-subtle">
              {t("stripeLastUpdated")}:{" "}
              {new Date(settings.updated_at).toLocaleString(dateLocale)}
            </p>
          ) : null}
        </div>
        <Badge tone={gatewayReady ? "success" : "warning"}>
          {gatewayReady ? t("stripeConfigured") : t("stripeIncomplete")}
        </Badge>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {configStatus.map((item) => (
          <div key={item.label} className="rounded-md border border-line bg-panel/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-body-sm font-medium">{item.label}</span>
              <Badge tone={item.ok ? "success" : "warning"}>
                {item.ok ? t("stripeConfigured") : t("stripeNotConfigured")}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={(event) => void submit(event)} className="space-y-6">
        <fieldset disabled={!canSave || saving} className="space-y-6 disabled:opacity-70">
          <section className="overflow-hidden rounded-lg border border-line">
            <div className="border-b border-line bg-panel/40 px-4 py-3">
              <h3 className="text-body-sm font-semibold">{t("stripeApiKeySection")}</h3>
              <p className="mt-1 text-caption text-ink-muted">
                {t("stripeApiKeyHint")}
                <a
                  href={dashboardDevelopers}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-0.5 text-brand hover:underline"
                >
                  {t("stripeGetFromDashboard")}
                  <ExternalLink size={11} />
                </a>
              </p>
            </div>
            <div className="p-4">
              <label className="block text-body-sm">
                <span className="mb-1 flex flex-wrap items-center gap-2 text-ink-muted">
                  <span>Secret Key</span>
                  <code className="rounded bg-panel px-1 text-caption text-ink-muted">
                    {settings.secret_key_env}
                  </code>
                  {settings.has_secret_key ? (
                    <Badge tone="success">{t("stripeConfigured")}</Badge>
                  ) : null}
                </span>
                <input
                  type="password"
                  className={secretFieldClass(settings.has_secret_key, Boolean(form.secret_key.trim()))}
                  value={form.secret_key}
                  placeholder={
                    settings.has_secret_key
                      ? t("stripeSecretKeepPlaceholder", { masked: settings.secret_key_masked })
                      : "sk_test_... / sk_live_..."
                  }
                  onChange={(event) => setForm({ ...form, secret_key: event.target.value })}
                  autoComplete="new-password"
                />
                {settings.has_secret_key && !form.secret_key.trim() ? (
                  <span className="mt-1.5 flex items-center gap-1.5 text-caption text-success">
                    <Check size={12} aria-hidden />
                    {t("stripeSecretCurrent", { masked: settings.secret_key_masked })}
                  </span>
                ) : (
                  <span className="mt-1 block text-caption text-ink-muted">{t("stripeSecretKeepHint")}</span>
                )}
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-line">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-panel/40 px-4 py-3">
              <div>
                <h3 className="text-body-sm font-semibold">Webhook</h3>
                <p className="mt-1 text-caption text-ink-muted">
                  {t("stripeWebhookHint")}
                  <a
                    href={dashboardWebhooks}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 inline-flex items-center gap-0.5 text-brand hover:underline"
                  >
                    {t("stripeManageWebhook")}
                    <ExternalLink size={11} />
                  </a>
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-body-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                />
                {t("stripeEnable")}
              </label>
            </div>

            <div className="space-y-4 p-4">
              <div className="block text-body-sm">
                <span className="mb-1 block text-ink-muted">{t("stripeEndpointUrl")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    readOnly
                    className="h-10 min-w-0 flex-1 font-mono text-caption"
                    value={webhookUrl}
                    placeholder={t("stripeEndpointPlaceholder")}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void copyWebhookUrl()}
                    disabled={!webhookUrl}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span className="ml-1">{copied ? t("copied") : t("copy")}</span>
                  </Button>
                </div>
                {copyError ? (
                  <span className="mt-1 block text-caption text-danger">{copyError}</span>
                ) : null}
              </div>

              <label className="block text-body-sm">
                <span className="mb-1 flex flex-wrap items-center gap-2 text-ink-muted">
                  <span>{t("stripeSigningSecret")}</span>
                  {settings.webhook_secret_env ? (
                    <code className="rounded bg-panel px-1 text-caption text-ink-muted">
                      {settings.webhook_secret_env}
                    </code>
                  ) : null}
                  {settings.has_webhook_signing_secret ? (
                    <Badge tone="success">{t("stripeConfigured")}</Badge>
                  ) : null}
                </span>
                <input
                  type="password"
                  className={secretFieldClass(
                    settings.has_webhook_signing_secret,
                    Boolean(form.webhook_signing_secret.trim()),
                  )}
                  value={form.webhook_signing_secret}
                  placeholder={
                    settings.has_webhook_signing_secret
                      ? t("stripeSecretKeepPlaceholder", {
                          masked: settings.webhook_signing_secret,
                        })
                      : "whsec_..."
                  }
                  onChange={(event) =>
                    setForm({ ...form, webhook_signing_secret: event.target.value })
                  }
                  autoComplete="new-password"
                />
                {settings.has_webhook_signing_secret && !form.webhook_signing_secret.trim() ? (
                  <span className="mt-1.5 flex items-center gap-1.5 text-caption text-success">
                    <Check size={12} aria-hidden />
                    {t("stripeSecretCurrent", { masked: settings.webhook_signing_secret })}
                  </span>
                ) : settings.webhook_secret_source === "env" ? (
                  <span className="mt-1 block text-caption text-ink-muted">
                    {t("stripeWebhookEnvHint", {
                      env: settings.webhook_secret_env || "STRIPE_WEBHOOK_SECRET",
                    })}
                  </span>
                ) : (
                  <span className="mt-1 block text-caption text-ink-muted">
                    {t("stripeSecretKeepHint")}
                  </span>
                )}
              </label>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body-sm font-medium">{t("stripeListenEvents")}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelectedEvents(settings.recommended_events)}
                  >
                    {t("stripeUseDefaultEvents")}
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {allEventOptions.map((event) => (
                    <label
                      key={event}
                      className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-body-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(event)}
                        onChange={() => toggleEvent(event)}
                      />
                      <span className="font-mono text-caption">{event}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    className="h-9 min-w-0 flex-1 font-mono text-caption"
                    value={customEvent}
                    placeholder={t("stripeCustomEventPlaceholder")}
                    onChange={(event) => setCustomEvent(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCustomEvent();
                      }
                    }}
                  />
                  <Button type="button" size="sm" variant="secondary" onClick={addCustomEvent}>
                    {t("add")}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            {canSave ? (
              <Button type="submit" size="sm" disabled={saving}>
                <Settings size={16} className="mr-1.5" />
                {saving ? t("saving") : t("stripeSaveConfig")}
              </Button>
            ) : (
              <span className="text-body-sm text-ink-muted">{t("stripeSuperAdminOnly")}</span>
            )}
          </div>
        </fieldset>
      </form>
    </div>
  );
}
