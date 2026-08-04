/** API UI locales — aligned with apps/web; English is system default & fallback. */
export const API_LOCALES = ['en', 'zh', 'fr'] as const;
export type ApiLocale = (typeof API_LOCALES)[number];

export const DEFAULT_API_LOCALE: ApiLocale = 'en';

function isApiLocale(code: string): code is ApiLocale {
  return (API_LOCALES as readonly string[]).includes(code);
}

/** Map BCP-47 / free-form tag → supported API locale; unsupported → English. */
export function normalizeApiLocale(value?: string | null): ApiLocale {
  if (!value) return DEFAULT_API_LOCALE;
  const normalized = value.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) return DEFAULT_API_LOCALE;
  if (normalized.startsWith('zh')) return 'zh';
  const code = normalized.split('-')[0];
  return isApiLocale(code) ? code : DEFAULT_API_LOCALE;
}

/**
 * Resolve locale from Accept-Language (q-weighted).
 * System policy: English when header missing or nothing matches.
 */
export function resolveAcceptLanguage(header?: string | null): ApiLocale {
  if (!header?.trim()) return DEFAULT_API_LOCALE;

  const parts = header.split(',').map((raw) => {
    const [tag, ...params] = raw.trim().split(';');
    let q = 1;
    for (const p of params) {
      const m = p.trim().match(/^q=([0-9.]+)$/i);
      if (m) q = Number(m[1]) || 0;
    }
    return { tag: tag.trim(), q };
  });

  parts.sort((a, b) => b.q - a.q);

  for (const { tag, q } of parts) {
    if (q <= 0 || !tag || tag === '*') continue;
    const normalized = tag.replace(/_/g, '-').toLowerCase();
    if (normalized.startsWith('zh')) return 'zh';
    const base = normalized.split('-')[0];
    if (isApiLocale(base)) return base;
  }

  return DEFAULT_API_LOCALE;
}
