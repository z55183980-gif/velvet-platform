"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

export default function TermsPage() {
  const { t } = useLocale();
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-ink-muted hover:text-white">
        ← Velvet
      </Link>
      <h1 className="mt-6 text-2xl font-semibold text-white">{t("legal.termsTitle")}</h1>
      <p className="mt-2 text-sm text-ink-subtle">{t("legal.updated")}</p>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-ink-muted">
        <p>{t("legal.termsIntro")}</p>
        <p>{t("legal.termsAccount")}</p>
        <p>{t("legal.termsContent")}</p>
        <p>{t("legal.termsPayment")}</p>
        <p>{t("legal.termsContact")}</p>
      </div>
    </main>
  );
}
