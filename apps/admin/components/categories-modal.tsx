"use client";

import { GlassModal } from "@/components/glass-modal";
import { CategoriesPanel } from "@/components/categories-panel";
import { useI18n } from "@/lib/i18n";

export function CategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();

  return (
    <GlassModal open={open} onClose={onClose} title={t("categories")} size="lg">
      <CategoriesPanel />
    </GlassModal>
  );
}
