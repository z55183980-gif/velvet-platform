"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Check, Lock, Coins } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { buttonVariants } from "./ui/button";
import { formatCredits } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Episode } from "@/lib/mock-data";

type Status = "idle" | "processing" | "success" | "error" | "insufficient";

export function UnlockSheet({
  open,
  episode,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  episode: Episode | null;
  onClose: () => void;
  onConfirmed?: (
    ep: Episode,
  ) => Promise<{ ok: boolean; alreadyUnlocked?: boolean; error?: string; code?: number } | void>;
}) {
  const { t } = useLocale();
  const { balance, openRecharge, refreshWallet } = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const price = episode?.price ?? 0;
  const bal = balance ?? 0;
  const balanceKnown = balance != null;
  const insufficient = balanceKnown && bal < price;

  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setErrMsg(null);
    void refreshWallet();
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "processing") onClose();
    };
    window.addEventListener("keydown", onKey);
    const id = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      cancelAnimationFrame(id);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !episode) return null;

  function goRecharge() {
    onClose();
    openRecharge();
  }

  async function confirm() {
    if (insufficient) {
      setStatus("insufficient");
      return;
    }
    setStatus("processing");
    setErrMsg(null);
    try {
      const r = await onConfirmed?.(episode!);
      const ok = !r || r.ok || r.alreadyUnlocked || r.error === "mock";
      if (ok) {
        setStatus("success");
        timer.current = setTimeout(() => onClose(), 1500);
        return;
      }
      // 4100 = INSUFFICIENT_BALANCE（后端钱包）
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

  const showInsufficient = status === "insufficient" || (status === "idle" && insufficient);

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
              onClick={goRecharge}
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "mt-3 w-full")}
            >
              {t("unlock.goRecharge")}
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-surface-2 px-5 py-6">
              <div className="text-center">
                <p className="text-caption uppercase text-ink-subtle">{t("unlock.priceLabel")}</p>
                <p className="mt-2 text-display font-bold tabular-nums text-ink md:text-h1">
                  {price.toLocaleString()}
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
                    showInsufficient ? "text-danger" : "text-ink",
                  )}
                >
                  {balanceKnown ? formatCredits(bal, t("card.credits")) : "—"}
                </span>
              </div>
            </div>

            {showInsufficient && (
              <p className="mt-4 text-center text-body-sm text-danger">
                {errMsg || t("unlock.insufficient")}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-3">
              {showInsufficient ? (
                <button
                  onClick={goRecharge}
                  className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
                >
                  <Coins className="h-4 w-4" />
                  {t("unlock.goRecharge")}
                </button>
              ) : (
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
                      {t("unlock.confirm")}
                    </>
                  )}
                </button>
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
