"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

export default function PrivacyPage() {
  const { t } = useLocale();
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-ink-muted hover:text-white">
        ← Velvet
      </Link>
      <h1 className="mt-6 text-2xl font-semibold text-white">{t("legal.privacyTitle")}</h1>
      <p className="mt-2 text-sm text-ink-subtle">{t("legal.updated")}</p>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-ink-muted">
        <p>{t("legal.privacyIntro")}</p>
        <p>{t("legal.privacyData")}</p>
        <p>{t("legal.privacyUse")}</p>
        <p>{t("legal.privacyThird")}</p>
        <p>{t("legal.privacyContact")}</p>
      </div>
    </main>
  );
}
