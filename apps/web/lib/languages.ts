/** Interface languages — display logic aligned with StarNexus. */

export const FALLBACK_LOCALE = "en" as const;

export const INTERFACE_LANGUAGE_OPTIONS = [
  { code: "zh", label: "简体中文" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "ru", label: "Русский" },
  { code: "vi", label: "Tiếng Việt" },
] as const;

export type Locale = (typeof INTERFACE_LANGUAGE_OPTIONS)[number]["code"];

export const INTERFACE_LANGUAGE_SHORT_LABELS: Record<Locale, string> = {
  zh: "ZH",
  en: "EN",
  fr: "FR",
  ru: "RU",
  vi: "VI",
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

export function getInterfaceLanguageShortLabel(code?: string | null): string {
  const normalized = normalizeInterfaceLanguage(code);
  return (
    INTERFACE_LANGUAGE_SHORT_LABELS[normalized] ??
    INTERFACE_LANGUAGE_SHORT_LABELS[FALLBACK_LOCALE]
  );
}

/** Content fields are currently vi/zh only; map UI locale → content side. */
export function contentLocale(locale: Locale): "vi" | "zh" {
  return locale === "vi" ? "vi" : "zh";
}

export function pickContentText(
  locale: Locale,
  viText: string,
  zhText: string,
): string {
  return contentLocale(locale) === "vi" ? viText : zhText || viText;
}
