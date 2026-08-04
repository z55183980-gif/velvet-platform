"use client";

import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ContentImportPanel } from "@/components/content-import-panel";
import { useI18n } from "@/lib/i18n";

export default function AdminContentImportPage() {
  const { t } = useI18n();

  return (
    <AdminShell title={t("contentImport")}>
      <Link href="/content" className="mb-4 inline-block text-body-sm text-ink-muted hover:text-ink">
        ← {t("backToList")}
      </Link>
      <ContentImportPanel />
    </AdminShell>
  );
}
