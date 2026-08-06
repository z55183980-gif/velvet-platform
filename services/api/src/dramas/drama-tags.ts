/**
 * Drama.tags stores both ops provenance and user-facing labels in one TEXT[].
 * Public APIs must strip system meta so consumers only see genre-like tags.
 */

const PROVENANCE_TAGS = new Set(['upload', 'r2', 'transfer', 'ytdlp']);

/** Internal / provenance markers that must not appear on the public web. */
export function isDramaSystemTag(tag: string): boolean {
  const t = String(tag || '').trim();
  if (!t) return true;
  if (PROVENANCE_TAGS.has(t)) return true;
  if (t.startsWith('ytdlp')) return true;
  if (t.startsWith('type:')) return true;
  if (t.startsWith('completion:')) return true;
  return false;
}

/** Tags safe to expose on public drama list/detail/feed. */
export function toPublicDramaTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = String(raw ?? '').trim();
    if (!t || isDramaSystemTag(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
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
  for (const t of [...provenance, ...next]) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
