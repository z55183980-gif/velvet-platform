/**
 * DramaBox App API client (chapterv2/batch/load) for resolving episode CDN URLs.
 *
 * Signing mirrors the official APK:
 * - `st`: native `libdzst` / d.z.s.N (djb2 + custom alphabet)
 * - `sn`: SHA256withRSA with the client-embedded PKCS#8 key (Dg.b)
 *
 * HTTP uses system `curl` by default — Node's TLS fingerprint is blocked by Akamai
 * on sapi.dramaboxvideo.com (HTTP 403 HTML). Tests can inject `fetchImpl`.
 *
 * Datacenter egress IPs are also blocked; set `DRAMABOX_HTTPS_PROXY` (http/https/socks5/
 * socks5h URL) so curl exits via residential/mobile. Prefer `socks5h://` so DNS goes
 * through the proxy.
 *
 * Host-scoped — only call for dramabox.com / dramaboxapp.com page URLs.
 */
import { execFile } from 'child_process';
import { createSign, randomUUID } from 'crypto';
import { promisify } from 'util';
import { isDramaboxHost } from './online-page-extract.util';

const execFileAsync = promisify(execFile);

const API_HOST = 'https://sapi.dramaboxvideo.com';
const BATCH_LOAD_PATH = '/drama-box/chapterv2/batch/load';
const MAX_RESPONSE_CHARS = 4 * 1024 * 1024;
const MAX_CHAPTER_PAGES = 40;

/** 75-byte translate tables from libdzst.so (first 64 = encode alphabet). */
const TRANSLATE_TABLES = [
  'kL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF-GHIJ_KMOQSUWYbdfhjlnprtvxzACEgi@[\\]^:;<=>?',
  '7uV8wX9yZ0aB1cD2eF-GHIJ_KMOQSUWYbdfhjlnprtvxzACEgikL3mN4oP5qR6sT^:;<=>?@[\\]',
  'bdfhjlnprtvxzACEgikL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF-GHIJ_KMOQSUWY<=>?@[\\]^:;',
  '1cD2eF-GHIJ_KMOQSUWYbdfhjlnprtvxzACEgikL3mN4oP5qR6sT7uV8wX9yZ0aB;:^]\\[@?>=<',
  'MOQSUWYbdfhjlnprtvxzACEgikL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF-GHIJ_K[\\]^:;<=>?@',
  'R6sT7uV8wX9yZ0aB1cD2eF-GHIJ_KMOQSUWYbdfhjlnprtvxzACEgikL3mN4oP5q?@[\\]^:;<=>',
  'eF-GHIJ_KMOQSUWYbdfhjlnprtvxzACEgikL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2=>?@[\\]^:;<',
  'xzACEgikL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF-GHIJ_KMOQSUWYbdfhjlnprtv]\\[@?>=<;:^',
  'yZ0aB1cD2eF-GHIJ_KMOQSUWYbdfhjlnprtvxzACEgikL3mN4oP5qR6sT7uV8wX9>?@[\\]^:;<=',
  'lnprtvxzACEgikL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF-GHIJ_KMOQSUWYbdfhj\\^][:;@?>=<',
] as const;

const CERT_SHA256 =
  '003cc4921e198429f7dd7066244bfe5efccdfeea01adf25e91c96d64478c00a1';
const FIXED_PART = `MySuperSecretSalt_DoNotLeak|com.storymatrix.drama|${CERT_SHA256}|`;

/** Client-embedded PKCS#8 RSA private key used for header `sn` (APK Dg.b). */
const SN_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9Q4Y5QX5j08Hr
nbY3irfKdkEllAU2OORnAjlXDyCzcm2Z6ZRrGvtTZUAMelfU5PWS6XGEm3d4kJEK
bXi4Crl8o2E/E3YJPk1lQD1d0JTdrvZleETN1ViHZFSQwS3L94Woh0E3TPebaEYq
88eExvKu1tDdjSoFjBbgMezySnas5Nc2xF28XhPuC8m15u+dectsrJl+ALGcTDX3
Lv3FURuwV/dN7WMEkgcseIKVMdJxzUB0PeSqCNftfxmdBV/U4yXFRxPhnSFSXCrk
j6uJjickiYq1pQ1aZfrQe1eLD3MB2hKq7crhMcA3kpggQlnmy1wRR4BAttmSU4fP
b/yF8D3hAgMBAAECggEBAJdru6p5RLZ3h/GLF2rud8bqv4piF51e/RWQyPFnMAGB
rkByiYT7bFI3cnvJMhYpLHRigqjWfUofV3thRDDym54lVLtTRZ91khRMxgwVwdRu
k8Fw7JNFenOwCJxbgdlq6iuAMuQclwll7qWUrm8DgMvzH93xf8o6X171cp4Sh0og
1Ra7E9GZ37dzBlX2aJBK8VBfctZntuDPx52e71nafqfbjXxZuEtpu92oJd6A9mWb
d0BZTk72ZHUmDcKcqjfcEH19SWOphMJFYkxU5FRoIEr3/zisyTO4Mt33ZmwELOrY
9PdlyAAyed7ZoH+hlTr7c025QROvb2LmqgRiUT56tMECgYEA+jH5m6iMRK6XjiBh
SUnlr3DzRybwlQrtIj5sZprWe2my5uYHG3jbViYIO7GtQvMTnDrBCxNhuM6dPrL0
cRnbsp/iBMXe3pyjT/aWveBkn4R+UpBsnbtDn28r1MZpCDtr5UNc0TPj4KFJvjnV
/e8oGoyYEroECqcw1LqNOGDiLhkCgYEAwaemNePYrXW+MVX/hatfLQ96tpxwf7yu
HdENZ2q5AFw73GJWYvC8VY+TcoKPAmeoCUMltI3TrS6K5Q/GoLd5K2BsoJrSxQNQ
Fd3ehWAtdOuPDvQ5rn/2fsvgvc3rOvJh7uNnwEZCI/45WQg+UFWref4PPc+ArNtp
9Xj2y7LndwkCgYARojIQeXmhYZjG6JtSugWZLuHGkwUDzChYcIPdW25gdluokG/R
zNvQn4+W/XfTryQjr7RpXm1VxCIrCBvYWNU2KrSYV4XUtL+B5ERNj6In6AOrOAif
uVITy5cQQQeoD+AT4YKKMBkQfO2gnZzqb8+ox130e+3K/mufoqJPZeyrCQKBgC2f
objwhQvYwYY+DIUharri+rYrBRYTDbJYnh/PNOaw1CmHwXJt5PEDcml3+NlIMn58
I1X2U/hpDrAIl3MlxpZBkVYFI8LmlOeR7ereTddN59ZOE4jY/OnCfqA480Jf+FKf
oMHby5lPO5OOLaAfjtae1FhrmpUe3EfIx9wVuhKBAoGBAPFzHKQZbGhkqmyPW2ct
TEIWLdUHyO37fm8dj1WjN4wjRAI4ohNiKQJRh3QE11E1PzBTl9lZVWT8QtEsSjnr
A/tpGr378fcUT7WGBgTmBRaAnv1P1n/Tp0TSvh5XpIhhMuxcitIgrhYMIG3GbP9J
NAarxO/qPW6Gi0xWaF7il7Or
-----END PRIVATE KEY-----`;

type FetchLike = typeof fetch;

export type ParsedDramaboxEpisodePage = {
  bookId: string;
  chapterId: string;
};

export type ResolveDramaboxOptions = {
  bearerToken?: string;
  deviceId?: string;
  androidId?: string;
  userId?: string;
  afid?: string;
  instanceId?: string;
  cid?: string;
  mchid?: string;
  nchid?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export type DramaboxEpisodeInfo = {
  playUrl: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  quality?: number;
};

type VideoPathEntry = {
  quality?: number;
  videoPath?: string;
};

type CdnEntry = {
  cdnDomain?: string;
  isDefault?: number;
  videoPathList?: VideoPathEntry[];
};

type ChapterEntry = {
  chapterId?: string | number;
  chapterIndex?: number;
  isCharge?: number;
  cdnList?: CdnEntry[];
};

type BatchLoadData = {
  bookId?: string;
  chapterCount?: number;
  chapterList?: ChapterEntry[];
};

function customB64(data: Buffer, alphabet: string): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const n = Math.min(3, data.length - i);
    const c0 = data[i];
    const c1 = n > 1 ? data[i + 1] : 0;
    const c2 = n > 2 ? data[i + 2] : 0;
    const val = (c0 << 16) | (c1 << 8) | c2;
    out += alphabet[(val >> 18) & 63];
    out += alphabet[(val >> 12) & 63];
    if (n > 1) out += alphabet[(val >> 6) & 63];
    if (n > 2) out += alphabet[val & 63];
  }
  return out;
}

function djb2Translate(input: string, table: string, seed = 0x1505n): bigint {
  let h = seed & 0xffffffffffffffffn;
  const bytes = Buffer.from(input, 'utf8');
  for (const ch of bytes) {
    const idx = ch - 0x30;
    const v =
      idx >= 0 && idx <= 0x4a && idx < table.length
        ? table.charCodeAt(idx)
        : ch;
    h = (h + (h << 5n) + BigInt(v)) & 0xffffffffffffffffn;
  }
  return h;
}

/** Offline `st` header (native_sign_). */
export function signDramaboxSt(payload: string): string {
  const table0 = TRANSLATE_TABLES[0];
  const alph0 = table0.slice(0, 64);
  const prefix = customB64(Buffer.from('native_sign_', 'utf8'), alph0);
  let h = djb2Translate(payload, table0);
  const idx = Number(h & 0xffn) % 10;
  const table = TRANSLATE_TABLES[idx];
  const alph = table.slice(0, 64);
  h = djb2Translate(FIXED_PART, table, h);
  const packed = Buffer.from([
    0x00,
    0x01,
    Number((h >> 56n) & 0xffn),
    Number((h >> 48n) & 0xffn),
    Number((h >> 40n) & 0xffn),
    Number((h >> 32n) & 0xffn),
  ]);
  return prefix + customB64(packed, alph);
}

/** Offline `sn` header (SHA256withRSA). */
export function signDramaboxSn(payload: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(payload, 'utf8');
  signer.end();
  return signer.sign(SN_PRIVATE_KEY, 'base64');
}

export function buildDramaboxSignPayload(opts: {
  timestampMs: string | number;
  body: string;
  deviceId: string;
  androidId: string;
  tn: string;
}): string {
  return `timestamp=${opts.timestampMs}${opts.body}${opts.deviceId}${opts.androidId}${opts.tn}`;
}

/** Parse `/episode/{bookId}/{chapterId}` from a DramaBox page URL. */
export function parseDramaboxEpisodePage(
  pageUrl: string,
): ParsedDramaboxEpisodePage | null {
  if (!isDramaboxHost(pageUrl)) return null;
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const parts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const episodeIdx = parts.findIndex((p) => /^episode$/i.test(p));
  if (episodeIdx < 0 || episodeIdx + 2 >= parts.length) return null;
  // /episode/{bookId}/{chapterId} or /{lang}/episode/{bookId}/{chapterId}
  if (parts.length - episodeIdx !== 3) return null;

  const bookId = String(parts[episodeIdx + 1] || '').trim();
  const chapterId = String(parts[episodeIdx + 2] || '').trim();
  if (!/^\d{6,24}$/.test(bookId) || !/^\d{6,24}$/.test(chapterId)) return null;
  return { bookId, chapterId };
}

function envTrim(name: string): string {
  return String(process.env[name] || '').trim();
}

function normalizeBearer(token: string): string {
  const t = token.trim();
  if (!t) return '';
  return /^Bearer\s+/i.test(t) ? t : `Bearer ${t}`;
}

function localTimeHeader(now = new Date()): string {
  // App sends +0700 wall clock; offset does not affect signing payload.
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  const shifted = new Date(now.getTime() + offsetMin * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}.${String(shifted.getUTCMilliseconds()).padStart(3, '0')} ${sign}${oh}${om}`;
}

function resolveSession(options: ResolveDramaboxOptions): {
  tn: string;
  deviceId: string;
  androidId: string;
  userId: string;
  afid: string;
  instanceId: string;
  cid: string;
  mchid: string;
  nchid: string;
} {
  const tn = normalizeBearer(
    options.bearerToken !== undefined
      ? options.bearerToken
      : envTrim('DRAMABOX_BEARER_TOKEN'),
  );
  const deviceId =
    options.deviceId?.trim() || envTrim('DRAMABOX_DEVICE_ID');
  const androidId =
    options.androidId?.trim() || envTrim('DRAMABOX_ANDROID_ID');
  if (!tn) {
    throw new Error(
      '缺少 DramaBox VIP 会话：请配置 DRAMABOX_BEARER_TOKEN（或传入 bearerToken）',
    );
  }
  if (!deviceId || !androidId) {
    throw new Error(
      '缺少 DramaBox 设备标识：请配置 DRAMABOX_DEVICE_ID 与 DRAMABOX_ANDROID_ID',
    );
  }
  return {
    tn,
    deviceId,
    androidId,
    userId:
      options.userId?.trim() || envTrim('DRAMABOX_USER_ID') || '0',
    afid: options.afid?.trim() || envTrim('DRAMABOX_AFID') || `${Date.now()}-0`,
    instanceId:
      options.instanceId?.trim() ||
      envTrim('DRAMABOX_INSTANCE_ID') ||
      randomUUID().replace(/-/g, ''),
    cid: options.cid?.trim() || envTrim('DRAMABOX_CID') || 'DASEO1000000',
    mchid:
      options.mchid?.trim() || envTrim('DRAMABOX_MCHID') || 'DASEO1000000',
    nchid: options.nchid?.trim() || envTrim('DRAMABOX_NCHID') || 'DRA1000042',
  };
}

function pickPlayUrl(chapter: ChapterEntry): { playUrl: string; quality?: number } | null {
  const cdns = Array.isArray(chapter.cdnList) ? chapter.cdnList : [];
  const ordered = [...cdns].sort(
    (a, b) => Number(b.isDefault === 1) - Number(a.isDefault === 1),
  );
  let best: { playUrl: string; quality: number } | null = null;
  for (const cdn of ordered) {
    const list = Array.isArray(cdn.videoPathList) ? cdn.videoPathList : [];
    for (const entry of list) {
      const playUrl = String(entry.videoPath || '').trim();
      if (!/^https?:\/\//i.test(playUrl)) continue;
      const quality = Number(entry.quality) || 0;
      if (!best || quality > best.quality) {
        best = { playUrl, quality };
      }
    }
    if (best && Number(cdn.isDefault) === 1) break;
  }
  return best;
}

function resolveDramaboxCurlProxy(): string | undefined {
  const raw = envTrim('DRAMABOX_HTTPS_PROXY') || envTrim('HTTPS_PROXY');
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DRAMABOX_HTTPS_PROXY 不是合法 URL');
  }
  const protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (
    protocol !== 'http' &&
    protocol !== 'https' &&
    protocol !== 'socks5' &&
    protocol !== 'socks5h' &&
    protocol !== 'socks4'
  ) {
    throw new Error(
      `DRAMABOX_HTTPS_PROXY 协议不支持: ${protocol}（可用 http/https/socks5/socks5h）`,
    );
  }
  return raw;
}

async function postViaCurl(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  const args = [
    '-sS',
    '-w',
    '\n__CURL_HTTP_STATUS__:%{http_code}',
    '--compressed',
    '-X',
    'POST',
    url,
    '--max-time',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
  ];
  const proxy = resolveDramaboxCurlProxy();
  if (proxy) {
    args.push('-x', proxy);
  }
  for (const [key, value] of Object.entries(headers)) {
    args.push('-H', `${key}: ${value}`);
  }
  args.push('--data-binary', body);

  let stdout = '';
  try {
    const result = await execFileAsync('curl', args, {
      encoding: 'utf8',
      maxBuffer: MAX_RESPONSE_CHARS + 64,
      windowsHide: true,
    });
    stdout = String(result.stdout || '');
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    stdout = String(err.stdout || '');
    if (!stdout) {
      throw new Error(
        `DramaBox curl 请求失败: ${err.stderr || err.message || error}`.slice(
          0,
          300,
        ),
      );
    }
  }

  const marker = '\n__CURL_HTTP_STATUS__:';
  const idx = stdout.lastIndexOf(marker);
  if (idx < 0) {
    throw new Error('DramaBox curl 未返回 HTTP 状态码');
  }
  const text = stdout.slice(0, idx);
  const status = Number(stdout.slice(idx + marker.length).trim());
  if (!Number.isFinite(status)) {
    throw new Error('DramaBox curl HTTP 状态码无效');
  }
  return { status, text };
}

async function postBatchLoad(
  bodyObj: Record<string, unknown>,
  session: ReturnType<typeof resolveSession>,
  opts: { fetchImpl?: FetchLike; timeoutMs: number; startUpKey: string },
): Promise<BatchLoadData> {
  const body = JSON.stringify(bodyObj);
  const timestampMs = String(Date.now());
  const signPayload = buildDramaboxSignPayload({
    timestampMs,
    body,
    deviceId: session.deviceId,
    androidId: session.androidId,
    tn: session.tn,
  });
  const sn = signDramaboxSn(signPayload);
  const st = signDramaboxSt(signPayload);
  const url = `${API_HOST}${BATCH_LOAD_PATH}?timestamp=${timestampMs}`;

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=UTF-8',
    accept: 'application/json',
    'accept-encoding': 'gzip',
    'user-agent': 'okhttp/4.12.0',
    version: '650',
    vn: '6.5.0',
    p: '70',
    apn: '2',
    pline: 'ANDROID',
    'package-name': 'com.storymatrix.drama',
    language: 'zh',
    'current-language': 'en',
    locale: 'zh_TW',
    'country-code': 'VN',
    tz: '-420',
    'time-zone': '+0700',
    'local-time': localTimeHeader(),
    'device-id': session.deviceId,
    'android-id': session.androidId,
    userid: session.userId,
    afid: session.afid,
    instanceid: session.instanceId,
    cid: session.cid,
    mchid: session.mchid,
    nchid: session.nchid,
    'over-flow': 'new-fly',
    'store-source': 'store_google',
    brand: 'OPPO',
    md: 'PHM110',
    mf: 'OPPO',
    ov: '14',
    srn: '1080x1920',
    build: 'Build/UQ1A.240205.07131809',
    'device-score': '70',
    mbid: '0',
    lat: '0',
    installtime: envTrim('DRAMABOX_INSTALL_TIME') || String(Date.now() - 86_400_000),
    'active-time': '1000',
    externalbillingavailable: '0',
    tn: session.tn,
    sn,
    st,
  };

  let status: number;
  let text: string;
  if (opts.fetchImpl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await opts.fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    status = res.status;
    text = await res.text();
  } else {
    ({ status, text } = await postViaCurl(url, headers, body, opts.timeoutMs));
  }

  if (text.length > MAX_RESPONSE_CHARS) {
    throw new Error('DramaBox 响应过长');
  }
  if (status < 200 || status >= 300) {
    throw new Error(`DramaBox HTTP ${status}: ${text.slice(0, 200)}`);
  }

  let parsed: {
    data?: BatchLoadData;
    status?: number | string;
    message?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`DramaBox 响应不是 JSON: ${text.slice(0, 120)}`);
  }
  const apiStatus = parsed.status;
  if (
    apiStatus !== undefined &&
    apiStatus !== 0 &&
    apiStatus !== '0' &&
    apiStatus !== 200 &&
    apiStatus !== '200'
  ) {
    throw new Error(
      `DramaBox API 错误: ${parsed.message || apiStatus}`.slice(0, 200),
    );
  }
  if (typeof parsed.data !== 'object' || !parsed.data) {
    if (Array.isArray((parsed as BatchLoadData).chapterList)) {
      return parsed as BatchLoadData;
    }
    throw new Error(`DramaBox 鉴权或业务失败: ${text.slice(0, 200)}`);
  }
  return parsed.data;
}

function findChapter(
  list: ChapterEntry[] | undefined,
  chapterId: string,
): ChapterEntry | null {
  if (!Array.isArray(list)) return null;
  return (
    list.find((ch) => String(ch.chapterId || '').trim() === chapterId) || null
  );
}

/** Resolve a DramaBox episode page to a signed CDN `.encrypt.mp4` URL. */
export async function resolveDramaboxPlayUrl(
  pageUrl: string,
  options: ResolveDramaboxOptions = {},
): Promise<DramaboxEpisodeInfo> {
  const parsedPage = parseDramaboxEpisodePage(pageUrl);
  if (!parsedPage) {
    throw new Error('无法从 DramaBox URL 解析 bookId / chapterId');
  }

  const fetchImpl = options.fetchImpl;
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(60_000, Math.max(1_000, requestedTimeout))
    : 15_000;
  const session = resolveSession(options);
  const startUpKey = randomUUID();

  let index = 0;
  let loadDirection = 0;
  let seen = 0;
  const chapterCountHint = 200;
  const visitedIndexes = new Set<number>();

  for (let page = 0; page < MAX_CHAPTER_PAGES; page++) {
    if (visitedIndexes.has(index) && page > 0) break;
    visitedIndexes.add(index);

    const body: Record<string, unknown> = {
      boundaryIndex: 0,
      comingPlaySectionId: -1,
      index,
      currencyPlaySource: 'discover_267_rec',
      needEndRecommend: 0,
      currencyPlaySourceName: '首页发现_Popular_推荐列表',
      preLoad: false,
      rid: '',
      pullCid: '',
      loadDirection,
      startUpKey,
      bookId: parsedPage.bookId,
    };
    if (page > 0) {
      body.enterReaderChapterIndex = 0;
    }

    const data = await postBatchLoad(body, session, {
      fetchImpl,
      timeoutMs,
      startUpKey,
    });
    const list = Array.isArray(data.chapterList) ? data.chapterList : [];
    const hit = findChapter(list, parsedPage.chapterId);
    if (hit) {
      const picked = pickPlayUrl(hit);
      if (!picked) {
        throw new Error(
          `DramaBox 第 ${Number(hit.chapterIndex) + 1 || '?'} 集无可用 videoPath（可能未解锁 VIP）`,
        );
      }
      return {
        playUrl: picked.playUrl,
        bookId: parsedPage.bookId,
        chapterId: parsedPage.chapterId,
        chapterIndex: Number(hit.chapterIndex) || 0,
        quality: picked.quality,
      };
    }

    if (!list.length) break;
    seen += list.length;
    const last = list[list.length - 1];
    const lastIndex = Number(last.chapterIndex);
    const total = Number(data.chapterCount) || chapterCountHint;
    if (!Number.isFinite(lastIndex) || lastIndex + 1 >= total || seen >= total) {
      break;
    }
    index = lastIndex + 1;
    loadDirection = 2;
  }

  throw new Error(
    `DramaBox 未找到 chapterId=${parsedPage.chapterId}（bookId=${parsedPage.bookId}）`,
  );
}

export function isDramaboxCdnPlayUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === 'hwztvideo.dramaboxdb.com' ||
      host.endsWith('.dramaboxdb.com') ||
      host.endsWith('.dramabox.com')
    );
  } catch {
    return false;
  }
}
