"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { ContentDetailPanel, type ContentDetailPanelHandle } from "@/components/content-detail-panel";
import { useI18n } from "@/lib/i18n";

export function ContentDetailModal({
  open,
  dramaId,
  initialTab,
  onClose,
}: {
  open: boolean;
  dramaId: string | null;
  initialTab?: "overview" | "info" | "episodes" | "policy";
  onClose: () => void;
}) {
  const { t } = useI18n();
  const panelRef = useRef<ContentDetailPanelHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [savingClose, setSavingClose] = useState(false);
  const [saveCloseError, setSaveCloseError] = useState<string | null>(null);

  // A newly selected drama always starts with a clean edit session. Keeping
  // this reset on disk also prevents the previous drama's close guard from
  // leaking into the next modal opened through URL navigation.
  useEffect(() => {
    setDirty(false);
    setConfirmClose(false);
    setSavingClose(false);
    setSaveCloseError(null);
  }, [dramaId]);

  useEffect(() => {
    if (!open) setConfirmClose(false);
  }, [open]);

  const requestClose = () => {
    if (dirty) {
      setSaveCloseError(null);
      setConfirmClose(true);
    } else onClose();
  };

  const saveAndClose = async () => {
    setSavingClose(true);
    setSaveCloseError(null);
    const result = await panelRef.current?.save();
    setSavingClose(false);
    if (result?.ok) {
      setConfirmClose(false);
      setDirty(false);
      onClose();
    } else if (result?.error) {
      setSaveCloseError(result.error);
    }
    // Stay on the confirm dialog so the user can retry or fall back to discarding.
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
          <ContentDetailPanel
            ref={panelRef}
            id={dramaId}
            initialTab={initialTab}
            onDeleted={onClose}
            onDirtyChange={setDirty}
          />
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
        message={saveCloseError ? `${t("confirmDiscardChanges")} (${saveCloseError})` : t("confirmDiscardChanges")}
        confirmVariant="danger"
        busy={savingClose}
        extraAction={{ label: t("saveAndClose"), onClick: () => void saveAndClose(), busy: savingClose }}
      />
    </>
  );
}
