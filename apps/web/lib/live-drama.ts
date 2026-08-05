import { resolveApiProxyTarget } from "./api-proxy-target.mjs";

export type LiveDramaPresence = "exists" | "missing" | "unavailable";

/** Set by middleware after probing; pages skip a second upstream fetch when present. */
export const LIVE_DRAMA_CHECKED_HEADER = "x-velvet-drama-checked";

/** Bound hung TCP on middleware / SSR drama probes (fail-open via catch → unavailable). */
const LIVE_DRAMA_PROBE_TIMEOUT_MS = 3_000;

/**
 * Server-only: ask LIVE API whether a public drama slug/id is available.
 * Distinguishes confirmed absence from transient / ops failures.
 */
export async function checkLiveDrama(id: string): Promise<LiveDramaPresence> {
  const base = resolveApiProxyTarget();
  try {
    const res = await fetch(`${base}/api/v1/dramas/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(LIVE_DRAMA_PROBE_TIMEOUT_MS),
    });
    if (res.status === 404) return "missing";
    if (!res.ok) return "unavailable";
    const json = (await res.json().catch(() => null)) as {
      code?: number;
      data?: unknown;
    } | null;
    if (!json || json.code !== 0 || !json.data) return "missing";
    return "exists";
  } catch {
    // Network / DNS / timeout / connection failure — not a confirmed missing drama.
    return "unavailable";
  }
}

/** True unless API confirmed the drama is missing. Fail-open on API blips. */
export async function liveDramaExists(id: string): Promise<boolean> {
  return (await checkLiveDrama(id)) !== "missing";
}

/** True only when API confirmed missing / not LIVE. Fail-open on API blips. */
export async function isMissingLiveDrama(id: string): Promise<boolean> {
  return (await checkLiveDrama(id)) === "missing";
}
