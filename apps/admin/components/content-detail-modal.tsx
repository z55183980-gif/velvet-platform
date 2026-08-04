"use client";

import { GlassModal } from "@/components/glass-modal";
import { ContentDetailPanel } from "@/components/content-detail-panel";
import { useI18n } from "@/lib/i18n";

export function ContentDetailModal({
  open,
  dramaId,
  onClose,
}: {
  open: boolean;
  dramaId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <GlassModal
      open={open && !!dramaId}
      onClose={onClose}
      title={t("dramaDetail")}
      size="xl"
    >
      {dramaId ? <ContentDetailPanel id={dramaId} onDeleted={onClose} /> : null}
    </GlassModal>
  );
}
