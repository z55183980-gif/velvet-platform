"use client";

import type { ReactNode } from "react";
import { ConfirmDialog, Modal, cn, type ModalSize } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";

type GlassModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: ModalSize;
  hideClose?: boolean;
  className?: string;
};

export function GlassModal({
  open,
  onClose,
  title,
  children,
  size = "md",
  hideClose = false,
  className,
}: GlassModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      hideClose={hideClose}
      closeLabel={t("close")}
      className={cn("glass-modal", className)}
    >
      {children}
    </Modal>
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  message,
  confirmVariant = "danger",
  busy,
  extraAction,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
  extraAction?: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean };
}) {
  const { t } = useI18n();

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t("confirm")}
      message={message}
      cancelLabel={t("cancel")}
      confirmLabel={t("confirm")}
      confirmVariant={confirmVariant}
      busy={busy}
      closeLabel={t("close")}
      className="glass-modal"
      extraAction={extraAction}
    />
  );
}
