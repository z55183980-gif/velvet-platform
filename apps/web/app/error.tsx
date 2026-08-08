"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-overline uppercase tracking-widest text-brand" aria-hidden>!</p>
      <h1 className="mt-3 text-h2 font-bold text-ink">{t("errors.loadFailed")}</h1>
      <p className="mt-3 text-body text-ink-muted">
        {t("errors.loadFailedHint")}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-brand px-6 py-3 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          {t("common.retry")}
        </button>
        <Link
          href="/"
          className="rounded-full border border-line bg-surface px-6 py-3 text-body-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          {t("nav.home")}
        </Link>
      </div>
    </div>
  );
}
