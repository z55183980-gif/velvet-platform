"use client";

import { useEffect, useState } from "react";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
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
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // A newly selected drama always starts with a clean edit session. Keeping
  // this reset on disk also prevents the previous drama's close guard from
  // leaking into the next modal opened through URL navigation.
  useEffect(() => {
    setDirty(false);
    setConfirmClose(false);
  }, [dramaId]);

  useEffect(() => {
    if (!open) setConfirmClose(false);
  }, [open]);

  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  return (
    <>
      <GlassModal
        open={open && !!dramaId}
        onClose={requestClose}
        title={t("dramaEditor")}
        size="2xl"
        className="content-detail-modal"
      >
        {dramaId ? (
          <ContentDetailPanel id={dramaId} onDeleted={onClose} onDirtyChange={setDirty} />
        ) : null}
      </GlassModal>
      <ConfirmModal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          setDirty(false);
          onClose();
        }}
        message={t("confirmDiscardChanges")}
        confirmVariant="danger"
      />
    </>
  );
}
