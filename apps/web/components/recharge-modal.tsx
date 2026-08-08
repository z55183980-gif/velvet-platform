"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Check, Coins } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import {
  getTopupPackages,
  topupOrder,
  simulatePay,
  type TopupPackageQuote,
} from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatAmount, formatUsd } from "@/lib/utils";
import { track } from "@/lib/track";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

const PAY_CURRENCY = "USD";

type PayMethod = "STRIPE" | "SIMULATE";

function packageParts(p: TopupPackageQuote) {
  const total = Number(p.credits) || 0;
  const bonus = Number(p.bonusCredits ?? 0) || 0;
  const immediate = Number(p.baseCredits ?? total - bonus) || total;
  return { total, immediate, bonus };
}

export function RechargeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const { user, openLogin, refreshWallet } = useAuth();
  const isDev = process.env.NODE_ENV === "development";

  const [packages, setPackages] = useState<TopupPackageQuote[]>([]);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>("STRIPE");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [payHint, setPayHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [packageLoadError, setPackageLoadError] = useState(false);
  const [packageReloadKey, setPackageReloadKey] = useState(0);
  const dialogRef = useDialogFocus<HTMLDivElement>(open, () => {
    if (!busy) onClose();
  });

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setDone(false);
    setPayHint(null);
    setMethod(isDev ? "SIMULATE" : "STRIPE");
  }, [open, isDev]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setPackageLoadError(false);
    getTopupPackages(PAY_CURRENCY)
      .then((list) => {
        setPackages(list);
        setPackageId((prev) => {
          if (prev && list.find((p) => p.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch(() => {
        setPackages([]);
        setPackageLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [open, packageReloadKey]);

  if (!open) return null;

  const selected = packages.find((p) => p.id === packageId) || null;
  const payAmount = selected?.payAmount ? Number(selected.payAmount) : 0;
  const selectedParts = selected ? packageParts(selected) : { total: 0, immediate: 0, bonus: 0 };
  const credits = selectedParts.total;

  async function confirm() {
    if (!user) {
      onClose();
      openLogin();
      return;
    }
    if (!selected) {
      setErr(t("recharge.emptyPackages"));
      return;
    }
    setBusy(true);
    setErr(null);
    setPayHint(null);
    try {
      const wantSimulate = isDev && method === "SIMULATE";
      const r: any = await topupOrder(selected.id, PAY_CURRENCY, "STRIPE", {
        createCheckout: !wantSimulate,
      });
      if (wantSimulate && r?.orderNo) {
        await simulatePay(r.orderNo);
        await refreshWallet();
        track("recharge", {
          method,
          currency: PAY_CURRENCY,
          packageId: selected.id,
          credits,
          payAmount,
        });
        setDone(true);
        setTimeout(() => onClose(), 1200);
        return;
      }
      const checkoutUrl = String(r?.checkoutUrl || r?.checkout_url || "").trim();
      if (checkoutUrl) {
        track("recharge", {
          method: "STRIPE",
          currency: PAY_CURRENCY,
          packageId: selected.id,
          credits,
          payAmount,
        });
        setPayHint(t("recharge.redirectingStripe"));
        window.location.assign(checkoutUrl);
        return;
      }
      setErr(t("vip.payPending"));
    } catch (e: any) {
      setErr(e?.message || t("recharge.fail"));
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
        aria-labelledby="recharge-dialog-title"
        tabIndex={-1}
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface shadow-3 sm:rounded-2xl"
      >
        <div
          className="relative px-6 pb-4 pt-6"
          style={{
            background:
              "radial-gradient(600px 200px at 10% -20%, oklch(0.68 0.19 18 / 0.22), transparent 55%)",
          }}
        >
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
          <p className="text-overline uppercase text-brand">{t("recharge.title")}</p>
          <h2 id="recharge-dialog-title" className="mt-1 text-h3 font-bold text-ink">{t("recharge.subtitle")}</h2>
        </div>

        {done ? (
          <div className="flex flex-col items-center px-6 py-12 text-center animate-[rise-in_0.4s_var(--ease-out)_both]">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success">
              <Check className="h-8 w-8" />
            </span>
            <p className="mt-5 text-h3 font-semibold text-ink">{t("recharge.success")}</p>
          </div>
        ) : (
          <div className="space-y-6 px-6 pb-6">
            <div>
              <label className="text-caption uppercase text-ink-subtle">{t("recharge.package")}</label>
              {loading ? (
                <p className="mt-3 text-body-sm text-ink-muted">{t("common.loading")}</p>
              ) : packageLoadError ? (
                <div className="mt-3 rounded-xl bg-surface-2 p-4 text-center" role="alert">
                  <p className="text-body-sm text-ink-muted">{t("errors.loadFailed")}</p>
                  <button
                    type="button"
                    onClick={() => setPackageReloadKey((key) => key + 1)}
                    className="mt-3 min-h-11 rounded-full bg-brand px-5 py-2 text-body-sm font-semibold text-white"
                  >
                    {t("common.retry")}
                  </button>
                </div>
              ) : packages.length === 0 ? (
                <p className="mt-3 text-body-sm text-ink-muted">{t("recharge.emptyPackages")}</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {packages.map((p) => {
                    const active = p.id === packageId;
                    const parts = packageParts(p);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPackageId(p.id)}
                        className={cn(
                          "relative flex flex-col overflow-hidden rounded-xl px-4 py-4 text-left transition-all duration-[var(--dur-base)]",
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
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 place-items-center rounded-full bg-gold/20 text-gold">
                            <Coins className="h-4 w-4" />
                          </span>
                          <span className="text-h2 font-bold tabular-nums text-ink">
                            {formatAmount(parts.total)}
                          </span>
                        </div>
                        <div className="mt-3 space-y-0.5 text-caption text-ink-muted">
                          <p>
                            {t("recharge.immediate")}:{" "}
                            <span className="tabular-nums text-ink">{formatAmount(parts.immediate)}</span>
                          </p>
                          {parts.bonus > 0 ? (
                            <p>
                              {t("recharge.bonus")}:{" "}
                              <span className="tabular-nums text-success">
                                {formatAmount(parts.bonus)}
                              </span>
                            </p>
                          ) : null}
                        </div>
                        <span className="mt-3 text-body-sm font-semibold tabular-nums text-gold">
                          {formatUsd(Number(p.payAmount || 0))}
                        </span>
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
                  <Coins className="h-4 w-4 text-gold" />
                  <span className="text-body-sm">{t("recharge.getCredits")}</span>
                </div>
                <div className="text-right">
                  <p className="text-h3 font-bold tabular-nums text-gold">
                    {formatAmount(credits)}
                  </p>
                  <p className="text-caption text-ink-subtle">
                    {selectedParts.bonus > 0
                      ? `${t("recharge.immediate")} ${formatAmount(selectedParts.immediate)} · ${t("recharge.bonus")} ${formatAmount(selectedParts.bonus)}`
                      : formatUsd(payAmount)}
                  </p>
                  {selectedParts.bonus > 0 ? (
                    <p className="text-caption text-ink-subtle">{formatUsd(payAmount)}</p>
                  ) : null}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={confirm}
              disabled={busy || !selected}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full shadow-brand")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("recharge.confirm")}
            </button>
            {payHint && <p className="text-body-sm text-ink-muted">{payHint}</p>}
            {err && <p className="text-body-sm text-danger">{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
