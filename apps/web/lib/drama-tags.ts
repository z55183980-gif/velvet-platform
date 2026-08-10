/** Strip internal Drama.tags markers before showing on the consumer web. */

/** Theater filter + Drama.tags `type:` values (admin content form). */
export type DramaContentTypeSlug = "comic" | "live" | "ai";

export const DRAMA_CONTENT_TYPES: Array<{
  slug: DramaContentTypeSlug;
  /** Exact tag stored on Drama.tags */
  tag: string;
}> = [
  { slug: "comic", tag: "type:漫剧" },
  { slug: "live", tag: "type:真人短剧" },
  { slug: "ai", tag: "type:AI短剧" },
];

export function resolveContentTypeSlug(raw: string | null | undefined): DramaContentTypeSlug | "" {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "comic" || v === "manga" || v === "漫剧") return "comic";
  if (v === "live" || v === "live-action" || v === "真人" || v === "真人短剧") return "live";
  if (v === "ai" || v === "ai剧" || v === "ai短剧") return "ai";
  return "";
}

export function contentTypeTag(slug: DramaContentTypeSlug | ""): string | undefined {
  if (!slug) return undefined;
  return DRAMA_CONTENT_TYPES.find((c) => c.slug === slug)?.tag;
}

/** Compose API `tag` query (comma = AND / hasEvery) from content form + display tag. */
export function composeDramaTagFilter(
  contentType: DramaContentTypeSlug | "",
  displayTag?: string | null,
): string | undefined {
  const parts = [contentTypeTag(contentType), String(displayTag || "").trim()].filter(Boolean);
  return parts.length ? parts.join(",") : undefined;
}

const SYSTEM_TAG_PREFIXES = [
  "type:",
  "completion:",
  "status:",
  "source:",
  "orientation:",
  "visibility:",
  "workflow:",
  "ytdlp",
] as const;
const SYSTEM_TAG_EXACT = new Set([
  "upload",
  "r2",
  "transfer",
  "ytdlp",
  "local",
  "placeholder",
  "public",
  "vertical",
  "horizontal",
  "manual",
  "smoke",
  "online",
  "demo",
]);

export function isDramaSystemTag(tag: string): boolean {
  const t = String(tag || "").trim().toLowerCase();
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
    const key = t.toLowerCase();
    if (!t || isDramaSystemTag(t) || seen.has(key)) continue;
    seen.add(key);
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
