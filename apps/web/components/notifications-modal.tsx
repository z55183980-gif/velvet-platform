"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { API_BASE, ApiError } from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NotifItem {
  id: string;
  type: string;
  titleVi: string | null;
  titleZh: string | null;
  bodyVi: string | null;
  bodyZh: string | null;
  readAt: string | null;
  createdAt: string;
}

async function notifApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("dv_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/notifications${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const json = await res.json();
  if (!res.ok || json.code !== 0) throw new ApiError(res.status, json.message || `HTTP ${res.status}`);
  return json.data as T;
}

export function NotificationsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { locale, t } = useLocale();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pageSize = 20;

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await notifApi<{ rows: NotifItem[]; total: number }>(
        `?page=${page}&pageSize=${pageSize}`,
      );
      setItems(d.rows);
      setTotal(d.total);
    } catch (e: any) {
      setErr(e?.message || "error");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setPage(1);
  }, [open]);

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function markRead(id: string) {
    try {
      await notifApi(`/${id}/read`, { method: "POST", body: "{}" });
      setItems((arr) =>
        arr.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
    } catch {
      /* silent */
    }
  }

  async function markAllRead() {
    try {
      await notifApi(`/read-all`, { method: "POST", body: "{}" });
      await reload();
    } catch {
      /* silent */
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-modal-title"
        className="relative flex max-h-[min(720px,88vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-3"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/15 text-brand">
                <Bell className="h-4 w-4" />
              </span>
              <div>
                <h2 id="notifications-modal-title" className="text-h3 font-bold text-ink">
                  {t("notifications.title")}
                </h2>
                <p className="text-caption text-ink-muted">
                  {t("notifications.total", { n: total })}
                </p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={markAllRead}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              {t("notifications.markAllRead")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {err && (
            <p className="m-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-caption text-red-400">
              {err}
            </p>
          )}
          {loading && items.length === 0 ? (
            <p className="px-5 py-12 text-center text-body-sm text-ink-subtle">
              {t("common.loading")}
            </p>
          ) : items.length === 0 ? (
            <p className="px-5 py-12 text-center text-body-sm text-ink-subtle">
              {t("notifications.empty")}
            </p>
          ) : (
            <ul className={cn("divide-y divide-line", loading && "opacity-60")}>
              {items.map((n) => {
                const title =
                  locale === "vi" ? n.titleVi || n.titleZh : n.titleZh || n.titleVi;
                const body =
                  locale === "vi" ? n.bodyVi || n.bodyZh : n.bodyZh || n.bodyVi;
                return (
                  <li
                    key={n.id}
                    className={cn("px-5 py-4", !n.readAt && "bg-surface-2/40")}
                  >
                    <div className="flex items-start gap-3">
                      {!n.readAt && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-body-sm font-medium text-ink">{title}</p>
                          <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-ink-subtle">
                            {n.type}
                          </span>
                        </div>
                        {body && (
                          <p className="mt-1 text-caption text-ink-muted">{body}</p>
                        )}
                        <p className="mt-2 text-[11px] text-ink-subtle">
                          {new Date(n.createdAt).toLocaleString(locale)}
                        </p>
                      </div>
                      {!n.readAt && (
                        <button
                          type="button"
                          onClick={() => markRead(n.id)}
                          className="shrink-0 text-caption text-brand hover:underline"
                        >
                          {t("notifications.markRead")}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between border-t border-line px-5 py-3 text-caption text-ink-muted">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50"
            >
              ← {t("notifications.prev")}
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50"
            >
              {t("notifications.next")} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
