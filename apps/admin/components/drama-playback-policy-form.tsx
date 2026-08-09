"use client";

import { Button, Input, Switch, cn } from "@velvet/ui";
import { Save } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { GlobalLockMode } from "../lib/drama-playback-policy";
import {
  freeCountWhenInheriting,
  freeEpisodeCountFromCustomPolicy,
} from "../lib/drama-playback-policy";

export type DramaPlaybackPolicyFormProps = {
  inheritGlobal: boolean;
  onInheritGlobalChange: (next: boolean) => void;
  globalMode: GlobalLockMode;
  globalFreeCount: number;
  globalPreviewSeconds: number;
  episodeTotal: number;
  freeRangeStart: string;
  freeRangeEnd: string;
  onFreeRangeStartChange: (value: string) => void;
  onFreeRangeEndChange: (value: string) => void;
  priceCredits: number;
  onPriceCreditsChange: (value: number) => void;
  allowPreview: boolean;
  onAllowPreviewChange: (value: boolean) => void;
  previewSeconds: number;
  onPreviewSecondsChange: (value: number) => void;
  disabled?: boolean;
  /** Unique radio name so create/edit can coexist on the same page. */
  previewRadioName?: string;
  /** Wrapper style: create wizard uses upload-panel; edit may use content-section-card. */
  variant?: "upload-panel" | "content-section";
  /** Optional heading override (defaults to uploadSectionPolicy). */
  showHeading?: boolean;
  headingHint?: string;
  /** Edit flow: show save button at bottom. */
  showSaveButton?: boolean;
  savePending?: boolean;
  onSave?: () => void;
};

export function DramaPlaybackPolicyForm({
  inheritGlobal,
  onInheritGlobalChange,
  globalMode,
  globalFreeCount,
  globalPreviewSeconds,
  episodeTotal,
  freeRangeStart,
  freeRangeEnd,
  onFreeRangeStartChange,
  onFreeRangeEndChange,
  priceCredits,
  onPriceCreditsChange,
  allowPreview,
  onAllowPreviewChange,
  previewSeconds,
  onPreviewSecondsChange,
  disabled = false,
  previewRadioName = "member-preview-policy",
  variant = "upload-panel",
  showHeading = true,
  headingHint,
  showSaveButton = false,
  savePending = false,
  onSave,
}: DramaPlaybackPolicyFormProps) {
  const { t } = useI18n();

  const previewFreeCount = inheritGlobal
    ? freeCountWhenInheriting({
        total: episodeTotal,
        globalMode,
        globalFreeCount,
      })
    : freeEpisodeCountFromCustomPolicy(episodeTotal, freeRangeStart, freeRangeEnd);

  const previewCredits = Math.max(1, priceCredits || 10);
  const previewIsAllFree = episodeTotal > 0 && previewFreeCount >= episodeTotal;

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
          </div>
        </div>
      ) : null}

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
                onCheckedChange={onInheritGlobalChange}
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

      {!inheritGlobal ? (
        <>
          <div className="policy-mode-grid" aria-label={t("uploadSectionPolicy")}>
            <div className="policy-mode-card">
              <div className="policy-mode-card__body">
                <strong>{t("policyAllFree")}</strong>
                <small>{t("policyModeHint")}</small>
                <div className="policy-range-grid">
                  <label className="upload-field">
                    <span>{t("policyRangeStart")}</span>
                    <Input
                      type="number"
                      min={1}
                      max={episodeTotal || undefined}
                      value={freeRangeStart}
                      disabled={disabled || !episodeTotal}
                      onChange={(e) => onFreeRangeStartChange(e.target.value)}
                    />
                  </label>
                  <label className="upload-field">
                    <span>{t("policyRangeEnd")}</span>
                    <Input
                      type="number"
                      min={1}
                      max={episodeTotal || undefined}
                      value={freeRangeEnd}
                      disabled={disabled || !episodeTotal}
                      onChange={(e) => onFreeRangeEndChange(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="policy-mode-card">
              <div className="policy-mode-card__body">
                <strong>{t("policyPartialFree")}</strong>
                <small>{t("policyMemberHint")}</small>
                <label className="upload-field">
                  <span>{t("priceCreditsPerEpisode")}</span>
                  <Input
                    type="number"
                    min={1}
                    value={priceCredits}
                    disabled={disabled}
                    onChange={(e) => onPriceCreditsChange(Number(e.target.value) || 0)}
                  />
                </label>
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
                        disabled={disabled}
                        onChange={() => onAllowPreviewChange(false)}
                      />
                      <span>{t("policyPreviewDisabled")}</span>
                    </label>
                    <label className="policy-preview-toggle">
                      <input
                        type="radio"
                        name={previewRadioName}
                        checked={allowPreview}
                        disabled={disabled}
                        onChange={() => onAllowPreviewChange(true)}
                      />
                      <span>{t("policyAllowPreview")}</span>
                    </label>
                  </div>
                  {allowPreview ? (
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
          {episodeTotal > 0 ? (
            <div className={cn("policy-preview", previewIsAllFree ? "is-free" : "is-partial")}>
              <span className="policy-preview__dot" aria-hidden />
              <p>
                {previewIsAllFree
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
      ) : episodeTotal > 0 ? (
        <div className={cn("policy-preview", previewIsAllFree ? "is-free" : "is-partial")}>
          <span className="policy-preview__dot" aria-hidden />
          <p>
            {previewIsAllFree
              ? t("policyPreviewAllFree", { total: episodeTotal })
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
