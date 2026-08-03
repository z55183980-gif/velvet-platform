"use client";

import { useLocale } from "@/lib/i18n";

export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1200px] px-4 py-12 md:px-6">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-brand font-bold text-white">
              D
            </span>
            <span className="text-h4 font-semibold tracking-tight">Velvet</span>
          </div>
          <p className="text-body-sm text-ink-muted">{t("footer.tagline")}</p>
        </div>
        <p className="mt-8 text-caption text-ink-subtle">{t("footer.rights")}</p>
      </div>
    </footer>
  );
}
