"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { useLocale } from "@/lib/i18n";
import { pickContentText } from "@/lib/languages";
import { API_BASE, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NotifItem {
  id: string;
  type: string;
  titleEn: string | null;
  titleZh: string | null;
  bodyEn: string | null;
  bodyZh: string | null;
  readAt: string | null;
  createdAt: string;
}

async function fetchNotifs<T>(path: string, init?: RequestInit): Promise<T> {
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

export function NotificationBell({
  tone = "default",
}: {
  tone?: "default" | "onDark";
}) {
  const { user } = useAuth();
  const { locale, t } = useLocale();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const onDark = tone === "onDark";

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      const d = await fetchNotifs<{ unread: number; rows: NotifItem[] }>("?pageSize=8");
      setUnread(d.unread);
      setItems(d.rows);
    } catch {
      /* silent */
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      setItems([]);
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startPolling = () => {
      stopPolling();
      intervalId = setInterval(reload, 25_000);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopPolling();
        return;
      }
      void reload();
      startPolling();
    };

    if (document.visibilityState !== "hidden") {
      void reload();
      startPolling();
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, reload]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      bellRef.current?.focus();
    }
    if (open) {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function markRead(id: string) {
    try {
      await fetchNotifs(`/${id}/read`, { method: "POST", body: "{}" });
      setItems((arr) =>
        arr.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      /* silent */
    }
  }

  if (!user) return null;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={bellRef}
        type="button"
        aria-label={t("notifications.title")}
        aria-expanded={open}
        aria-controls="notification-popover"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative grid h-11 w-11 place-items-center rounded-full transition-colors",
          onDark
            ? "text-white/70 hover:bg-white/10 hover:text-white"
            : "text-ink-muted hover:bg-surface-2 hover:text-ink",
        )}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id="notification-popover"
          className="absolute right-0 mt-2 w-[320px] max-h-[420px] overflow-auto rounded-xl border border-line bg-base shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="text-body-sm font-semibold text-ink">
              {t("notifications.title")}
            </h3>
            <Link
              href="/notifications"
              className="text-caption text-brand hover:underline"
              onClick={() => setOpen(false)}
            >
              {t("notifications.viewAll")}
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-caption text-ink-subtle">
              {t("notifications.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n) => {
                const title = pickContentText(
                  locale,
                  n.titleEn || "",
                  n.titleZh || "",
                );
                const body = pickContentText(
                  locale,
                  n.bodyEn || "",
                  n.bodyZh || "",
                );
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="min-h-11 w-full px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                      onClick={() => !n.readAt && markRead(n.id)}
                    >
                      <div className="flex items-start gap-2">
                      {!n.readAt && (
                        <>
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
                          <span className="sr-only">{t("notifications.unread")}</span>
                        </>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-body-sm font-medium text-ink">{title}</p>
                        {body && <p className="mt-0.5 text-caption text-ink-muted">{body}</p>}
                        <p className="mt-1 text-[11px] text-ink-subtle">
                          {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
