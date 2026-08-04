"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-context";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { API_BASE, ApiError } from "@/lib/api";

interface NotifItem {
  id: string;
  type: string;
  titleEn: string | null;
  titleZh: string | null;
  bodyEn: string | null;
  bodyZh: string | null;
  payload: any;
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

export default function NotificationsPage() {
  const { user, ready, openLogin } = useAuth();
  const { locale, t } = useLocale();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const pageSize = 20;

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      const d = await notifApi<{ rows: NotifItem[]; total: number }>(`?page=${page}&pageSize=${pageSize}`);
      setItems(d.rows);
      setTotal(d.total);
    } catch (e: any) {
      setErr(e?.message || "error");
    }
  }, [user, page]);

  useEffect(() => {
    if (ready && user) reload();
  }, [ready, user, reload]);

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

  if (!ready) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-24 text-center text-ink-subtle">
        {t("common.loading")}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-24 text-center md:px-6">
        <h1 className="text-h2 font-bold text-ink">{t("notifications.title")}</h1>
        <p className="mt-3 text-ink-muted">{t("notifications.loginHint")}</p>
        <button
          className={buttonVariants({ variant: "primary", size: "lg" }) + " mt-6"}
          onClick={() => openLogin()}
        >
          {t("nav.login")}
        </button>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-[800px] px-4 py-10 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-ink">{t("notifications.title")}</h1>
          <p className="mt-1 text-body-sm text-ink-muted">
            {t("notifications.total", { n: total })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={markAllRead}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("notifications.markAllRead")}
          </button>
          <Link href="/me" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("notifications.back")}
          </Link>
        </div>
      </div>

      {err && (
        <p className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-caption text-red-400">
          {err}
        </p>
      )}

      <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface-2">
        {items.length === 0 && (
          <li className="px-4 py-12 text-center text-body-sm text-ink-subtle">
            {t("notifications.empty")}
          </li>
        )}
        {items.map((n) => {
          const title =
            locale === "en" ? n.titleEn || n.titleZh : n.titleZh || n.titleEn;
          const body =
            locale === "en" ? n.bodyEn || n.bodyZh : n.bodyZh || n.bodyEn;
          return (
            <li
              key={n.id}
              className={`px-4 py-4 ${!n.readAt ? "bg-surface" : ""}`}
            >
              <div className="flex items-start gap-3">
                {!n.readAt && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body font-medium text-ink">{title}</p>
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-ink-subtle">
                      {n.type}
                    </span>
                  </div>
                  {body && <p className="mt-1 text-body-sm text-ink-muted">{body}</p>}
                  <p className="mt-2 text-[11px] text-ink-subtle">
                    {new Date(n.createdAt).toLocaleString(locale)}
                  </p>
                </div>
                {!n.readAt && (
                  <button
                    onClick={() => markRead(n.id)}
                    className="text-caption text-brand hover:underline"
                  >
                    {t("notifications.markRead")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between text-caption text-ink-muted">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-line px-3 py-2 hover:bg-surface-2 disabled:opacity-50"
          >
            ← {t("notifications.prev")}
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-md border border-line px-3 py-2 hover:bg-surface-2 disabled:opacity-50"
          >
            {t("notifications.next")} →
          </button>
        </div>
      )}
    </div>
  );
}