"use client";

import { GlassModal } from "@/components/glass-modal";
import { ContentImportPanel } from "@/components/content-import-panel";
import { useI18n } from "@/lib/i18n";

export function ContentImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();

  return (
    <GlassModal open={open} onClose={onClose} title={t("contentImport")} size="lg">
      <ContentImportPanel />
    </GlassModal>
  );
}
