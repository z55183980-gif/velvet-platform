"use client";

import { AdminShell } from "@/components/admin-shell";
import { DramaTagsPanel } from "@/components/drama-tags-panel";
import { useI18n } from "@/lib/i18n";

export default function AdminDramaTagsPage() {
  const { t } = useI18n();

  return (
    <AdminShell title={t("dramaTagsPage")}>
      <DramaTagsPanel />
    </AdminShell>
  );
}
