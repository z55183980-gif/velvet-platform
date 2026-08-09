import * as dns from 'dns/promises';
import { isIP } from 'net';
import { BizException, BizCode } from './biz.exception';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

export function isPrivateOrReservedIp(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(normalized.slice('::ffff:'.length));
  }
  if (isIP(normalized) === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized)
    );
  }
  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function hostAllowedForMediaFetch(
  hostname: string,
  allowHosts: string[],
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === 'metadata.google.internal') return false;
  if (!allowHosts.length) return false;
  return allowHosts.some((allowed) => {
    const a = allowed.toLowerCase().replace(/\.$/, '');
    return host === a || host.endsWith(`.${a}`);
  });
}

export async function assertSafeHttpUrl(
  url: string,
  opts: { allowHosts: string[] },
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BizException(BizCode.FORBIDDEN, 'fetch.invalidUrl');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BizException(BizCode.FORBIDDEN, 'fetch.protocolDenied');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostAllowedForMediaFetch(hostname, opts.allowHosts)) {
    throw new BizException(BizCode.FORBIDDEN, 'fetch.hostDenied');
  }
  let addresses: string[];
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : (await dns.lookup(hostname, { all: true, verbatim: true })).map((e) => e.address);
  } catch {
    throw new BizException(BizCode.FORBIDDEN, 'fetch.dnsFailed');
  }
  if (!addresses.length || addresses.some((a) => isPrivateOrReservedIp(a))) {
    throw new BizException(BizCode.FORBIDDEN, 'fetch.privateIpDenied');
  }
  return parsed;
}

export type SafeTextFetchOpts = {
  allowHosts: string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  acceptContentTypes?: RegExp;
  /** When true, body must contain #EXTM3U (HLS playlist). */
  requireM3u8?: boolean;
  fetchImpl?: typeof fetch;
  userAgent?: string;
};

/**
 * SSRF-safe text fetch: host allowlist, DNS private-IP block, redirect limit,
 * timeout, max body size, optional content-type check.
 */
export async function safeFetchText(
  url: string,
  opts: SafeTextFetchOpts,
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const fetchFn = opts.fetchImpl || fetch;

  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeHttpUrl(current, { allowHosts: opts.allowHosts });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchFn(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: {
          'User-Agent': opts.userAgent || 'VelvetSafeFetch/1.0',
          Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
        },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        if (!loc) throw new BizException(BizCode.FORBIDDEN, 'fetch.redirectMissing');
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) {
        throw new BizException(BizCode.NOT_FOUND, 'preview.sourceUnavailable');
      }
      const ctype = String(res.headers.get('content-type') || '').toLowerCase();
      if (opts.acceptContentTypes && ctype && !opts.acceptContentTypes.test(ctype)) {
        throw new BizException(BizCode.FORBIDDEN, 'fetch.contentTypeDenied');
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) {
        throw new BizException(BizCode.FORBIDDEN, 'fetch.bodyTooLarge');
      }
      const text = buf.toString('utf8');
      if (opts.requireM3u8 && !text.includes('#EXTM3U')) {
        throw new BizException(BizCode.FORBIDDEN, 'fetch.notM3u8');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new BizException(BizCode.FORBIDDEN, 'fetch.tooManyRedirects');
}

/** Build allowlist from CDN base + optional comma-separated MEDIA_FETCH_ALLOW_HOSTS. */
export function mediaFetchAllowHosts(cdnBaseUrl?: string | null): string[] {
  const hosts = new Set<string>();
  const cdn = String(cdnBaseUrl || '').trim();
  if (cdn) {
    try {
      hosts.add(new URL(cdn).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  const extra = String(process.env.MEDIA_FETCH_ALLOW_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const h of extra) hosts.add(h);
  // Default production CDN
  hosts.add('cdn.velvetmovie.space');
  return [...hosts];
}
