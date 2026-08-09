"use client";

import { useEffect, type ReactNode } from "react";
import { Button, Input, Switch, cn } from "@velvet/ui";
import { Save } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { GlobalLockMode } from "../lib/drama-playback-policy";
import {
  calcBuyoutCredits,
  freeCountWhenInheriting,
  freeEpisodeCountFromCustomPolicy,
} from "../lib/drama-playback-policy";

export type DramaPlaybackPolicyFormProps = {
  /** Drama create/edit: follow-global switch. Global settings: omit inherit card. */
  surface?: "drama" | "global";
  inheritGlobal?: boolean;
  onInheritGlobalChange?: (next: boolean) => void;
  globalMode?: GlobalLockMode;
  globalFreeCount?: number;
  globalPreviewSeconds?: number;
  episodeTotal: number;
  /** Explicit ALL_FREE — future episodes stay free (not freeEnd = current total). */
  allFree: boolean;
  onAllFreeChange: (next: boolean) => void;
  freeRangeStart: string;
  freeRangeEnd: string;
  onFreeRangeStartChange: (value: string) => void;
  onFreeRangeEndChange: (value: string) => void;
  priceCredits: number;
  onPriceCreditsChange: (value: number) => void;
  /** Full-drama buyout discount 0–100 (0 = off). Auto-converts to credits by paid episode count. */
  buyoutDiscountPercent: number;
  onBuyoutDiscountPercentChange: (value: number) => void;
  allowPreview: boolean;
  onAllowPreviewChange: (value: boolean) => void;
  previewSeconds: number;
  onPreviewSecondsChange: (value: number) => void;
  disabled?: boolean;
  /** Unique radio name so create/edit/settings can coexist. */
  previewRadioName?: string;
  variant?: "upload-panel" | "content-section";
  showHeading?: boolean;
  headingHint?: string;
  headingExtra?: ReactNode;
  showSaveButton?: boolean;
  savePending?: boolean;
  onSave?: () => void;
  /** Optional footer preview override (global settings). */
  previewText?: string;
  previewIsFree?: boolean;
};

export function DramaPlaybackPolicyForm({
  surface = "drama",
  inheritGlobal = false,
  onInheritGlobalChange,
  globalMode = "FREE_FIRST_N",
  globalFreeCount = 0,
  globalPreviewSeconds = 0,
  episodeTotal,
  allFree,
  onAllFreeChange,
  freeRangeStart,
  freeRangeEnd,
  onFreeRangeStartChange,
  onFreeRangeEndChange,
  priceCredits,
  onPriceCreditsChange,
  buyoutDiscountPercent,
  onBuyoutDiscountPercentChange,
  allowPreview,
  onAllowPreviewChange,
  previewSeconds,
  onPreviewSecondsChange,
  disabled = false,
  previewRadioName = "member-preview-policy",
  variant = "upload-panel",
  showHeading = true,
  headingHint,
  headingExtra,
  showSaveButton = false,
  savePending = false,
  onSave,
  previewText,
  previewIsFree,
}: DramaPlaybackPolicyFormProps) {
  const { t } = useI18n();
  const isGlobal = surface === "global";
  const customEditable = isGlobal || !inheritGlobal;
  const rangeDisabled = disabled || allFree || (!isGlobal && !episodeTotal);

  // Coerce dirty mid-range drafts (start>1) back to first-N semantics.
  useEffect(() => {
    if (freeRangeStart !== "1") onFreeRangeStartChange("1");
  }, [freeRangeStart, onFreeRangeStartChange]);

  const previewFreeCount =
    !isGlobal && inheritGlobal
      ? freeCountWhenInheriting({
          total: episodeTotal,
          globalMode,
          globalFreeCount,
        })
      : freeEpisodeCountFromCustomPolicy(episodeTotal, "1", freeRangeEnd, allFree);

  const previewCredits = Math.max(1, priceCredits || 10);
  const previewIsAllFree = allFree || (episodeTotal > 0 && previewFreeCount >= episodeTotal);
  const pricingLocked = isGlobal
    ? allFree
    : inheritGlobal
      ? globalMode === "ALL_FREE"
      : allFree;
  const previewBuyout = calcBuyoutCredits({
    episodeTotal,
    freeCount: previewFreeCount,
    priceCredits: previewCredits,
    discountPercent: buyoutDiscountPercent,
  });
  const discountClamped = Math.min(100, Math.max(0, Math.floor(Number(buyoutDiscountPercent) || 0)));

  const pricingFields = (
    <>
      <label className="upload-field">
        <span>{t("priceCreditsPerEpisode")}</span>
        <Input
          type="number"
          min={1}
          value={priceCredits}
          disabled={disabled || pricingLocked}
          onChange={(e) => onPriceCreditsChange(Number(e.target.value) || 0)}
        />
      </label>
      <label className="upload-field">
        <span>{t("buyoutDiscountPercentLabel")}</span>
        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          value={buyoutDiscountPercent}
          disabled={disabled || pricingLocked}
          onChange={(e) => {
            const n = Math.floor(Number(e.target.value));
            if (!Number.isFinite(n)) {
              onBuyoutDiscountPercentChange(0);
              return;
            }
            onBuyoutDiscountPercentChange(Math.min(100, Math.max(0, n)));
          }}
        />
      </label>
      <p className="text-caption text-ink-muted">
        {pricingLocked
          ? t("buyoutDiscountAllFreeHint")
          : discountClamped < 1
            ? t("buyoutDiscountOffHint")
            : !isGlobal && episodeTotal > 0 && previewBuyout != null
              ? t("buyoutDiscountPreview", {
                  paid: Math.max(0, episodeTotal - previewFreeCount),
                  price: previewCredits,
                  percent: discountClamped,
                  buyout: previewBuyout,
                })
              : t("buyoutDiscountFormulaHint", { percent: discountClamped })}
      </p>
    </>
  );
  const shellClass =
    variant === "upload-panel" ? "upload-panel space-y-3" : "content-section-card space-y-3";
  const headClass =
    variant === "upload-panel" ? "upload-panel__head" : "content-section-heading";

  return (
    <section className={shellClass}>
      {showHeading ? (
        <div className={headClass}>
          <div>
            <h2>{t("uploadSectionPolicy")}</h2>
            <p>{headingHint ?? t("uploadSectionPolicyHint")}</p>
            {headingExtra}
          </div>
        </div>
      ) : null}

      {!isGlobal ? (
        <div className="policy-mode-card is-selected">
          <div className="policy-mode-card__body">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong>{t("policyGlobalCard")}</strong>
                <small>{t("policyGlobalCardHint")}</small>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Switch
                  size="sm"
                  checked={inheritGlobal}
                  disabled={disabled}
                  aria-label={t("policyInheritGlobal")}
                  onCheckedChange={(next) => onInheritGlobalChange?.(next)}
                />
                <span className="text-caption text-ink-muted">{t("policyInheritGlobal")}</span>
              </div>
            </div>
            <p className="mt-2 text-caption text-ink-muted">{t("policyInheritGlobalHint")}</p>
            <div
              className={cn(
                "policy-preview mt-2",
                globalMode === "ALL_FREE" ? "is-free" : "is-partial",
              )}
            >
              <span className="policy-preview__dot" aria-hidden />
              <p>
                {globalMode === "ALL_FREE"
                  ? t("settingsPolicyPreviewAllFree")
                  : globalMode === "VIP_ALL"
                    ? t("settingsPolicyPreviewVipAll")
                    : t("settingsPolicyPreviewFreeFirstN", { n: globalFreeCount })}
                {globalMode !== "ALL_FREE" && globalPreviewSeconds > 0
                  ? t("settingsPolicyPreviewTrialSuffix", { seconds: globalPreviewSeconds })
                  : null}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {customEditable ? (
        <>
          <div className="policy-mode-grid" aria-label={t("uploadSectionPolicy")}>
            <div className="policy-mode-card">
              <div className="policy-mode-card__body">
                <strong>{t("policyAllFree")}</strong>
                <small>{t("policyModeHint")}</small>
                <label className="policy-preview-toggle mt-2">
                  <input
                    type="checkbox"
                    checked={allFree}
                    disabled={disabled}
                    onChange={(e) => onAllFreeChange(e.target.checked)}
                  />
                  <span>{t("lockModeAllFree")}</span>
                </label>
                <p className="text-caption text-ink-muted">{t("policyAllFreeForeverHint")}</p>
                <div className="policy-range-grid">
                  <label className="upload-field">
                    <span>{t("policyRangeStart")}</span>
                    <Input
                      type="number"
                      min={1}
                      max={1}
                      value="1"
                      disabled
                      readOnly
                      tabIndex={-1}
                      title={t("policyRangeStartFixedTitle")}
                      aria-label={t("policyRangeStartFixedTitle")}
                      className="cursor-not-allowed opacity-60"
                    />
                  </label>
                  <label className="upload-field">
                    <span>{t("policyRangeEnd")}</span>
                    <Input
                      type="number"
                      min={0}
                      max={!isGlobal && episodeTotal ? episodeTotal : undefined}
                      value={freeRangeEnd}
                      disabled={rangeDisabled}
                      onChange={(e) => onFreeRangeEndChange(e.target.value)}
                    />
                  </label>
                </div>
                <p className="text-caption text-ink-muted mt-1">{t("policyFreeFirstNRangeHint")}</p>
              </div>
            </div>
            <div className="policy-mode-card">
              <div className="policy-mode-card__body">
                <strong>{t("policyPartialFree")}</strong>
                <small>{t("policyMemberHint")}</small>
                {pricingFields}
                <div className="policy-preview-options">
                  <div
                    className="policy-preview-choices"
                    role="radiogroup"
                    aria-label={t("policyAllowPreview")}
                  >
                    <label className="policy-preview-toggle">
                      <input
                        type="radio"
                        name={previewRadioName}
                        checked={!allowPreview}
                        disabled={disabled || allFree}
                        onChange={() => onAllowPreviewChange(false)}
                      />
                      <span>{t("policyPreviewDisabled")}</span>
                    </label>
                    <label className="policy-preview-toggle">
                      <input
                        type="radio"
                        name={previewRadioName}
                        checked={allowPreview}
                        disabled={disabled || allFree}
                        onChange={() => onAllowPreviewChange(true)}
                      />
                      <span>{t("policyAllowPreview")}</span>
                    </label>
                  </div>
                  {allowPreview && !allFree ? (
                    <label className="upload-field">
                      <span>{t("policyPreviewSeconds")}</span>
                      <Input
                        type="number"
                        min={1}
                        value={previewSeconds}
                        disabled={disabled}
                        onChange={(e) =>
                          onPreviewSecondsChange(Math.max(1, Number(e.target.value) || 10))
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          {previewText != null ? (
            <div
              className={cn(
                "policy-preview",
                (previewIsFree ?? previewIsAllFree) ? "is-free" : "is-partial",
              )}
            >
              <span className="policy-preview__dot" aria-hidden />
              <p>{previewText}</p>
            </div>
          ) : !isGlobal && episodeTotal > 0 ? (
            <div className={cn("policy-preview", previewIsAllFree ? "is-free" : "is-partial")}>
              <span className="policy-preview__dot" aria-hidden />
              <p>
                {allFree
                  ? t("policyPreviewAllFreeForever", { total: episodeTotal })
                  : previewIsAllFree
                    ? t("policyPreviewAllFree", { total: episodeTotal })
                    : t("policyPreviewPartial", {
                        total: episodeTotal,
                        free: previewFreeCount,
                        price: priceCredits,
                      })}
              </p>
            </div>
          ) : null}
        </>
      ) : !isGlobal ? (
        <>
          <div className="policy-mode-card">
            <div className="policy-mode-card__body">
              <strong>{t("policyPartialFree")}</strong>
              <small>{t("buyoutDiscountInheritHint")}</small>
              {pricingFields}
            </div>
          </div>
          {episodeTotal > 0 ? (
            <div className={cn("policy-preview", previewIsAllFree ? "is-free" : "is-partial")}>
              <span className="policy-preview__dot" aria-hidden />
              <p>
                {previewIsAllFree
                  ? globalMode === "ALL_FREE"
                    ? t("policyPreviewAllFreeForever", { total: episodeTotal })
                    : t("policyPreviewAllFree", { total: episodeTotal })
                  : t("policyPreviewPartial", {
                      total: episodeTotal,
                      free: previewFreeCount,
                      price: previewCredits,
                    })}
              </p>
            </div>
          ) : null}
        </>
      ) : episodeTotal > 0 ? (
        <div className={cn("policy-preview", previewIsAllFree ? "is-free" : "is-partial")}>
          <span className="policy-preview__dot" aria-hidden />
          <p>
            {previewIsAllFree
              ? globalMode === "ALL_FREE"
                ? t("policyPreviewAllFreeForever", { total: episodeTotal })
                : t("policyPreviewAllFree", { total: episodeTotal })
              : t("policyPreviewPartial", {
                  total: episodeTotal,
                  free: previewFreeCount,
                  price: previewCredits,
                })}
          </p>
        </div>
      ) : null}

      {showSaveButton ? (
        <div className="flex justify-end border-t border-line pt-4">
          <Button size="sm" disabled={disabled || savePending} onClick={() => onSave?.()}>
            <Save className="h-4 w-4" />
            {t("saveLockPolicy")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
