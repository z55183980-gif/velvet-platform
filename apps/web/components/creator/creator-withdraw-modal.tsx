"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useSiteConfig } from "@/lib/site-config";
import { buttonVariants } from "@/components/ui/button";
import { creatorApi } from "@/lib/creator-api";
import { formatApiError } from "@/components/toast";
import { cn } from "@/lib/utils";
import { formatCreatorUsd } from "@/lib/creator-money";

type Props = {
  open: boolean;
  onClose: () => void;
  availableVnd: number;
  kycApproved: boolean;
  onGoKyc: () => void;
  onSuccess: () => void;
};

export function CreatorWithdrawModal({
  open,
  onClose,
  availableVnd,
  kycApproved,
  onGoKyc,
  onSuccess,
}: Props) {
  const { t } = useLocale();
  const site = useSiteConfig();
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [bankHolder, setBankHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const minWithdraw = site.minWithdrawVnd;

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setBusy(false);
    setAmount(availableVnd > 0 ? String(availableVnd) : "");
  }, [open, availableVnd]);

  if (!open) return null;

  async function submit() {
    if (!kycApproved) {
      setErr(t("creator.withdrawNeedKycModal"));
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < minWithdraw) {
      setErr(t("creator.withdrawBelowMin", { min: formatCreatorUsd(minWithdraw) }));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await creatorApi("/withdraws", {
        method: "POST",
        body: JSON.stringify({
          amountVnd: amountNum,
          bankInfo: {
            bank: bankName.trim(),
            account: bankAccountNo.trim(),
            name: bankHolder.trim(),
          },
        }),
      });
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const msg = formatApiError(e, "withdraw failed");
      if (String(msg).includes("creator.withdrawBelowMin")) {
        setErr(t("creator.withdrawBelowMin", { min: formatCreatorUsd(minWithdraw) }));
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="creator-withdraw-title"
        className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-surface shadow-3 sm:rounded-2xl"
      >
        <div className="relative px-6 pb-2 pt-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 text-ink-muted transition-colors hover:text-ink"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
          <h2 id="creator-withdraw-title" className="pr-8 text-h3 font-bold text-ink">
            {t("creator.withdrawSection")}
          </h2>
          <p className="mt-1 text-caption text-ink-subtle">
            {t("creator.available")}: {formatCreatorUsd(availableVnd)}
          </p>
          <p className="mt-1 text-caption text-ink-subtle">{t("creator.withdrawHint")}</p>
          <p className="mt-1 text-caption text-ink-subtle">
            {t("creator.withdrawMinHint", { min: formatCreatorUsd(minWithdraw) })}
          </p>
        </div>

        {!kycApproved ? (
          <div className="space-y-4 px-6 pb-6 pt-4">
            <p className="text-body-sm text-ink-muted">{t("creator.withdrawNeedKycModal")}</p>
            <button
              type="button"
              className={cn(buttonVariants({ variant: "primary" }), "w-full")}
              onClick={onGoKyc}
            >
              {t("creator.withdrawGoKyc")}
            </button>
          </div>
        ) : (
          <div className="space-y-3 px-6 pb-6 pt-4">
            <input
              className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm text-ink"
              placeholder={t("creator.withdrawAmount")}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm text-ink"
              placeholder={t("creator.bankName")}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm text-ink"
              placeholder={t("creator.bankAccount")}
              value={bankAccountNo}
              onChange={(e) => setBankAccountNo(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm text-ink"
              placeholder={t("creator.bankHolder")}
              value={bankHolder}
              onChange={(e) => setBankHolder(e.target.value)}
            />
            {err && (
              <p role="alert" className="text-caption text-danger">
                {err}
              </p>
            )}
            <button
              type="button"
              disabled={
                busy || !amount.trim() || !bankName.trim() || !bankAccountNo.trim() || !bankHolder.trim()
              }
              className={cn(buttonVariants({ variant: "primary" }), "w-full")}
              onClick={() => void submit()}
            >
              {busy ? t("common.loading") : t("creator.withdrawSubmit")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
