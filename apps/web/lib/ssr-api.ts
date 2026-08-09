import { resolveApiProxyTarget } from "./api-proxy-target.mjs";

const SSR_TIMEOUT_MS = 5_000;

type ApiEnvelope<T> = {
  code?: number;
  data?: T;
  message?: unknown;
};

/** Absolute Nest GET for RSC / middleware (relative /api/v1 only works in the browser). */
export async function serverApiGet<T>(path: string, label = "ssr"): Promise<T> {
  const base = resolveApiProxyTarget();
  const res = await fetch(`${base}/api/v1${path}`, {
    headers: { Accept: "application/json", "Accept-Language": "en" },
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(SSR_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.code !== 0 || json.data === undefined) {
    throw new Error(
      `[${label}] ${path} failed (${res.status})${json?.message ? `: ${String(json.message)}` : ""}`,
    );
  }
  return json.data;
}
