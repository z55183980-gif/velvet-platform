"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "error" | "success" | "info";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastApi = {
  push: (message: string, kind?: ToastKind) => void;
  error: (message: string) => void;
  success: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const text = String(message || "").trim();
      if (!text) return;
      const id = ++seq;
      setItems((prev) => [...prev.slice(-4), { id, kind, message: text }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      error: (m) => push(m, "error"),
      success: (m) => push(m, "success"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {items.map((t) => (
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
