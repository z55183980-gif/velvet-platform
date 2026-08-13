/** Strip internal Drama.tags markers before showing on the consumer web. */

import { pickTitleText, type Locale } from "./languages";

/** Theater filter + Drama.tags `type:` values (admin content form). */
export type DramaContentTypeSlug = "comic" | "live" | "ai";

export type DramaTagLabel = {
  key: string;
  nameEn: string;
  nameZh?: string | null;
  nameFr?: string | null;
};

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
  "tg:",
  "seg:",
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
  "telegram",
  "episode-list",
]);

export function isDramaSystemTag(tag: string): boolean {
  const t = String(tag || "").trim().toLowerCase();
  if (!t) return true;
  if (SYSTEM_TAG_EXACT.has(t)) return true;
  return SYSTEM_TAG_PREFIXES.some((p) => t.startsWith(p));
}

export function normalizeDramaTag(raw: unknown): DramaTagLabel | null {
  if (typeof raw === "string") {
    const key = raw.trim();
    if (!key || isDramaSystemTag(key)) return null;
    return { key, nameEn: key, nameZh: null, nameFr: null };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = String(o.key ?? o.tag ?? o.nameEn ?? "").trim();
  if (!key || isDramaSystemTag(key)) return null;
  return {
    key,
    nameEn: String(o.nameEn ?? key).trim() || key,
    nameZh: o.nameZh != null ? String(o.nameZh).trim() || null : null,
    nameFr: o.nameFr != null ? String(o.nameFr).trim() || null : null,
  };
}

/** Normalize API tags (string keys or label objects) into public label objects. */
export function toPublicDramaTagObjects(tags: unknown): DramaTagLabel[] {
  if (!Array.isArray(tags)) return [];
  const out: DramaTagLabel[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeDramaTag(raw);
    if (!tag) continue;
    const id = tag.key.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(tag);
  }
  return out;
}

/** Canonical English keys only (for filters / URLs). */
export function toPublicDramaTags(tags: unknown): string[] {
  return toPublicDramaTagObjects(tags).map((t) => t.key);
}

/** Prefer UI locale field, then English, then others — same as titles. */
export function pickTagText(locale: Locale, tag: DramaTagLabel | string): string {
  if (typeof tag === "string") return tag;
  return pickTitleText(locale, tag.nameEn || tag.key, tag.nameZh || "", tag.nameFr || "");
}

/** Whether any public (non-system) tag contains `q` (case-insensitive substring). */
export function publicTagsMatchQuery(tags: unknown, q: string): boolean {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return false;
  return toPublicDramaTagObjects(tags).some((tag) => {
    return (
      tag.key.toLowerCase().includes(needle) ||
      tag.nameEn.toLowerCase().includes(needle) ||
      (tag.nameZh || "").toLowerCase().includes(needle) ||
      (tag.nameFr || "").toLowerCase().includes(needle)
    );
  });
}
