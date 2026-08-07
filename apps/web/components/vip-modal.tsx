"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Check, Crown, Clapperboard, MonitorPlay } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import {
  getVipPlans,
  vipSubOrder,
  simulatePay,
  type VipPlanQuote,
} from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatUsd } from "@/lib/utils";
import { track } from "@/lib/track";

const PAY_CURRENCY = "USD";
const DEFAULT_BENEFITS = ["Unlimited Viewing", "1080p High Quality"];

type PayMethod = "STRIPE" | "SIMULATE";

function benefitIcon(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("1080") || lower.includes("quality") || lower.includes("画质")) {
    return MonitorPlay;
  }
  return Clapperboard;
}

export function VipModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useLocale();
  const { user, openLogin, applySession } = useAuth();
  const isDev = process.env.NODE_ENV === "development";

  const [plans, setPlans] = useState<VipPlanQuote[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>("STRIPE");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setDone(false);
    setMethod(isDev ? "SIMULATE" : "STRIPE");
  }, [open, isDev]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getVipPlans(PAY_CURRENCY)
      .then((list) => {
        setPlans(list);
        setPlanId((prev) => {
          if (prev && list.find((p) => p.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .finally(() => setLoading(false));
  }, [open]);

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
      const wantSimulate = isDev && method === "SIMULATE";
      const r: any = await vipSubOrder(selected.id, PAY_CURRENCY, "STRIPE", {
        createCheckout: !wantSimulate,
      });
      if (wantSimulate && r?.orderNo) {
        await simulatePay(r.orderNo);
        await applySession();
        track("vip_sub", { method, currency: PAY_CURRENCY, planId: selected.id, payAmount });
        setDone(true);
        setTimeout(() => onClose(), 1400);
        return;
      }
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-surface shadow-3 sm:max-w-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div
          className="relative px-6 pb-4 pt-6"
          style={{
            background:
              "radial-gradient(600px 200px at 10% -20%, oklch(0.68 0.19 18 / 0.22), transparent 55%)",
          }}
        >
          <button
            onClick={() => !busy && onClose()}
            className="absolute right-4 top-4 text-ink-muted transition-colors hover:text-ink"
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
              <h2 className="text-h3 font-bold text-ink">{t("vip.subtitle")}</h2>
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

        {done ? (
          <div className="flex flex-col items-center px-6 py-12 text-center animate-[rise-in_0.4s_var(--ease-out)_both]">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success">
              <Check className="h-8 w-8" />
            </span>
            <p className="mt-5 text-h3 font-semibold text-ink">{t("vip.success")}</p>
          </div>
        ) : (
          <div className="space-y-6 px-6 pb-6">
            <div>
              <label className="text-caption uppercase text-ink-subtle">{t("vip.plans")}</label>
              {loading ? (
                <p className="mt-3 text-body-sm text-ink-muted">{t("common.loading")}</p>
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
                        : DEFAULT_BENEFITS;
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

            {isDev ? (
              <div>
                <label className="text-caption uppercase text-ink-subtle">{t("recharge.method")}</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMethod("SIMULATE")}
                    className={cn(
                      "rounded-full px-4 py-2 text-body-sm font-medium transition-colors",
                      method === "SIMULATE"
                        ? "bg-brand text-white"
                        : "bg-surface-2 text-ink-muted hover:text-ink",
                    )}
                  >
                    {t("recharge.simulate")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("STRIPE")}
                    className={cn(
                      "rounded-full px-4 py-2 text-body-sm font-medium transition-colors",
                      method === "STRIPE"
                        ? "bg-brand text-white"
                        : "bg-surface-2 text-ink-muted hover:text-ink",
                    )}
                  >
                    Stripe
                  </button>
                </div>
              </div>
            ) : null}

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
        )}
      </div>
    </div>
  );
}
