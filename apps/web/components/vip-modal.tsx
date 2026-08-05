"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Check, Crown, Clapperboard, Infinity, Ticket } from "lucide-react";
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

type PayMethod = "STRIPE" | "SIMULATE";

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
      const r: any = await vipSubOrder(selected.id, PAY_CURRENCY, "STRIPE");
      if (isDev && r?.orderNo && method === "SIMULATE") {
        await simulatePay(r.orderNo);
        await applySession();
        track("vip_sub", { method, currency: PAY_CURRENCY, planId: selected.id, payAmount });
        setDone(true);
        setTimeout(() => onClose(), 1400);
        return;
      }
      setErr(t("vip.payPending"));
    } catch (e: any) {
      setErr(e?.message || t("vip.fail"));
    } finally {
      setBusy(false);
    }
  }

  const benefits = [
    { icon: Clapperboard, text: t("vip.benefitWatch") },
    { icon: Infinity, text: t("vip.benefitNoCredits") },
    { icon: Ticket, text: t("vip.benefitStack") },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-surface shadow-3 sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div
          className="relative px-6 pb-4 pt-6"
          style={{
            background:
              "radial-gradient(560px 200px at 12% -30%, oklch(0.82 0.11 85 / 0.28), transparent 55%), radial-gradient(400px 160px at 90% 0%, oklch(0.68 0.19 18 / 0.12), transparent 50%)",
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
              <Crown className="h-4.5 w-4.5 h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-overline uppercase tracking-widest text-gold">{t("vip.title")}</p>
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
          <div className="space-y-5 px-6 pb-6">
            <ul className="grid gap-2">
              {benefits.map(({ icon: Icon, text }) => (
                <li
                  key={text}
                  className="flex items-center gap-2.5 rounded-lg bg-surface-2/80 px-3 py-2 text-body-sm text-ink-muted"
                >
                  <Icon className="h-4 w-4 shrink-0 text-gold" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>

            <div>
              <label className="text-caption uppercase text-ink-subtle">{t("vip.plans")}</label>
              {loading ? (
                <p className="mt-3 text-body-sm text-ink-muted">{t("common.loading")}</p>
              ) : plans.length === 0 ? (
                <p className="mt-3 text-body-sm text-ink-muted">{t("vip.emptyPlans")}</p>
              ) : (
                <div className="mt-3 grid gap-2.5">
                  {plans.map((p) => {
                    const active = p.id === planId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlanId(p.id)}
                        className={cn(
                          "relative flex items-center justify-between gap-3 rounded-xl px-4 py-3.5 text-left transition-all",
                          active
                            ? "bg-brand/15 ring-2 ring-brand"
                            : "bg-surface-2 hover:bg-surface-3",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-ink">
                              {p.name || t("vip.days", { n: String(p.durationDays) })}
                            </span>
                            {p.badge ? (
                              <span className="rounded-full bg-gold/20 px-2 py-0.5 text-caption font-medium text-gold">
                                {p.badge}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-caption text-ink-muted">
                            {t("vip.days", { n: String(p.durationDays) })}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-h4 font-bold tabular-nums text-gold">
                            {formatUsd(Number(p.payAmount || 0))}
                          </p>
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
                </div>
              </div>
            ) : null}

            {err ? <p className="text-body-sm text-danger">{err}</p> : null}

            <button
              type="button"
              disabled={busy || !selected || loading}
              onClick={confirm}
              className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crown className="h-4 w-4" />
              )}
              {isActiveVip ? t("vip.renew") : t("vip.confirm")}
              {selected ? (
                <span className="ml-1 tabular-nums opacity-90">
                  · {formatUsd(payAmount)}
                </span>
              ) : null}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
