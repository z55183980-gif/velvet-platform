/**
 * Drama.tags stores both ops provenance and user-facing labels in one TEXT[].
 * Public APIs must strip system meta so consumers only see genre-like tags.
 */

const SYSTEM_TAG_PREFIXES = [
  'type:',
  'completion:',
  'status:',
  'source:',
  'orientation:',
  'visibility:',
  'workflow:',
  'ytdlp',
] as const;
const PROVENANCE_TAGS = new Set([
  'upload',
  'r2',
  'transfer',
  'ytdlp',
  'local',
  'placeholder',
  'public',
  'vertical',
  'horizontal',
  'manual',
  'smoke',
  'online',
  'demo',
]);

/** Maximum number of member-facing labels stored/exposed for one drama. */
export const MAX_PUBLIC_DRAMA_TAGS = 6;

/** Internal / provenance markers that must not appear on the public web. */
export function isDramaSystemTag(tag: string): boolean {
  const t = String(tag || '').trim().toLowerCase();
  if (!t) return true;
  if (PROVENANCE_TAGS.has(t)) return true;
  return SYSTEM_TAG_PREFIXES.some((prefix) => t.startsWith(prefix));
}

/** Tags safe to expose on public drama list/detail/feed. */
export function toPublicDramaTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t =
      raw && typeof raw === 'object' && 'key' in (raw as object)
        ? String((raw as { key?: unknown }).key ?? '').trim()
        : String(raw ?? '').trim();
    const key = t.toLowerCase();
    if (!t || isDramaSystemTag(t) || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_PUBLIC_DRAMA_TAGS) break;
  }
  return out;
}

export type PublicDramaTag = {
  key: string;
  nameEn: string;
  nameZh: string | null;
  nameFr: string | null;
};

export function toPublicDramaTagObjects(
  keys: string[],
  labels: Map<string, { nameEn: string; nameZh: string | null; nameFr: string | null }>,
): PublicDramaTag[] {
  return keys.map((key) => {
    const l = labels.get(key) || labels.get(key.toLowerCase());
    return {
      key,
      nameEn: (l?.nameEn || key).trim() || key,
      nameZh: l?.nameZh?.trim() || null,
      nameFr: l?.nameFr?.trim() || null,
    };
  });
}

/** Escape `%` / `_` / `\` for use inside `ILIKE … ESCAPE '\'` patterns. */
export function escapeIlikePattern(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Merge admin-authored sourceTags (display + type:/completion:) with
 * existing provenance markers (upload/r2/ytdlp/…).
 */
export function mergeDramaSourceTags(
  existing: string[] | null | undefined,
  sourceTags: string[] | null | undefined,
): string[] {
  const prev = Array.isArray(existing) ? existing.map(String) : [];
  const provenance = prev.filter((t) => {
    const s = t.trim();
    return PROVENANCE_TAGS.has(s) || s.startsWith('ytdlp');
  });
  const next = Array.isArray(sourceTags)
    ? sourceTags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  let displayCount = 0;
  for (const t of [...provenance, ...next]) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    const system = isDramaSystemTag(t);
    if (!system && displayCount >= MAX_PUBLIC_DRAMA_TAGS) continue;
    seen.add(key);
    out.push(t);
    if (!system) displayCount += 1;
  }
  return out;
}
