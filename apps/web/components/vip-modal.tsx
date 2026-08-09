"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Crown, Clapperboard, MonitorPlay } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import {
  getVipPlans,
  vipSubOrder,
  type VipPlanQuote,
} from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatUsd } from "@/lib/utils";
import { track } from "@/lib/track";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

const PAY_CURRENCY = "USD";

function benefitIcon(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("1080") || lower.includes("quality") || lower.includes("画质")) {
    return MonitorPlay;
  }
  return Clapperboard;
}

export function VipModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useLocale();
  const { user, openLogin } = useAuth();

  const [plans, setPlans] = useState<VipPlanQuote[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [planLoadError, setPlanLoadError] = useState(false);
  const [planReloadKey, setPlanReloadKey] = useState(0);
  const dialogRef = useDialogFocus<HTMLDivElement>(open, () => {
    if (!busy) onClose();
  });

  useEffect(() => {
    if (!open) return;
    setErr(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setPlanLoadError(false);
    getVipPlans(PAY_CURRENCY)
      .then((list) => {
        setPlans(list);
        setPlanId((prev) => {
          if (prev && list.find((p) => p.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch(() => {
        setPlans([]);
        setPlanLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [open, planReloadKey]);

  if (!open) return null;

  const selected = plans.find((p) => p.id === planId) || null;
  const payAmount = selected?.payAmount ? Number(selected.payAmount) : 0;
  const isActiveVip = !!user?.isVip && !!user?.vipExpireAt;

  async function confirm() {
    if (!user) {
      onClose();
      openLogin();
      return;
    }
    if (!selected) {
      setErr(t("vip.emptyPlans"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r: any = await vipSubOrder(selected.id, PAY_CURRENCY, "STRIPE", {
        createCheckout: true,
      });
      const checkoutUrl = String(r?.checkoutUrl || r?.checkout_url || "").trim();
      if (checkoutUrl) {
        track("vip_sub", {
          method: "STRIPE",
          currency: PAY_CURRENCY,
          planId: selected.id,
          payAmount,
        });
        window.location.assign(checkoutUrl);
        return;
      }
      setErr(t("vip.payPending"));
    } catch (e: any) {
      setErr(e?.message || t("vip.fail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vip-dialog-title"
        tabIndex={-1}
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface shadow-3 sm:max-w-2xl sm:rounded-2xl"
      >
        <div
          className="relative px-6 pb-4 pt-6"
          style={{
            background:
              "radial-gradient(600px 200px at 10% -20%, oklch(0.68 0.19 18 / 0.22), transparent 55%)",
          }}
        >
          <button
            onClick={() => !busy && onClose()}
            type="button"
            className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-gold/20 text-gold">
              <Crown className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-overline uppercase tracking-widest text-brand">{t("vip.title")}</p>
              <h2 id="vip-dialog-title" className="text-h3 font-bold text-ink">{t("vip.subtitle")}</h2>
            </div>
          </div>

          {isActiveVip ? (
            <p className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-body-sm text-success">
              {t("vip.activeUntil", {
                date: new Date(user!.vipExpireAt!).toLocaleDateString(locale),
              })}
              <span className="ml-1 text-ink-muted">· {t("vip.renewHint")}</span>
            </p>
          ) : (
            <p className="mt-3 text-body-sm text-ink-muted">{t("vip.inactiveHint")}</p>
          )}
        </div>

        <div className="space-y-6 px-6 pb-6">
            <div>
              <label className="text-caption uppercase text-ink-subtle">{t("vip.plans")}</label>
              {loading ? (
                <p className="mt-3 text-body-sm text-ink-muted">{t("common.loading")}</p>
              ) : planLoadError ? (
                <div className="mt-3 rounded-xl bg-surface-2 p-4 text-center" role="alert">
                  <p className="text-body-sm text-ink-muted">{t("errors.loadFailed")}</p>
                  <button
                    type="button"
                    onClick={() => setPlanReloadKey((key) => key + 1)}
                    className="mt-3 min-h-11 rounded-full bg-brand px-5 py-2 text-body-sm font-semibold text-white"
                  >
                    {t("common.retry")}
                  </button>
                </div>
              ) : plans.length === 0 ? (
                <p className="mt-3 text-body-sm text-ink-muted">{t("vip.emptyPlans")}</p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {plans.map((p) => {
                    const active = p.id === planId;
                    const original = p.originalPrice != null ? Number(p.originalPrice) : null;
                    const price = Number(p.payAmount || p.basePrice || 0);
                    const benefits =
                      Array.isArray(p.benefits) && p.benefits.length > 0
                        ? p.benefits
                        : [t("vip.benefitWatch"), t("vip.benefitNoCredits")];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlanId(p.id)}
                        className={cn(
                          "relative flex h-full flex-col overflow-hidden rounded-xl px-4 py-4 text-left transition-all duration-[var(--dur-base)]",
                          active
                            ? "bg-brand/15 ring-2 ring-brand"
                            : "bg-surface-2 hover:bg-surface-3",
                        )}
                      >
                        {p.badge?.trim() ? (
                          <span className="absolute right-0 top-0 rounded-bl-lg bg-danger px-2 py-0.5 text-[10px] font-bold text-white">
                            {p.badge.trim()}
                          </span>
                        ) : null}
                        <div className="flex items-center gap-2 pr-12">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold/20 text-gold">
                            <Crown className="h-4 w-4" />
                          </span>
                          <span className="truncate text-body font-semibold text-ink">
                            {p.name || t("vip.days", { n: String(p.durationDays) })}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-baseline gap-2">
                          <span className="text-h3 font-bold tabular-nums text-gold">
                            {formatUsd(price)}
                          </span>
                          {original != null && Number.isFinite(original) && original > price ? (
                            <span className="text-caption tabular-nums text-ink-subtle line-through">
                              {formatUsd(original)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 space-y-0.5 text-caption text-ink-muted">
                          <p>{t("vip.days", { n: String(p.durationDays) })}</p>
                          <p className="line-clamp-3 leading-5">
                            {p.desc || p.descEn || t("vip.renewHint")}
                          </p>
                        </div>
                        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1.5 border-t border-line pt-3 mt-3">
                          {benefits.slice(0, 4).map((text) => {
                            const Icon = benefitIcon(text);
                            return (
                              <span
                                key={text}
                                className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted"
                              >
                                <Icon className="h-3.5 w-3.5 text-brand" />
                                {text}
                              </span>
                            );
                          })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selected && (
              <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-5 py-4">
                <div className="flex items-center gap-2 text-ink-muted">
                  <Crown className="h-4 w-4 text-gold" />
                  <span className="text-body-sm">
                    {selected.name || t("vip.days", { n: String(selected.durationDays) })}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-h3 font-bold tabular-nums text-gold">
                    {formatUsd(payAmount)}
                  </p>
                  <p className="text-caption text-ink-subtle">
                    {t("vip.days", { n: String(selected.durationDays) })}
                  </p>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={confirm}
              disabled={busy || !selected || loading}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full shadow-brand")}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isActiveVip ? (
                t("vip.renew")
              ) : (
                t("vip.confirm")
              )}
            </button>
            {err && <p className="text-body-sm text-danger">{err}</p>}
          </div>
      </div>
    </div>
  );
}
