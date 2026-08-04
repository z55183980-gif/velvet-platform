"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";

type GlassModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  hideClose?: boolean;
};

const sizeClass = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function GlassModal({
  open,
  onClose,
  title,
  children,
  size = "md",
  hideClose = false,
}: GlassModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={`glass-modal relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl ${sizeClass[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title || !hideClose ? (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
            {title ? <div className="min-w-0 text-h4 font-semibold text-ink">{title}</div> : <span />}
            {!hideClose ? (
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg p-1 text-ink-muted transition hover:bg-white/50 hover:text-ink"
                aria-label={t("close")}
              >
                <X className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  message,
  confirmVariant = "danger",
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
}) {
  const { t } = useI18n();

  return (
    <GlassModal open={open} onClose={onClose} title={t("confirm")} size="sm">
      <p className="text-body-sm text-ink-muted">{message}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          variant={confirmVariant}
          disabled={busy}
          onClick={() => {
            onConfirm();
          }}
        >
          {t("confirm")}
        </Button>
      </div>
    </GlassModal>
  );
}
