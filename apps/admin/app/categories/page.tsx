"use client";

import { AdminShell } from "@/components/admin-shell";
import { CategoriesPanel } from "@/components/categories-panel";
import { useI18n } from "@/lib/i18n";

export default function AdminCategoriesPage() {
  const { t } = useI18n();

  return (
    <AdminShell title={t("categories")}>
      <CategoriesPanel />
    </AdminShell>
  );
}
