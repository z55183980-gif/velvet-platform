"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { BrandLogo } from "@/components/brand-logo";

export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1280px] px-4 py-12 md:px-10">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <Link href="/" className="transition-opacity hover:opacity-90" aria-label="Velvet">
            <BrandLogo size={32} />
          </Link>
          <p className="text-body-sm text-ink-muted">{t("footer.tagline")}</p>
        </div>
        <p className="mt-8 text-caption text-ink-subtle">{t("footer.rights")}</p>
      </div>
    </footer>
  );
}
