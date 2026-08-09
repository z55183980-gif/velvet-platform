"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "error" | "success" | "info" | "tip";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastApi = {
  push: (message: string, kind?: ToastKind, durationMs?: number) => void;
  error: (message: string) => void;
  success: (message: string) => void;
  /** Lightweight centered tip (default 2s). */
  tip: (message: string, durationMs?: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = "info", durationMs?: number) => {
      const text = String(message || "").trim();
      if (!text) return;
      const id = ++seq;
      setItems((prev) => {
        const next = kind === "tip" ? prev.filter((t) => t.kind !== "tip") : prev;
        return [...next.slice(-4), { id, kind, message: text }];
      });
      const ms =
        durationMs ??
        (kind === "error" ? 6000 : kind === "tip" ? 2000 : 3500);
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      error: (m) => push(m, "error"),
      success: (m) => push(m, "success"),
      tip: (m, durationMs) => push(m, "tip", durationMs ?? 2000),
    }),
    [push],
  );

  const tips = items.filter((t) => t.kind === "tip");
  const banners = items.filter((t) => t.kind !== "tip");

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {banners.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-body-sm shadow-3 ${
              t.kind === "error"
                ? "border-danger/40 bg-surface text-danger"
                : t.kind === "success"
                  ? "border-success/40 bg-surface text-success"
                  : "border-line bg-surface text-ink"
            }`}
            role={t.kind === "error" ? "alert" : "status"}
          >
            {t.message}
          </div>
        ))}
      </div>
      {tips.length > 0 ? (
        <div
          className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center px-6"
          aria-live="polite"
        >
          {tips.map((t) => (
            <div
              key={t.id}
              className="rounded-full bg-black/75 px-4 py-2.5 text-[13px] font-medium text-white shadow-lg"
              role="status"
            >
              {t.message}
            </div>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {},
      error: () => {},
      success: () => {},
      tip: () => {},
    };
  }
  return ctx;
}

/** Normalize Nest / ApiError payloads into a user-facing string */
export function formatApiError(err: unknown, fallback = "Request failed"): string {
  if (!err) return fallback;
  if (typeof err === "string") return err || fallback;
  const any = err as { message?: unknown; status?: number };
  const msg = any.message;
  if (typeof msg === "string" && msg.trim()) return msg;
  if (Array.isArray(msg)) {
    const parts = msg
      .map((m) => {
        if (typeof m === "string") return m;
        if (m && typeof m === "object" && "constraints" in m) {
          return Object.values((m as { constraints: Record<string, string> }).constraints).join(", ");
        }
        return JSON.stringify(m);
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}
