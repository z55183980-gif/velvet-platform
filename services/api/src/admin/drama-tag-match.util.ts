/**
 * Map free-form page/LLM genre labels onto the closest DramaTagLabel keys.
 * Online import only writes existing dictionary tags — never invents new ones.
 */

import { resolveCategorySlugAlias } from './drama-category-infer.util';

export type DramaTagCatalogEntry = {
  key: string;
  nameEn: string;
  nameZh?: string | null;
  nameFr?: string | null;
};

export type TagMatchHit = {
  key: string;
  score: number;
  label: string;
};

const DEFAULT_MIN_SCORE = 0.62;

function normalizeTagText(raw: string): string {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_./\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic Levenshtein distance. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/** Containment score when one string embeds the other (short genre inside compound labels). */
function containmentScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 2) return 0;
  if (!longer.includes(shorter)) return 0;
  const ratio = shorter.length / longer.length;
  // Require meaningful overlap (avoid "an"/"tion" style noise).
  if (ratio < 0.35 && shorter.length < 4) return 0;
  return 0.72 + 0.28 * ratio;
}

function candidateVariants(raw: string): string[] {
  const base = normalizeTagText(raw);
  if (!base) return [];
  const out = new Set<string>([base]);
  const aliased = normalizeTagText(resolveCategorySlugAlias(raw));
  if (aliased) out.add(aliased);
  // Drop trailing "drama/series/movie" noise common on page chips.
  const stripped = base
    .replace(/\b(drama|series|movie|film|show|genre)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped) out.add(stripped);
  return [...out];
}

function fieldVariants(entry: DramaTagCatalogEntry): string[] {
  const fields = [entry.key, entry.nameEn, entry.nameZh, entry.nameFr];
  const out = new Set<string>();
  for (const f of fields) {
    const n = normalizeTagText(String(f || ''));
    if (n) out.add(n);
  }
  return [...out];
}

/** Best similarity of one free-form label against a catalog entry. */
export function scoreLabelAgainstTag(
  label: string,
  entry: DramaTagCatalogEntry,
): number {
  const variants = candidateVariants(label);
  if (!variants.length) return 0;
  const fields = fieldVariants(entry);
  if (!fields.length) return 0;

  let best = 0;
  for (const v of variants) {
    for (const f of fields) {
      if (v === f) return 1;
      best = Math.max(best, similarity(v, f), containmentScore(v, f));
    }
  }
  return best;
}

/**
 * Pick the closest catalog key for a single free-form label.
 * Returns null when nothing clears `minScore` (caller should drop).
 */
export function mapLabelToClosestTag(
  label: string,
  catalog: DramaTagCatalogEntry[],
  opts?: { minScore?: number },
): TagMatchHit | null {
  const raw = String(label || '').trim();
  if (!raw || !catalog.length) return null;
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;

  let best: TagMatchHit | null = null;
  for (const entry of catalog) {
    const key = String(entry.key || '').trim();
    if (!key) continue;
    const score = scoreLabelAgainstTag(raw, entry);
    if (score < minScore) continue;
    if (!best || score > best.score) {
      best = { key, score, label: raw };
    } else if (best && score === best.score && key.localeCompare(best.key) < 0) {
      // Stable tie-break: lexicographically smaller key.
      best = { key, score, label: raw };
    }
  }
  return best;
}

/**
 * Map many source labels → unique existing tag keys (closest match each).
 * Unmatched / below-threshold labels are dropped.
 */
export function mapLabelsToExistingTags(
  labels: string[] | null | undefined,
  catalog: DramaTagCatalogEntry[],
  opts?: { minScore?: number; max?: number },
): string[] {
  if (!Array.isArray(labels) || !labels.length || !catalog.length) return [];
  const max = opts?.max && opts.max > 0 ? opts.max : 8;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of labels) {
    const hit = mapLabelToClosestTag(raw, catalog, { minScore: opts?.minScore });
    if (!hit) continue;
    const keyLower = hit.key.toLowerCase();
    if (seen.has(keyLower)) continue;
    seen.add(keyLower);
    out.push(hit.key);
    if (out.length >= max) break;
  }
  return out;
}
