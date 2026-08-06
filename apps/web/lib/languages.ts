/** Interface languages — display logic aligned with StarNexus. */

export const FALLBACK_LOCALE = "en" as const;

export const INTERFACE_LANGUAGE_OPTIONS = [
  { code: "zh", label: "简体中文" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
] as const;

export type Locale = (typeof INTERFACE_LANGUAGE_OPTIONS)[number]["code"];

export const INTERFACE_LANGUAGE_SHORT_LABELS: Record<Locale, string> = {
  zh: "ZH",
  en: "EN",
  fr: "FR",
};

export const SUPPORTED_LOCALES: Locale[] = INTERFACE_LANGUAGE_OPTIONS.map(
  (l) => l.code,
);

function isSupportedLocale(code: string): code is Locale {
  return SUPPORTED_LOCALES.includes(code as Locale);
}

/** Map any BCP-47 / free-form tag to a supported locale; unsupported → English. */
export function normalizeInterfaceLanguage(value?: string | null): Locale {
  if (!value) return FALLBACK_LOCALE;
  const normalized = value.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) return FALLBACK_LOCALE;
  if (normalized.startsWith("zh")) return "zh";
  const code = normalized.split("-")[0];
  return isSupportedLocale(code) ? code : FALLBACK_LOCALE;
}

/** Prefer navigator.languages, then navigator.language; no match → English. */
export function detectSystemLanguage(): Locale {
  if (typeof navigator === "undefined") return FALLBACK_LOCALE;
  const candidates = [
    ...(navigator.languages || []),
    navigator.language,
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    const normalized = raw.trim().replace(/_/g, "-").toLowerCase();
    if (normalized.startsWith("zh")) return "zh";
    const base = normalized.split("-")[0];
    if (isSupportedLocale(base)) return base;
  }
  return FALLBACK_LOCALE;
}

/** Parse Accept-Language header (middleware / SSR) → supported locale. */
export function localeFromAcceptLanguage(header?: string | null): Locale {
  if (!header) return FALLBACK_LOCALE;
  const parts = header.split(",").map((p) => {
    const [tag, qPart] = p.trim().split(";").map((s) => s.trim());
    const q = qPart?.startsWith("q=") ? Number(qPart.slice(2)) : 1;
    return { tag, q: Number.isFinite(q) ? q : 1 };
  });
  parts.sort((a, b) => b.q - a.q);
  for (const { tag } of parts) {
    if (!tag) continue;
    const normalized = tag.replace(/_/g, "-").toLowerCase();
    if (normalized.startsWith("zh")) return "zh";
    const base = normalized.split("-")[0];
    if (isSupportedLocale(base)) return base;
  }
  return FALLBACK_LOCALE;
}

export function getInterfaceLanguageShortLabel(code?: string | null): string {
  const normalized = normalizeInterfaceLanguage(code);
  return (
    INTERFACE_LANGUAGE_SHORT_LABELS[normalized] ??
    INTERFACE_LANGUAGE_SHORT_LABELS[FALLBACK_LOCALE]
  );
}

/** Content fields are en/zh; only zh UI uses Chinese copy — others (en/fr/…) use English. */
export function contentLocale(locale: Locale): "en" | "zh" {
  return locale === "zh" ? "zh" : "en";
}

/**
 * General content (descriptions, category names, …): locale field, then the other language.
 * Prefer {@link pickTitleText} for drama/episode titles.
 */
export function pickContentText(
  locale: Locale,
  enText: string,
  zhText: string,
): string {
  if (contentLocale(locale) === "zh") {
    return zhText || enText;
  }
  return enText || zhText;
}

/**
 * Drama / episode titles: prefer the UI locale field, then English as the global fallback.
 * Chinese is only a last resort for legacy rows that lack titleEn.
 */
export function pickTitleText(
  locale: Locale,
  enText: string,
  zhText: string,
): string {
  const preferred =
    contentLocale(locale) === "zh" ? zhText : enText;
  return preferred || enText || zhText;
}
