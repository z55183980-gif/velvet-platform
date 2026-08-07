"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { creatorApi, creatorUploadKycDoc } from "@/lib/creator-api";
import { formatApiError, useToast } from "@/components/toast";
import { EarningsChart } from "@/components/creator/earnings-chart";
import { CreatorWithdrawModal } from "@/components/creator/creator-withdraw-modal";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import { formatCreatorUsd } from "@/lib/creator-money";

export default function CreatorWalletPage() {
  const { t } = useLocale();
  const toast = useToast();
  const [dash, setDash] = useState<any>(null);
  const [kyc, setKyc] = useState<any>(null);
  const [daily, setDaily] = useState<{ day: string; totalVnd: string; orders: number }[]>([]);
  const [earnDays, setEarnDays] = useState<7 | 30>(7);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [kycFormOpen, setKycFormOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [cccdNumber, setCccdNumber] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [bankHolder, setBankHolder] = useState("");
  const [cccdFrontUrl, setCccdFrontUrl] = useState("");
  const [cccdBackUrl, setCccdBackUrl] = useState("");
  const [kycDocBusy, setKycDocBusy] = useState(false);
  const [kycDocMsg, setKycDocMsg] = useState<string | null>(null);
  const [kycBusy, setKycBusy] = useState(false);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const msg = formatApiError(e, fallback);
      setErr(msg);
      toast.error(msg);
    },
    [toast],
  );

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [d, k, earn] = await Promise.all([
        creatorApi<any>("/dashboard"),
        creatorApi<any>("/kyc/status"),
        creatorApi<{ rows: { day: string; totalVnd: string; orders: number }[] }>(
          `/earnings/daily?days=${earnDays}`,
        ),
      ]);
      setDash(d);
      setKyc(k);
      setDaily(earn?.rows || []);
    } catch (e: unknown) {
      fail(e, "error");
    }
  }, [earnDays, fail]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const available = Number(dash?.availableVnd || 0);
  const kycApproved = kyc?.kycStatus === "APPROVED";
  const kycPendingReview = kyc?.kycStatus === "PENDING" && !!kyc?.taxCode;
  const needKyc = !kycApproved;

  async function submitKyc() {
    if (
      !cccdNumber.trim() ||
      !taxCode.trim() ||
      !bankName.trim() ||
      !bankAccountNo.trim() ||
      !bankHolder.trim()
    ) {
      fail(t("creator.kycIncomplete"), "kyc incomplete");
      return;
    }
    setKycBusy(true);
    try {
      await creatorApi("/kyc/submit", {
        method: "POST",
        body: JSON.stringify({
          cccdNumber,
          cccdFrontUrl: cccdFrontUrl || undefined,
          cccdBackUrl: cccdBackUrl || undefined,
          faceVerified: true,
          taxCode,
          bankAccount: {
            bank: bankName,
            account: bankAccountNo,
            name: bankHolder,
          },
        }),
      });
      track("kyc_submit");
      setKycFormOpen(false);
      await reload();
      toast.success(t("creator.kycOk"));
    } catch (e: unknown) {
      fail(e, "kyc failed");
    } finally {
      setKycBusy(false);
    }
  }

  async function uploadKycDoc(file: File, kind: "cccd-front" | "cccd-back") {
    setKycDocBusy(true);
    setKycDocMsg(t("creator.uploading"));
    try {
      const { originalUrl } = await creatorUploadKycDoc(file, kind);
      if (kind === "cccd-front") setCccdFrontUrl(originalUrl);
      else setCccdBackUrl(originalUrl);
      setKycDocMsg(originalUrl);
    } catch (e: unknown) {
      setKycDocMsg(formatApiError(e, "upload fail"));
    } finally {
      setKycDocBusy(false);
    }
  }

  function openWithdraw() {
    if (!kycApproved) {
      toast.error(t("creator.withdrawNeedKyc"));
      setKycFormOpen(true);
      return;
    }
    setWithdrawOpen(true);
  }

  return (
    <div>
      <h2 className="text-h3 font-semibold text-ink">{t("creator.walletTitle")}</h2>
      <p className="mt-1 text-body-sm text-ink-muted">{t("creator.walletPageSubtitle")}</p>

      {err && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-danger/40 bg-surface px-3 py-2 text-caption text-danger"
        >
          {err}
        </p>
      )}

      {needKyc && (
        <section className="mt-6 rounded-xl border border-line bg-surface-2 px-4 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-caption font-medium",
                kycPendingReview
                  ? "bg-gold/20 text-gold"
                  : "bg-surface-3 text-ink-muted",
              )}
            >
              {kycPendingReview ? t("creator.kycStatusPending") : t("creator.kycStatusNone")}
            </span>
            <h3 className="text-body font-semibold text-ink">
              {kycPendingReview ? t("creator.kycPendingTitle") : t("creator.kycNoneTitle")}
            </h3>
          </div>
          <p className="mt-2 text-body-sm text-ink-muted">
            {kycPendingReview ? t("creator.kycPendingBody") : t("creator.kycNoneBody")}
          </p>
          <p className="mt-2 text-caption text-ink-subtle">
            {kycPendingReview ? t("creator.kycPendingHint") : t("creator.kycNoneHint")}
          </p>
          <div className="mt-4">
            {kycPendingReview ? (
              <button type="button" disabled className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {t("creator.kycStatusPending")}
              </button>
            ) : (
              <button
                type="button"
                className={buttonVariants({ variant: "primary", size: "sm" })}
                onClick={() => setKycFormOpen((v) => !v)}
              >
                {kycFormOpen ? t("common.close") : t("creator.kycNoneCta")}
              </button>
            )}
          </div>

          {kycFormOpen && !kycPendingReview && (
            <div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
              <p className="sm:col-span-2 text-body-sm font-medium text-ink">{t("creator.kycTitle")}</p>
              <input
                className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
                placeholder="CCCD (9 or 12 digits)"
                value={cccdNumber}
                onChange={(e) => setCccdNumber(e.target.value)}
              />
              <input
                className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
                placeholder="Tax code"
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
              />
              <input
                className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
                placeholder={t("creator.bankName")}
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              />
              <input
                className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
                placeholder={t("creator.bankAccount")}
                value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
              />
              <input
                className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink sm:col-span-2"
                placeholder={t("creator.bankHolder")}
                value={bankHolder}
                onChange={(e) => setBankHolder(e.target.value)}
              />
              <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-line bg-surface px-3 py-2 text-body-sm text-ink-muted hover:text-ink">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={kycDocBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadKycDoc(f, "cccd-front");
                  }}
                />
                {cccdFrontUrl || t("creator.uploadCccdFront")}
              </label>
              <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-line bg-surface px-3 py-2 text-body-sm text-ink-muted hover:text-ink">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={kycDocBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadKycDoc(f, "cccd-back");
                  }}
                />
                {cccdBackUrl || t("creator.uploadCccdBack")}
              </label>
              {kycDocMsg && <p className="sm:col-span-2 text-caption text-ink-subtle">{kycDocMsg}</p>}
              <button
                type="button"
                disabled={kycBusy}
                className={cn(buttonVariants({ variant: "primary" }), "sm:col-span-2")}
                onClick={() => void submitKyc()}
              >
                {t("creator.submitKyc")}
              </button>
            </div>
          )}
        </section>
      )}

      {kycApproved && (
        <section className="mt-6 rounded-xl border border-line bg-surface-2 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-success/15 px-2 py-0.5 text-caption font-medium text-success">
              {t("creator.kycStatusApproved")}
            </span>
            <h3 className="text-body font-semibold text-ink">{t("creator.kycApprovedTitle")}</h3>
          </div>
          <p className="mt-2 text-body-sm text-ink-muted">{t("creator.kycApprovedBody")}</p>
        </section>
      )}

      {dash && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-4">
            <div className="text-caption text-ink-subtle">{t("creator.available")}</div>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <div className="text-h4 font-semibold tabular-nums text-ink">
                {formatCreatorUsd(available)}
              </div>
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  disabled={!kycApproved}
                  title={!kycApproved ? t("creator.withdrawNeedKyc") : undefined}
                  className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
                  onClick={openWithdraw}
                >
                  {t("creator.withdrawAction")}
                </button>
                {!kycApproved && (
                  <span className="text-[11px] text-ink-subtle">{t("creator.withdrawNeedKyc")}</span>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-4">
            <div className="text-caption text-ink-subtle">{t("creator.pending")}</div>
            <div className="mt-1 text-h4 font-semibold tabular-nums text-ink">
              {formatCreatorUsd(dash.pendingVnd)}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-4">
            <div className="text-caption text-ink-subtle">{t("creator.totalEarned")}</div>
            <div className="mt-1 text-h4 font-semibold tabular-nums text-ink">
              {formatCreatorUsd(dash.totalEarnedVnd)}
            </div>
          </div>
        </div>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-h3 font-semibold text-ink">{t("creator.earnTrend")}</h3>
          <div className="flex gap-2">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setEarnDays(d)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  earnDays === d ? "bg-brand text-white" : "border border-line text-ink-muted"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <EarningsChart rows={daily} />
      </section>

      <CreatorWithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        availableVnd={available}
        kycApproved={kycApproved}
        onGoKyc={() => {
          setWithdrawOpen(false);
          setKycFormOpen(true);
        }}
        onSuccess={() => {
          toast.success(t("creator.withdrawOk"));
          void reload();
        }}
      />
    </div>
  );
}
