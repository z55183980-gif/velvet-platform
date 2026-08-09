"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Check, Lock, Coins, Crown } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { useDocumentScrollLock } from "@/hooks/use-document-scroll-lock";
import { getVipPlans } from "@/lib/api";
import { buttonVariants } from "./ui/button";
import { cn, formatAmount, formatCredits, formatUsd } from "@/lib/utils";
import type { Episode } from "@/lib/mock-data";

type Status = "idle" | "processing" | "success" | "error" | "insufficient";

const VIP_PAY_CURRENCY = "USD";

function lowestVipPayAmount(plans: { payAmount?: string; basePrice?: string }[]): number | null {
  let min: number | null = null;
  for (const plan of plans) {
    const amount = Number(plan.payAmount ?? plan.basePrice);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (min == null || amount < min) min = amount;
  }
  return min;
}

function VipPriceMark({ value }: { value: string }) {
  const match = value.match(/^(\D*)([\d,]+)(\.\d+)?$/);
  if (!match) {
    return (
      <span className="shrink-0 text-[13px] font-extrabold tabular-nums tracking-tight text-[#1F1608]">
        {value}
      </span>
    );
  }
  const [, currency, whole, fraction = ""] = match;
  return (
    <span className="inline-flex shrink-0 items-baseline font-extrabold tabular-nums tracking-tight text-[#1F1608]">
      {currency ? (
        <span className="mr-px text-[10px] font-bold leading-none">{currency}</span>
      ) : null}
      <span className="text-[13px] leading-none">{whole}</span>
      {fraction ? <span className="text-[10px] leading-none">{fraction}</span> : null}
    </span>
  );
}

function VipCtaButton({
  label,
  hint,
  price,
  onClick,
  disabled,
  className,
}: {
  label: string;
  hint: string;
  price?: string | null;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-md px-5 py-3",
        "bg-[linear-gradient(145deg,oklch(0.9_0.1_90)_0%,oklch(0.82_0.13_85)_42%,oklch(0.72_0.12_78)_100%)]",
        "text-[#2A1E05]",
        "shadow-[0_8px_22px_oklch(0.78_0.12_85_/_0.32),inset_0_1px_0_oklch(1_0_0_/_0.38)]",
        "ring-1 ring-inset ring-[oklch(1_0_0_/_0.22)]",
        "transition-[transform,filter,box-shadow] duration-200 ease-out",
        "hover:brightness-[1.04] hover:shadow-[0_10px_28px_oklch(0.78_0.12_85_/_0.42)]",
        "active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,oklch(1_0_0_/_0.28)_0%,transparent_45%)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -left-6 top-1/2 h-16 w-16 -translate-y-1/2 rounded-full bg-[oklch(1_0_0_/_0.18)] blur-xl transition-opacity group-hover:opacity-90"
      />
      <span className="relative inline-flex items-center gap-2 font-semibold tracking-wide">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2A1E05]/14 shadow-[inset_0_0_0_1px_oklch(0.35_0.04_75_/_0.18)]">
          <Crown className="h-3.5 w-3.5" strokeWidth={2.35} />
        </span>
        {label}
      </span>
      <span className="relative inline-flex max-w-[62%] items-baseline gap-1.5 truncate rounded-full bg-[oklch(0.97_0.02_90_/_0.92)] px-2.5 py-1 shadow-[inset_0_0_0_1px_oklch(0.55_0.08_80_/_0.16)]">
        {price ? <VipPriceMark value={price} /> : null}
        <span className="truncate text-[11px] font-medium leading-none tracking-[0.02em] text-[#5A4010]/80">
          {hint}
        </span>
      </span>
    </button>
  );
}

export function UnlockSheet({
  open,
  episode,
  onClose,
  onConfirmed,
  buyoutCredits,
  onBuyDrama,
  vipActive,
}: {
  open: boolean;
  episode: Episode | null;
  onClose: () => void;
  onConfirmed?: (
    ep: Episode,
  ) => Promise<{ ok: boolean; alreadyUnlocked?: boolean; error?: string; code?: number } | void>;
  buyoutCredits?: number | null;
  onBuyDrama?: () => Promise<{ ok: boolean; error?: string; code?: number } | void>;
  vipActive?: boolean;
}) {
  const { t } = useLocale();
  const { balance, openRecharge, openVip, refreshWallet } = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"episode" | "drama">("episode");
  const [vipFromPrice, setVipFromPrice] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const price = mode === "drama" ? Number(buyoutCredits || 0) : episode?.price ?? 0;
  const bal = balance ?? 0;
  const balanceKnown = balance != null;
  const insufficient = balanceKnown && bal < price;
  const showBuyout = !!(buyoutCredits && buyoutCredits > 0 && onBuyDrama);
  /** Only surface recharge after user tries unlock (or server returns 4100). */
  const showRechargeGate = status === "insufficient";
  const vipHint = t("vip.openHint");
  const vipPriceLabel = vipFromPrice != null ? formatUsd(vipFromPrice) : null;

  useDocumentScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setErrMsg(null);
    setMode("episode");
    void refreshWallet();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && statusRef.current !== "processing") onClose();
    };
    window.addEventListener("keydown", onKey);
    const id = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(id);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || vipActive) return;
    let cancelled = false;
    void getVipPlans(VIP_PAY_CURRENCY)
      .then((plans) => {
        if (cancelled) return;
        setVipFromPrice(lowestVipPayAmount(plans));
      })
      .catch(() => {
        if (!cancelled) setVipFromPrice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, vipActive]);

  if (!open || !episode) return null;

  function goRecharge() {
    onClose();
    openRecharge();
  }

  function goVip() {
    onClose();
    openVip();
  }

  function dismissInsufficient() {
    setStatus("idle");
    setErrMsg(null);
  }

  async function confirm() {
    if (vipActive && mode === "episode") {
      setStatus("processing");
      try {
        const r = await onConfirmed?.(episode!);
        const ok = !r || r.ok || r.alreadyUnlocked || r.error === "mock";
        if (ok) {
          setStatus("success");
          timer.current = setTimeout(() => onClose(), 1500);
          return;
        }
        setStatus("error");
        if (r?.error) setErrMsg(r.error);
      } catch (e: any) {
        setStatus("error");
        setErrMsg(e?.message || null);
      }
      return;
    }
    if (insufficient) {
      setStatus("insufficient");
      return;
    }
    setStatus("processing");
    setErrMsg(null);
    try {
      const r =
        mode === "drama"
          ? await onBuyDrama?.()
          : await onConfirmed?.(episode!);
      const ok = !r || r.ok || (r as any).alreadyUnlocked || (r as any).error === "mock";
      if (ok) {
        setStatus("success");
        timer.current = setTimeout(() => onClose(), 1500);
        return;
      }
      if (r?.code === 4100) {
        setStatus("insufficient");
        setErrMsg(r.error || null);
        return;
      }
      setStatus("error");
      if (r?.error) setErrMsg(r.error);
    } catch (e: any) {
      setStatus("error");
      setErrMsg(e?.message || null);
    }
  }

  const balanceWarn = insufficient && !vipActive;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("unlock.title")}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => status !== "processing" && onClose()}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-surface p-6 shadow-3 outline-none sm:rounded-2xl"
        style={{
          backgroundImage:
            "radial-gradient(500px 180px at 80% -30%, oklch(0.82 0.12 85 / 0.12), transparent 50%)",
        }}
      >
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-overline uppercase text-brand">{t("unlock.title")}</p>
            <h3 className="mt-1 text-h3 font-semibold text-ink">
              {t("unlock.episodeNumber", { n: episode.no })}
            </h3>
          </div>
          <button
            onClick={() => status !== "processing" && onClose()}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {status === "success" ? (
          <div className="flex flex-col items-center py-10 text-center animate-[rise-in_0.45s_var(--ease-out)_both]">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success">
              <Check className="h-8 w-8" />
            </span>
            <p className="mt-5 text-h3 font-semibold text-ink">{t("unlock.success")}</p>
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-danger/15 text-danger">
              <X className="h-7 w-7" />
            </span>
            <p className="mt-4 text-h4 font-semibold text-ink">{t("unlock.error")}</p>
            {errMsg && <p className="mt-2 text-body-sm text-ink-muted">{errMsg}</p>}
            <button
              onClick={confirm}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-5 w-full")}
            >
              {t("unlock.retry")}
            </button>
            <button
              onClick={onClose}
              className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "mt-3 w-full")}
            >
              {t("unlock.cancel")}
            </button>
          </div>
        ) : showRechargeGate ? (
          <div className="flex flex-col items-center py-6 text-center animate-[rise-in_0.35s_var(--ease-out)_both]">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-danger/15 text-danger">
              <Coins className="h-7 w-7" />
            </span>
            <p className="mt-4 text-h4 font-semibold text-ink">{t("unlock.insufficientTitle")}</p>
            <p className="mt-2 text-body-sm text-ink-muted">
              {errMsg || t("unlock.insufficient")}
            </p>
            <div className="mt-2 w-full rounded-xl bg-surface-2 px-4 py-3 text-body-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">{t("unlock.priceLabel")}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatCredits(price, t("card.credits"))}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-ink-muted">{t("unlock.balanceLabel")}</span>
                <span className="font-semibold tabular-nums text-danger">
                  {balanceKnown ? formatCredits(bal, t("card.credits")) : "—"}
                </span>
              </div>
            </div>
            <button
              onClick={goRecharge}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-5 w-full")}
            >
              <Coins className="h-4 w-4" />
              {t("unlock.goRecharge")}
            </button>
            {!vipActive ? (
              <VipCtaButton
                className="mt-3"
                onClick={goVip}
                label={t("vip.open")}
                hint={vipHint}
                price={vipPriceLabel}
              />
            ) : null}
            <button
              onClick={dismissInsufficient}
              className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "mt-2 w-full")}
            >
              {t("unlock.back")}
            </button>
          </div>
        ) : (
          <>
            {vipActive ? (
              <p className="mb-3 rounded-lg bg-brand/10 px-3 py-2 text-center text-body-sm text-brand">
                {t("vip.freeWatch")}
              </p>
            ) : null}
            {showBuyout ? (
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("episode")}
                  className={cn(
                    "flex-1 rounded-full px-3 py-2 text-body-sm",
                    mode === "episode" ? "bg-brand text-white" : "bg-surface-2 text-ink-muted",
                  )}
                >
                  {t("unlock.confirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("drama")}
                  className={cn(
                    "flex-1 rounded-full px-3 py-2 text-body-sm",
                    mode === "drama" ? "bg-brand text-white" : "bg-surface-2 text-ink-muted",
                  )}
                >
                  {t("unlock.buyDrama")}
                </button>
              </div>
            ) : null}
            {mode === "drama" ? (
              <p className="mb-3 text-center text-caption text-ink-muted">
                {t("unlock.buyDramaHint", { n: String(buyoutCredits) })}
              </p>
            ) : null}
            <div className="rounded-xl bg-surface-2 px-5 py-6">
              <div className="text-center">
                <p className="text-caption uppercase text-ink-subtle">
                  {vipActive && mode === "episode" ? t("vip.freeWatch") : t("unlock.priceLabel")}
                </p>
                <p className="mt-2 text-display font-bold tabular-nums text-ink md:text-h1">
                  {vipActive && mode === "episode" ? formatAmount(0) : formatAmount(price)}
                </p>
                <p className="mt-1 text-body-sm text-ink-muted">{t("card.credits")}</p>
              </div>
              <div className="mt-5 flex items-center justify-between text-body-sm">
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <Coins className="h-4 w-4 text-gold" />
                  {t("unlock.balanceLabel")}
                </span>
                <span
                  className={cn(
                    "text-h4 font-semibold tabular-nums",
                    balanceWarn ? "text-danger" : "text-ink",
                  )}
                >
                  {balanceKnown ? formatCredits(bal, t("card.credits")) : "—"}
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              {/* Primary pair: unlock this ep · VIP — recharge only on insufficient gate */}
              {vipActive && mode === "episode" ? (
                <button
                  onClick={confirm}
                  disabled={status === "processing"}
                  className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
                >
                  {status === "processing" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("unlock.processing")}
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" />
                      {t("vip.freeWatch")}
                    </>
                  )}
                </button>
              ) : (
                <>
                  <button
                    onClick={confirm}
                    disabled={status === "processing"}
                    className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
                  >
                    {status === "processing" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("unlock.processing")}
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                        {mode === "drama" ? t("unlock.buyDrama") : t("unlock.confirm")}
                      </>
                    )}
                  </button>
                  {!vipActive ? (
                    <VipCtaButton
                      onClick={goVip}
                      disabled={status === "processing"}
                      label={t("vip.open")}
                      hint={vipHint}
                      price={vipPriceLabel}
                    />
                  ) : null}
                </>
              )}
              <button
                onClick={onClose}
                disabled={status === "processing"}
                className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "w-full")}
              >
                {t("unlock.cancel")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
