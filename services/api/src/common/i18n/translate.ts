import {
  DEFAULT_API_LOCALE,
  normalizeApiLocale,
  resolveAcceptLanguage,
  type ApiLocale,
} from './locale';
import { isMessageKey, MESSAGES, type MessageKey } from './messages';
import { LEGACY_MESSAGE_LITERALS, LEGACY_MESSAGE_PATTERNS } from './legacy-messages';

export type MessageParams = Record<string, string | number>;

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined && params[key] !== null ? String(params[key]) : `{${key}}`,
  );
}

/** Translate a catalog key; unknown keys returned as-is. Fallback: English. */
export function t(
  key: string,
  locale: ApiLocale = DEFAULT_API_LOCALE,
  params?: MessageParams,
): string {
  if (!isMessageKey(key)) return interpolate(key, params);
  const dict = MESSAGES[locale] ?? MESSAGES[DEFAULT_API_LOCALE];
  const template = dict[key] ?? MESSAGES[DEFAULT_API_LOCALE][key] ?? key;
  return interpolate(template, params);
}

export function tFromAcceptLanguage(
  key: string,
  acceptLanguage?: string | null,
  params?: MessageParams,
): string {
  return t(key, resolveAcceptLanguage(acceptLanguage), params);
}

/** Defaults for ValidationPipe messages that cannot carry BizException params. */
const DEFAULT_KEY_PARAMS: Partial<Record<MessageKey, MessageParams>> = {
  'auth.passwordMinLength': { min: 6 },
  'auth.newPasswordMinLength': { min: 6 },
  'admin.passwordMinLength': { min: 6 },
  'admin.newPasswordMinLength': { min: 6 },
};

function resolveLegacyMessage(message: string): {
  key: MessageKey;
  params?: MessageParams;
} | null {
  const exact = LEGACY_MESSAGE_LITERALS[message];
  if (exact) return { key: exact };
  for (const rule of LEGACY_MESSAGE_PATTERNS) {
    const m = message.match(rule.re);
    if (!m) continue;
    return { key: rule.key, params: rule.params?.(m) };
  }
  return null;
}

/** Localize a message that may be a catalog key, legacy literal, or raw string. */
export function localizeMessage(
  message: string,
  acceptLanguage?: string | null,
  params?: MessageParams,
): string {
  if (isMessageKey(message)) {
    const merged = { ...DEFAULT_KEY_PARAMS[message], ...params };
    return tFromAcceptLanguage(message, acceptLanguage, merged);
  }
  const legacy = resolveLegacyMessage(message);
  if (legacy) {
    return tFromAcceptLanguage(legacy.key, acceptLanguage, { ...legacy.params, ...params });
  }
  return interpolate(message, params);
}

export function localeFromRequest(headers: {
  'accept-language'?: string | string[];
}): ApiLocale {
  const raw = headers['accept-language'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return resolveAcceptLanguage(header);
}

export { normalizeApiLocale, resolveAcceptLanguage, DEFAULT_API_LOCALE };
export type { ApiLocale, MessageKey };
