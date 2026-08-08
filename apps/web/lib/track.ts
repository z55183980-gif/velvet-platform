/** 关键行为埋点（本地缓冲 + 可选上报 POST /api/v1/events） */
export type TrackProps = Record<string, string | number | boolean | null | undefined>;

type TrackEvent = { event: string; props?: TrackProps; t: number };

declare global {
  interface Window {
    __dv_events?: TrackEvent[];
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const PENDING: TrackEvent[] = [];

function scheduleFlush() {
  if (typeof window === "undefined") return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEvents();
  }, 1500);
}

async function flushEvents() {
  if (typeof window === "undefined" || PENDING.length === 0) return;
  const batch = PENDING.splice(0, 40);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = localStorage.getItem("dv_token");
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch("/api/v1/events", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        events: batch.map((e) => ({ event: e.event, props: e.props || {} })),
      }),
    });
  } catch {
    // 失败回灌缓冲（最多保留）
    PENDING.unshift(...batch.slice(0, 20));
  }
}

export function track(event: string, props?: TrackProps) {
  if (typeof window === "undefined") return;
  const entry: TrackEvent = { event, props, t: Date.now() };
  window.__dv_events = window.__dv_events || [];
  window.__dv_events.push(entry);
  if (window.__dv_events.length > 200) window.__dv_events.shift();
  PENDING.push(entry);
  if (PENDING.length > 80) PENDING.splice(0, PENDING.length - 80);
  if (process.env.NODE_ENV === "development") {
    console.debug("[track]", event, props || {});
  }
  scheduleFlush();
}
