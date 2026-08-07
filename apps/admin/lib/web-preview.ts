/**
 * Public web drama preview helpers for admin “前台预览”.
 * Public catalog only serves LIVE titles; non-LIVE routes 404.
 */

const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000").replace(/\/$/, "");

export function isWebPreviewable(status?: string | null): boolean {
  return status === "LIVE";
}

/** Prefer slug (canonical on web); fall back to id. Returns null if neither usable. */
export function webDramaPreviewHref(input: {
  id?: string | number | null;
  slug?: string | null;
  status?: string | null;
}): string | null {
  if (!isWebPreviewable(input.status)) return null;
  const key = (input.slug?.trim() || (input.id != null ? String(input.id).trim() : "")).trim();
  if (!key) return null;
  return `${WEB_URL}/drama/${encodeURIComponent(key)}`;
}
