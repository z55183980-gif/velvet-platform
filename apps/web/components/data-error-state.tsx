"use client";

import { RefreshCw } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function DataErrorState({
  onRetry,
  compact = false,
  className,
}: {
  onRetry: () => void;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div
      className={cn("flex flex-col items-center justify-center text-center", compact ? "py-8" : "py-20", className)}
      role="alert"
    >
      <p className="text-body font-medium text-ink">{t("errors.loadFailed")}</p>
      <p className="mt-1 text-body-sm text-ink-muted">{t("errors.loadFailedHint")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-body-sm font-semibold text-white hover:brightness-110"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {t("common.retry")}
      </button>
    </div>
  );
}
