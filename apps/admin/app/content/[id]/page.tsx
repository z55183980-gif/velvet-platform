"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ContentDetailPanel } from "@/components/content-detail-panel";
import { useI18n } from "@/lib/i18n";

export default function AdminContentDetailPage() {
  const { t } = useI18n();
  const id = String(useParams().id);

  return (
    <AdminShell title={t("dramaDetail")}>
      <Link href="/content" className="mb-4 inline-block text-body-sm text-ink-muted hover:text-ink">
        ← {t("backToList")}
      </Link>
      <ContentDetailPanel id={id} />
    </AdminShell>
  );
}
