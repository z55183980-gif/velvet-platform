"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CircleCheck, CircleHelp, LoaderCircle, X } from "lucide-react";
import { Button } from "./components";
import { cn } from "./cn";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: ModalSize;
  hideClose?: boolean;
  closeLabel?: string;
  className?: string;
  /** Stacking order; nested modals should use a higher value (default 80). */
  zIndex?: number;
};

const sizeWidth: Record<ModalSize, string> = {
  sm: "26rem",
  md: "32rem",
  lg: "48rem",
  xl: "64rem",
  "2xl": "76rem",
};

/** Open Modal instance ids (push order); only the topmost handles Escape. */
const openModalStack: number[] = [];
let modalInstanceSeq = 0;

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  hideClose = false,
  closeLabel = "Close",
  className,
  zIndex = 80,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const id = ++modalInstanceSeq;
    openModalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openModalStack[openModalStack.length - 1] !== id) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      const idx = openModalStack.lastIndexOf(id);
      if (idx >= 0) openModalStack.splice(idx, 1);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-4"
      style={{ zIndex }}
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          // min-h-0 lets max-height win over flex min-content sizing so long
          // forms scroll inside the panel instead of overflowing the viewport.
          "relative flex min-h-0 max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl",
          className,
        )}
        style={{
          width: "calc(100% - 1.5rem)",
          maxWidth: sizeWidth[size],
          // Inline maxHeight so viewport fit does not depend on Tailwind
          // scanning this package (node_modules sources are skipped by default).
          maxHeight: "min(92dvh, calc(100dvh - 2rem))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title || !hideClose ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
            {title ? (
              <div className="min-w-0 flex-1 text-h4 font-semibold text-ink [&_.seg-tabs]:text-body [&_.seg-tabs]:font-normal">
                {title}
              </div>
            ) : (
              <span />
            )}
            {!hideClose ? (
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 cursor-pointer rounded-lg p-1 text-ink-muted transition-[background-color,color,transform] duration-150 hover:rotate-90 hover:bg-surface-2 hover:text-ink active:scale-90"
                aria-label={closeLabel}
              >
                <X className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  confirmVariant = "danger",
  busy,
  closeLabel,
  className,
  extraAction,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger" | "success";
  busy?: boolean;
  closeLabel?: string;
  className?: string;
  /** Optional third action rendered between cancel and confirm (e.g. "Save & close"). */
  extraAction?: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean };
}) {
  const destructive = confirmVariant === "danger";
  const affirmative = confirmVariant === "success";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              destructive
                ? "bg-danger-soft text-danger"
                : affirmative
                  ? "bg-success-soft text-success"
                  : "bg-brand-soft text-brand",
            )}
          >
            {destructive ? (
              <AlertTriangle className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden="true" />
            ) : affirmative ? (
              <CircleCheck className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <CircleHelp className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden="true" />
            )}
          </span>
          <span className="text-lg font-bold tracking-tight text-ink">{title}</span>
        </div>
      }
      size="sm"
      zIndex={90}
      closeLabel={closeLabel}
      className={cn(
        "!border-white/90 !bg-white/95 !shadow-[0_24px_70px_rgba(15,23,42,0.24)]",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-2xl border px-4 py-3.5",
          destructive
            ? "border-danger/15 bg-danger-soft/60"
            : affirmative
              ? "border-success/15 bg-success-soft/60"
              : "border-line bg-surface-2/70",
        )}
      >
        <p className="text-body-sm leading-6 text-ink-muted">{message}</p>
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          size="md"
          variant="secondary"
          className="min-w-24 cursor-pointer border-line bg-white hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-2 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed"
          disabled={busy}
          onClick={onClose}
        >
          {cancelLabel}
        </Button>
        {extraAction ? (
          <Button
            size="md"
            variant="primary"
            className="min-w-24 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed"
            disabled={busy || extraAction.disabled}
            onClick={extraAction.onClick}
          >
            {extraAction.busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {extraAction.label}
          </Button>
        ) : null}
        <Button
          size="md"
          variant={confirmVariant}
          className={cn(
            "min-w-24 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed",
            destructive &&
              "border-transparent bg-danger text-white shadow-[0_6px_16px_rgba(190,18,60,0.22)] hover:bg-danger hover:brightness-95",
          )}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
