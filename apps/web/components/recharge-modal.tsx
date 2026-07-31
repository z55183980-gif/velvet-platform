"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Check, Coins } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import {
  getExchangeRates,
  getTopupPackages,
  topupOrder,
  simulatePay,
  type TopupPackageQuote,
} from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { track } from "@/lib/track";

type PayMethod = "ALIPAY" | "SIMULATE";

export function RechargeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const { user, openLogin, refreshWallet } = useAuth();
  const isDev = process.env.NODE_ENV === "development";

  const [currencies, setCurrencies] = useState<string[]>(["CNY", "VND"]);
  const [currency, setCurrency] = useState("CNY");
  const [packages, setPackages] = useState<TopupPackageQuote[]>([]);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>("ALIPAY");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [payHint, setPayHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setDone(false);
    setPayHint(null);
    setMethod(isDev ? "SIMULATE" : "ALIPAY");
    getExchangeRates().then((r) => {
      const list = r.map((x) => x.currency);
      if (list.length) {
        setCurrencies(list);
        if (!list.includes(currency)) setCurrency(list.includes("CNY") ? "CNY" : list[0]);
      }
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    getTopupPackages(currency).then((list) => {
      setPackages(list);
      setPackageId((prev) => {
        if (prev && list.find((p) => p.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    });
  }, [open, currency]);

  useEffect(() => {
    if (method === "ALIPAY" && currency !== "CNY" && isDev) {
      setMethod("SIMULATE");
    }
  }, [currency, method, isDev]);

  if (!open) return null;

  const selected = packages.find((p) => p.id === packageId) || null;
  const payAmount = selected?.payAmount ? Number(selected.payAmount) : 0;
  const credits = selected ? Number(selected.credits) : 0;

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
    if (method === "ALIPAY" && currency !== "CNY") {
      setErr(t("recharge.alipayCnyOnly"));
      return;
    }
    setBusy(true);
    setErr(null);
    setPayHint(null);
    try {
      const payMethod = method === "ALIPAY" ? "ALIPAY" : "STRIPE";
      const r: any = await topupOrder(selected.id, currency, payMethod);
      if (method === "ALIPAY" && r?.payUrl) {
        track("recharge", {
          method: "ALIPAY",
          currency,
          packageId: selected.id,
          credits,
          payAmount,
        });
        setPayHint(t("recharge.redirecting"));
        window.location.href = r.payUrl;
        return;
      }
      if (method === "ALIPAY" && r?.payForm) {
        const wrap = document.createElement("div");
        wrap.innerHTML = r.payForm;
        document.body.appendChild(wrap);
        const form = wrap.querySelector("form");
        if (form) {
          (form as HTMLFormElement).submit();
          return;
        }
      }
      if (isDev && r?.orderNo && method === "SIMULATE") {
        await simulatePay(r.orderNo);
        await refreshWallet();
        track("recharge", { method, currency, packageId: selected.id, credits, payAmount });
        setDone(true);
        setTimeout(() => onClose(), 1200);
        return;
      }
      setErr("Chưa nhận được payUrl — kiểm tra cấu hình Alipay");
    } catch (e: any) {
      setErr(e?.message || "Nạp tiền thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-surface shadow-3 sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div
          className="relative px-6 pb-4 pt-6"
          style={{
            background:
              "radial-gradient(600px 200px at 10% -20%, oklch(0.68 0.19 18 / 0.22), transparent 55%)",
          }}
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-ink-muted transition-colors hover:text-ink"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="text-overline uppercase text-brand">{t("recharge.title")}</p>
          <h2 className="mt-1 text-h3 font-bold text-ink">{t("recharge.subtitle")}</h2>
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
              <label className="text-caption uppercase text-ink-subtle">{t("recharge.currency")}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {currencies.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurrency(c)}
                    className={cn(
                      "rounded-full px-4 py-2 text-body-sm font-medium transition-colors",
                      currency === c
                        ? "bg-brand text-white"
                        : "bg-surface-2 text-ink-muted hover:text-ink",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-caption uppercase text-ink-subtle">{t("recharge.package")}</label>
              {packages.length === 0 ? (
                <p className="mt-3 text-body-sm text-ink-muted">{t("recharge.emptyPackages")}</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {packages.map((p) => {
                    const active = p.id === packageId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPackageId(p.id)}
                        className={cn(
                          "relative flex flex-col items-start rounded-xl px-4 py-4 text-left transition-all duration-[var(--dur-base)]",
                          active
                            ? "bg-brand/15 ring-2 ring-brand"
                            : "bg-surface-2 hover:bg-surface-3",
                        )}
                      >
                        <span className="text-h2 font-bold tabular-nums text-ink">
                          {Number(p.credits).toLocaleString()}
                        </span>
                        <span className="mt-0.5 text-caption text-ink-subtle">积分</span>
                        <span className="mt-3 text-body-sm font-semibold tabular-nums text-gold">
                          {Number(p.payAmount || 0).toLocaleString()} {currency}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="text-caption uppercase text-ink-subtle">{t("recharge.method")}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMethod("ALIPAY")}
                  disabled={currency !== "CNY"}
                  className={cn(
                    "rounded-full px-4 py-2 text-body-sm font-medium transition-colors disabled:opacity-40",
                    method === "ALIPAY"
                      ? "bg-brand text-white"
                      : "bg-surface-2 text-ink-muted hover:text-ink",
                  )}
                >
                  {t("recharge.alipay")}
                </button>
                {isDev && (
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
                )}
              </div>
              {currency !== "CNY" && (
                <p className="mt-2 text-caption text-ink-subtle">{t("recharge.alipayCnyOnly")}</p>
              )}
            </div>

            {selected && (
              <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-5 py-4">
                <div className="flex items-center gap-2 text-ink-muted">
                  <Coins className="h-4 w-4 text-gold" />
                  <span className="text-body-sm">{t("recharge.getCredits")}</span>
                </div>
                <div className="text-right">
                  <p className="text-h3 font-bold tabular-nums text-gold">
                    {credits.toLocaleString()}
                  </p>
                  <p className="text-caption text-ink-subtle">
                    {payAmount.toLocaleString()} {currency}
                  </p>
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
