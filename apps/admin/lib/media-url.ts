/**
 * Normalize storage / cover paths for admin `<img>` tags.
 * - Absolute media URLs → same-origin `/api/v1/media/…` (Next rewrite → API)
 * - Bare relative keys → `/api/v1/media/…`
 * - CDN cover URLs without ?sig= → local media path (CDN requires signatures)
 * - Other http(s) (YouTube thumbs etc.) kept as-is
 */
export function mediaUrl(path?: string | null): string | null {
  if (path == null) return null;
  const raw = String(path).trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const mediaIdx = u.pathname.indexOf("/api/v1/media/");
      if (mediaIdx >= 0) {
        return `${u.pathname.slice(mediaIdx)}${u.search}`;
      }
      const host = u.hostname.toLowerCase();
      const isVelvetCdn =
        host === "cdn.velvetmovie.space" || host.endsWith(".r2.dev");
      if (isVelvetCdn) {
        const rel = u.pathname.replace(/^\/+/, "");
        if (rel.startsWith("covers/") || rel.includes("/covers/")) {
          const key = rel.includes("/covers/") ? rel.slice(rel.indexOf("covers/")) : rel;
          return `/api/v1/media/${key}`;
        }
      }
    } catch {
      /* keep raw */
    }
    return raw;
  }

  if (raw.startsWith("/")) return raw;
  return `/api/v1/media/${raw.replace(/^\/+/, "")}`;
}

/** Initials for cover placeholder (1–2 graphemes). */
export function coverInitials(title?: string | null): string {
  const s = String(title || "").trim();
  if (!s) return "—";
  const chars = Array.from(s.replace(/\s+/g, ""));
  if (chars.length === 0) return "—";
  if (/^[\u4e00-\u9fff]/.test(chars[0])) return chars.slice(0, 1).join("");
  return chars.slice(0, 2).join("").toUpperCase();
}
