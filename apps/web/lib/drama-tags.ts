/** Strip internal Drama.tags markers before showing on the consumer web. */

const SYSTEM_TAG_PREFIXES = ["type:", "completion:", "ytdlp"] as const;
const SYSTEM_TAG_EXACT = new Set(["upload", "r2", "transfer", "ytdlp"]);

export function isDramaSystemTag(tag: string): boolean {
  const t = String(tag || "").trim();
  if (!t) return true;
  if (SYSTEM_TAG_EXACT.has(t)) return true;
  return SYSTEM_TAG_PREFIXES.some((p) => t.startsWith(p));
}

export function toPublicDramaTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = String(raw ?? "").trim();
    if (!t || isDramaSystemTag(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Whether any public (non-system) tag contains `q` (case-insensitive substring). */
export function publicTagsMatchQuery(tags: unknown, q: string): boolean {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return false;
  if (!Array.isArray(tags)) return false;
  return tags.some((raw) => {
    const t = String(raw ?? "").trim();
    if (!t || isDramaSystemTag(t)) return false;
    return t.toLowerCase().includes(needle);
  });
}
