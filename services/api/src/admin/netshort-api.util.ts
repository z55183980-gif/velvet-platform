/**
 * NetShort web API client for resolving an episode page to its signed MP4.
 * The crypto constants and sequence mirror web chunk modules 88359 and 97539.
 */
import {
  constants,
  createCipheriv,
  createDecipheriv,
  privateDecrypt,
  publicEncrypt,
  randomUUID,
} from 'crypto';
import { isNetshortHost } from './online-page-extract.util';

const API_BASE = 'https://netshort.com/prod-web-api';
const REQUEST_AES_KEY = Buffer.from(
  '5k3KYTOO9jnO0CeyGhdHc3pIjGnVgrMN',
  'utf8',
);
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

const CONTENT_LANGUAGE: Record<string, string> = {
  en: 'en_US',
  zh: 'zh_TW',
  ja: 'ja_JP',
  ko: 'ko_KR',
  es: 'es_ES',
  th: 'th_TH',
  id: 'id_ID',
  pt: 'pt_PT',
  cn: 'zh_CN',
  it: 'it_IT',
  de: 'de_DE',
  fr: 'fr_FR',
  ar: 'ar_AE',
  ms: 'ms_MY',
  tr: 'tr_TR',
  vi: 'vi_VN',
  hi: 'hi_IN',
};

const REQUEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2poXMstZ8NCWE7915MXz
DWC5/t+oB2waGfskPqSZwLqxd4ZBR0H1cb1tAZRZcV7P+LmOd6SYNxhnELaWuKTD
+D3xkz8Tt1L5j/ynGqVt1MDbiQIEzXQKUkNDSH6T0A+Xzo/67/8QOQXlVJfW06res
baeNvibfx6Qc78j96bCIPlxPrtieilVTBHUFOXjirxK/ki/mO8P2smRbpt73fsQW
dGmTGMfYGvfPApGyxbxLkL/qrBjU25XpM8a0MBqzFWUAchHmqSBJ6Mbfam1SSgf3
b2U28s67nOW+JiOrhd6iVLcsLFxXA54HX+Zbej3AbOB6jKaEmp/bz1amneE1NYXw
wIDAQAB
-----END PUBLIC KEY-----`;

const RESPONSE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCK0Tl1pd7bjTRU93bWoHW1hLCDj2+9bg1MgY8j5C7xXaw6bJfToXhWbH1fXNbnFFVqxyYNErcuOUwJZxyDgcxUXM4yWnRseb2GF97GOicAQ2keDzVYmwky4lrSRwvcXutJRLPUCRQNfc6upfk2G5TKh6/CcP4TV1eXTF7+vdEw2SHxAOITKbSfcaZXr/hVs6a1aRHsBF+7RG99ebwZIP6/AgIyqX9RbDVN6ixi1v2G3/bwAULHLSqGdSaqij/ca17fbFGITaeCeEaZ6d/P4ZuOK+PEPdbPQt6SbY4lZaYwRvdrpH73kigPITgDzIDONFybJ1m7wRKlq1wxWHwbimptAgMBAAECggEAPz3cYJXFtt5YphDrahJGLgEabYVOUc2ub1li/eX54OpdCWzpqneYnD7myyg/m5zu4SuDUVdibsOZuXrpSZw7m3+ATP5apgS8bDe5vTNHC16qqBAjrI9NHIp09/F4HNh9dq6/Am10XkUfgP+KTrU4DyDL2NijV+pltD8N1B5kDE1igokVcsavhnu2INoMRXYE78Wq6urNECuFWw9hldv81M9m2w56t1CQOUukpo4mfmLjZRe2s+kwtcBVefGHP8Cj0OeH2dGltjl2YSQMRBFUCVoixYpOrcjIHoqzWri8IfUZ2tW+nUvHl5IZ9RVxefnFaLGnxiXd2sk6Sn4aD/l9YQKBgQDVv3HaOZxHRqlNSPrNGqplGhE066HnDsq6MlPukiovxE43CRBmpTnk9zDCqrDh9t2HbJuao7nSq5WlBERWgwqXU/qDpH43W7Y/lJfHkDv6A2m0viJa0a9x8+CJpNnCDu1ATo4/IQKwoXYice6JKnUyXgkGKn+HipiN6tO0EtWHlQKBgQCmQfklKFtXtm/FZ6NIMs+d+EyvaE5xNLKGYQxmiCR10WGYd8ZV+K0Q6qXHS+a32TirWB9F3TqPOklTytMrfPZB3BCXj4weEldb8W716G8FYf7LLhaT+MdpF7KDcruObwoQAvKV3N4eX6tUEMmdrx9hpCmmIU5EeXUkhGdmwk7BeQKBgAIXMkThJV8pGMTRvuo8pYgBnkN3PoklAuSZU2rU8Sawc9dj9k4atZtAs7BjvQEoyffmHwt/KHUgCoGnrgdulq7uOlgJRtbBxeGPUYC5L2z9lY4YAfwDawThTsPp4dtdDAMCAbAqYX1axu4FUUD0MltAwjPWPJMVzvIsZs+vE3mVAoGAJPja3OaCmZjadj2709xoyypic0dw2j/ry3JdfZec9A5h87P/CTNJ2U81GoLIhe3qakAohDLUSPGfSOD74NnjMXYswmeLs0xE3Q9tq4XK2pmWPby8DJ/wSHCapByplN0gkbr2E1mQk5SW1xT8oPJGukH1eRpC+3s/D6XaEMH5HZECgYEAigoX5l39LDsCgeaUcI4S9grkaas/WsKv37eqo3oD9Qk6VFiMM5L5Zig6aXJxuAPLVjb38caJRPmPmOXLT2kEP1E1h6OJOhEhETwVIUtcBzsK25ju9LqL89bC+W0uS7BPvk6Tcws/tXHCkQCTgb9jVXceZ2ox+6axvlW/5WgHt5Q=
-----END PRIVATE KEY-----`;

type FetchLike = typeof fetch;

type NetshortRequestOptions = {
  token?: string;
  deviceCode?: string;
  contentLanguage: string;
  referer: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
};

export type ParsedNetshortEpisodePage = {
  shortPlayId: string;
  episodeNo: number;
  contentLanguage: string;
};

export type ResolveNetshortOptions = {
  /** Operator-owned NetShort token, if the source episode is legitimately unlocked. */
  bearerToken?: string;
  deviceCode?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export type NetshortEpisodeInfo = {
  playUrl: string;
  isLock: false;
  shortPlayId: string;
  episodeNo: number;
  episodeId?: string;
  durationSec?: number;
};

class NetshortApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly apiCode?: number,
  ) {
    super(message);
    this.name = 'NetshortApiError';
  }
}

type VisitorSession = {
  token: string;
  deviceCode: string;
  expiresAt: number;
};

let visitorSession: VisitorSession | null = null;
let visitorSessionPromise: Promise<VisitorSession> | null = null;

function encryptAes(plaintext: string, key: Buffer): string {
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]).toString('base64');
}

function decryptAes(ciphertextBase64: string, key: Buffer): string {
  const decipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** CryptoJS-compatible F2(JSON, K()) output. */
export function encryptNetshortRequestBody(
  body: Record<string, unknown>,
): string {
  const plaintext = decodeURIComponent(JSON.stringify(body));
  return encryptAes(plaintext, REQUEST_AES_KEY);
}

/** JSEncrypt-compatible RSAES-PKCS1-v1_5 wrapping of n3(K()). */
export function createNetshortEncryptKeyHeader(): string {
  const base64Key = REQUEST_AES_KEY.toString('base64');
  return publicEncrypt(
    { key: REQUEST_PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(base64Key, 'utf8'),
  ).toString('base64');
}

function decryptResponseKey(headerBase64: string): Buffer {
  const decoded = privateDecrypt(
    { key: RESPONSE_PRIVATE_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(headerBase64, 'base64'),
  ).toString('utf8');
  const key = Buffer.from(decoded, 'base64');
  if (![16, 24, 32].includes(key.length)) {
    throw new Error(`NetShort 响应 AES key 长度无效: ${key.length}`);
  }
  return key;
}

/** Module 88359 response flow: RSA private-decrypt header, then $3 + PB body. */
export function decryptNetshortResponseBody(
  ciphertextBase64: string,
  encryptedKeyHeader: string,
): string {
  return decryptAes(ciphertextBase64, decryptResponseKey(encryptedKeyHeader));
}

/** Parse the series ID, episode suffix, and locale header from a NetShort page URL. */
export function parseNetshortEpisodePage(
  pageUrl: string,
): ParsedNetshortEpisodePage | null {
  if (!isNetshortHost(pageUrl)) return null;
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const parts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const pageTypeIndex = parts.findIndex((part) =>
    /^(?:episode|full-episodes)$/i.test(part),
  );
  if (
    pageTypeIndex < 0 ||
    pageTypeIndex > 1 ||
    pageTypeIndex !== parts.length - 2
  ) {
    return null;
  }

  let slug = parts[parts.length - 1];
  let episodeNo = 1;
  const episodeSuffix = slug.match(/-ep-(\d+)$/i);
  if (episodeSuffix) {
    episodeNo = Number(episodeSuffix[1]);
    slug = slug.slice(0, -episodeSuffix[0].length);
  }
  if (!Number.isSafeInteger(episodeNo) || episodeNo < 1) return null;

  const idMatch = slug.match(/-(\d{10,24})$/);
  if (!idMatch) return null;
  const locale = pageTypeIndex === 1 ? parts[0].toLowerCase() : 'en';
  if (pageTypeIndex === 1 && !CONTENT_LANGUAGE[locale]) return null;
  return {
    shortPlayId: idMatch[1],
    episodeNo,
    contentLanguage: CONTENT_LANGUAGE[locale] || CONTENT_LANGUAGE.en,
  };
}

async function apiPost<T>(
  path: string,
  body: Record<string, unknown>,
  options: NetshortRequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Content-Language': options.contentLanguage,
    'Content-Type': 'application/json;charset=utf-8',
    'encrypt-key': createNetshortEncryptKeyHeader(),
    OS: '4',
    canary: 'v1',
    version: '1.2.0',
    Origin: 'https://netshort.com',
    Referer: options.referer,
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.deviceCode) headers['Device-Code'] = options.deviceCode;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  let response: Response;
  let responseText: string;
  try {
    response = await options.fetchImpl(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: encryptNetshortRequestBody(body),
      signal: controller.signal,
      redirect: 'error',
    });
    responseText = await response.text();
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new NetshortApiError('NetShort API 请求超时', 408);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (responseText.length > MAX_RESPONSE_CHARS) {
    throw new NetshortApiError('NetShort API 响应过大', response.status);
  }
  const encryptedKey = response.headers.get('encrypt-key');
  let jsonText = responseText;
  if (encryptedKey) {
    try {
      jsonText = decryptNetshortResponseBody(responseText, encryptedKey);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NetshortApiError(
        `NetShort API 响应解密失败: ${message}`,
        response.status,
      );
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new NetshortApiError(
      `NetShort API 响应非 JSON (HTTP ${response.status})`,
      response.status,
    );
  }

  const code = Number(parsed?.code);
  if (!response.ok || code !== 200) {
    const message = String(
      parsed?.msg ||
        parsed?.message ||
        `HTTP ${response.status}, code=${parsed?.code}`,
    );
    throw new NetshortApiError(
      message,
      response.status,
      Number.isFinite(code) ? code : undefined,
    );
  }
  return parsed as T;
}

function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof NetshortApiError &&
    (error.httpStatus === 401 || error.apiCode === 401)
  );
}

async function getVisitorSession(
  options: Pick<
    NetshortRequestOptions,
    'contentLanguage' | 'referer' | 'fetchImpl' | 'timeoutMs'
  >,
): Promise<VisitorSession> {
  const now = Date.now();
  if (visitorSession && visitorSession.expiresAt > now + 60_000) {
    return visitorSession;
  }
  if (!visitorSessionPromise) {
    visitorSessionPromise = (async () => {
      const deviceCode = `${randomUUID()}-${Date.now()}`;
      const response = await apiPost<{
        data?: { token?: string; timeout?: number };
      }>(
        '/web/auth/visitor_login',
        { deviceCode, os: 'windows' },
        { ...options, deviceCode },
      );
      const token = String(response.data?.token || '').trim();
      if (!token) throw new Error('NetShort visitor_login 未返回 token');
      const timeoutSeconds = Number(response.data?.timeout);
      const sessionLifetimeMs =
        Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
          ? Math.min(timeoutSeconds, 7 * 24 * 60 * 60) * 1000
          : 60 * 60 * 1000;
      visitorSession = {
        token,
        deviceCode,
        expiresAt: now + sessionLifetimeMs,
      };
      return visitorSession;
    })().finally(() => {
      visitorSessionPromise = null;
    });
  }
  return visitorSessionPromise;
}

/** Resolve a NetShort episode page to its short-lived `data.playVoucher` MP4. */
export async function resolveNetshortPlayUrl(
  pageUrl: string,
  options: ResolveNetshortOptions = {},
): Promise<NetshortEpisodeInfo> {
  const parsedPage = parseNetshortEpisodePage(pageUrl);
  if (!parsedPage) {
    throw new Error('无法从 NetShort URL 解析 shortPlayId / episodeNo');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(60_000, Math.max(1_000, requestedTimeout))
    : 12_000;
  const token = String(
    options.bearerToken !== undefined
      ? options.bearerToken
      : process.env.NETSHORT_BEARER_TOKEN || '',
  )
    .trim()
    .replace(/^Bearer\s+/i, '');
  const deviceCode = String(
    options.deviceCode !== undefined
      ? options.deviceCode
      : process.env.NETSHORT_DEVICE_CODE || '',
  ).trim();
  const requestBase = {
    contentLanguage: parsedPage.contentLanguage,
    referer: pageUrl,
    fetchImpl,
    timeoutMs,
  };
  const body = {
    shortPlayId: parsedPage.shortPlayId,
    episodeNo: parsedPage.episodeNo,
  };

  type EpisodeResponse = {
    data?: {
      playVoucher?: string | null;
      isLock?: boolean;
      episodeId?: string;
      duration?: string | number;
    };
  };

  let response: EpisodeResponse;
  try {
    response = await apiPost<EpisodeResponse>(
      '/web/v4/short_play/episode_info',
      body,
      {
        ...requestBase,
        token: token || undefined,
        deviceCode: deviceCode || undefined,
      },
    );
  } catch (error: unknown) {
    // Free episodes currently work anonymously. Create a visitor only if the API
    // explicitly starts requiring authentication; never login on every resolve.
    if (token || !isUnauthorized(error)) throw error;
    const session = await getVisitorSession(requestBase);
    try {
      response = await apiPost<EpisodeResponse>(
        '/web/v4/short_play/episode_info',
        body,
        { ...requestBase, token: session.token, deviceCode: session.deviceCode },
      );
    } catch (retryError: unknown) {
      if (isUnauthorized(retryError)) visitorSession = null;
      throw retryError;
    }
  }

  const data = response.data || {};
  if (data.isLock === true) {
    throw new Error(
      `NetShort 第 ${parsedPage.episodeNo} 集已锁定，当前账号无可用 playVoucher`,
    );
  }
  const playUrl = String(data.playVoucher || '').trim();
  let playable: URL;
  try {
    playable = new URL(playUrl);
  } catch {
    throw new Error(`NetShort 第 ${parsedPage.episodeNo} 集未返回 playVoucher`);
  }
  if (playable.protocol !== 'https:' && playable.protocol !== 'http:') {
    throw new Error(`NetShort 第 ${parsedPage.episodeNo} 集 playVoucher 协议无效`);
  }

  const duration = Number(data.duration);
  return {
    // Preserve the server's exact signed spelling; URL.toString() may normalize
    // percent-encoding that participates in a CDN signature.
    playUrl,
    isLock: false,
    shortPlayId: parsedPage.shortPlayId,
    episodeNo: parsedPage.episodeNo,
    episodeId: data.episodeId ? String(data.episodeId) : undefined,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : undefined,
  };
}
