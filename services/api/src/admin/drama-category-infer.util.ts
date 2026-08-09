/**
 * Infer Drama.categorySlug from page/title/desc text against known Category.slug values.
 * Prefer deterministic keyword scores; LLM fills gaps when callers ask separately.
 */

export type CategoryInferHit = {
  slug: string;
  score: number;
  source: 'page' | 'heuristic';
};

/** Default catalog slugs — used when DB list is empty or for tests. */
export const DEFAULT_CATEGORY_SLUGS = [
  'do_thi',
  'ngon_tinh',
  'hanh_dong',
  'hai_huoc',
  'tam_ly',
  'co_trang',
] as const;

/** Keyword groups per slug (zh / en / common genre labels). Longer phrases first. */
const KEYWORD_GROUPS: Record<string, string[]> = {
  ngon_tinh: [
    '甜宠',
    '言情',
    '恋爱',
    '爱情',
    '豪门',
    '总裁',
    '闪婚',
    '先婚后爱',
    'romance',
    'love story',
    'ceo romance',
    'romantic',
  ],
  do_thi: [
    '都市',
    '商战',
    '职场',
    '现代都市',
    'urban',
    'city',
    'modern drama',
    'workplace',
  ],
  hanh_dong: [
    '动作',
    '复仇',
    '杀手',
    '特工',
    '战争',
    '枪战',
    '武打',
    'action',
    'assassin',
    'revenge',
    'thriller action',
  ],
  hai_huoc: [
    '喜剧',
    '搞笑',
    '欢喜',
    '轻松搞笑',
    'comedy',
    'funny',
    'humor',
    'humour',
  ],
  tam_ly: [
    '心理',
    '悬疑',
    '推理',
    '惊悚',
    '罪案',
    '犯罪',
    '重生复仇',
    'psychological',
    'suspense',
    'mystery',
    'thriller',
    'crime',
  ],
  co_trang: [
    '古装',
    '宫廷',
    '穿越',
    '修仙',
    '玄幻',
    '仙侠',
    '武侠',
    '王朝',
    '古代',
    'costume',
    'historical',
    'palace',
    'xianxia',
    'wuxia',
    'dynasty',
  ],
};

/** Map free-form labels (page genres) onto catalog slugs. */
const LABEL_ALIASES: Record<string, string> = {
  都市: 'do_thi',
  urban: 'do_thi',
  city: 'do_thi',
  言情: 'ngon_tinh',
  romance: 'ngon_tinh',
  romantic: 'ngon_tinh',
  甜宠: 'ngon_tinh',
  爱情: 'ngon_tinh',
  动作: 'hanh_dong',
  action: 'hanh_dong',
  喜剧: 'hai_huoc',
  comedy: 'hai_huoc',
  心理: 'tam_ly',
  悬疑: 'tam_ly',
  psychological: 'tam_ly',
  mystery: 'tam_ly',
  thriller: 'tam_ly',
  古装: 'co_trang',
  costume: 'co_trang',
  historical: 'co_trang',
  xianxia: 'co_trang',
  wuxia: 'co_trang',
};

function normalizeText(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map a raw page genre/category label to a known slug when possible. */
export function mapGenreLabelToSlug(
  label: string,
  allowedSlugs: string[],
): string | undefined {
  const allowed = new Set(allowedSlugs.map((s) => s.trim()).filter(Boolean));
  const raw = String(label || '').trim();
  if (!raw) return undefined;

  const lower = raw.toLowerCase();
  if (allowed.has(raw)) return raw;
  if (allowed.has(lower)) return lower;

  const aliased = LABEL_ALIASES[raw] || LABEL_ALIASES[lower];
  if (aliased && allowed.has(aliased)) return aliased;

  // Soft: contain match against alias keys
  for (const [key, slug] of Object.entries(LABEL_ALIASES)) {
    if (!allowed.has(slug)) continue;
    if (lower.includes(key.toLowerCase())) return slug;
  }
  return undefined;
}

/**
 * Score title/description against keyword groups.
 * Returns best hit when score ≥ 1 and uniquely leading (or clear winner).
 */
export function inferCategoryFromText(
  text: string,
  allowedSlugs: string[],
): CategoryInferHit | null {
  const allowed = allowedSlugs.map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return null;
  const hay = normalizeText(text);
  if (hay.length < 2) return null;

  const scores = new Map<string, number>();
  for (const slug of allowed) {
    const words = KEYWORD_GROUPS[slug] || [];
    let score = 0;
    for (const w of words) {
      const needle = w.toLowerCase();
      if (!needle) continue;
      if (hay.includes(needle)) {
        // Longer phrases weigh more.
        score += Math.max(1, Math.min(3, Math.ceil(needle.length / 4)));
      }
    }
    if (score > 0) scores.set(slug, score);
  }

  if (!scores.size) return null;
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [bestSlug, bestScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  // Ambiguous tie → defer to LLM.
  if (ranked.length > 1 && bestScore === second) return null;
  if (bestScore < 1) return null;
  return { slug: bestSlug, score: bestScore, source: 'heuristic' };
}

/** Prefer first page label that maps; else heuristic on combined text. */
export function inferCategorySlug(opts: {
  allowedSlugs: string[];
  title?: string;
  description?: string;
  pageLabels?: string[];
}): CategoryInferHit | null {
  const allowed =
    opts.allowedSlugs.length > 0
      ? opts.allowedSlugs
      : [...DEFAULT_CATEGORY_SLUGS];

  for (const label of opts.pageLabels || []) {
    const slug = mapGenreLabelToSlug(label, allowed);
    if (slug) return { slug, score: 10, source: 'page' };
  }

  const blob = [opts.title, opts.description].filter(Boolean).join('\n');
  return inferCategoryFromText(blob, allowed);
}

/** Keep only slugs that exist in the catalog. */
export function sanitizeCategorySlug(
  candidate: string | null | undefined,
  allowedSlugs: string[],
): string | undefined {
  const slug = String(candidate || '').trim();
  if (!slug) return undefined;
  const allowed = new Set(allowedSlugs.map((s) => s.trim()).filter(Boolean));
  if (allowed.has(slug)) return slug;
  return mapGenreLabelToSlug(slug, [...allowed]);
}
