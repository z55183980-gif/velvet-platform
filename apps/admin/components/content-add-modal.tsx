"use client";

import { GlassModal } from "@/components/glass-modal";
import { ContentAddPanel, type ContentAddTab } from "@/components/content-add-panel";
import { useI18n } from "@/lib/i18n";

export function ContentAddModal({
  open,
  onClose,
  tab,
  onTabChange,
}: {
  open: boolean;
  onClose: () => void;
  tab?: ContentAddTab;
  onTabChange?: (tab: ContentAddTab) => void;
}) {
  const { t } = useI18n();

  return (
    <GlassModal open={open} onClose={onClose} title={t("contentAdd")} size="xl">
      <ContentAddPanel tab={tab} onTabChange={onTabChange} />
    </GlassModal>
  );
}
