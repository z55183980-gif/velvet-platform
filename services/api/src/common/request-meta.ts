import type { Request } from 'express';

export type ClientMeta = {
  ipAddress: string | null;
  country: string | null;
  city: string | null;
  userAgent: string | null;
};

function header(req: Request, name: string): string | null {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return String(raw[0] || '').trim() || null;
  if (typeof raw === 'string') return raw.trim() || null;
  return null;
}

function firstForwardedIp(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

export function isPrivateOrLocalIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/i, '').toLowerCase();
  if (v === '::1' || v === 'localhost') return true;
  if (v.startsWith('127.') || v.startsWith('10.') || v.startsWith('192.168.') || v.startsWith('169.254.')) {
    return true;
  }
  const m = /^172\.(\d+)\./.exec(v);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

/** Extract client IP / geo from proxy headers (Cloudflare, Vercel, X-Forwarded-For). */
export function getClientMeta(req: Request): ClientMeta {
  const ipAddress =
    firstForwardedIp(header(req, 'cf-connecting-ip')) ||
    firstForwardedIp(header(req, 'true-client-ip')) ||
    firstForwardedIp(header(req, 'x-real-ip')) ||
    firstForwardedIp(header(req, 'x-forwarded-for')) ||
    (typeof req.ip === 'string' ? req.ip : null) ||
    (req.socket?.remoteAddress ?? null);

  let country =
    header(req, 'cf-ipcountry') ||
    header(req, 'x-vercel-ip-country') ||
    header(req, 'x-forwarded-for-country') ||
    null;
  if (country === 'XX' || country === 'T1') country = null;

  const city =
    header(req, 'x-vercel-ip-city') ||
    header(req, 'cf-ipcity') ||
    header(req, 'x-city') ||
    null;

  const userAgent = header(req, 'user-agent');

  if (isPrivateOrLocalIp(ipAddress) && !country) {
    return {
      ipAddress: ipAddress ? ipAddress.replace(/^::ffff:/i, '') : null,
      country: 'LOCAL',
      city: city,
      userAgent,
    };
  }

  return {
    ipAddress: ipAddress ? ipAddress.replace(/^::ffff:/i, '') : null,
    country,
    city: city ? decodeURIComponent(city) : null,
    userAgent,
  };
}

/** Soft enrich missing country/city via ip-api.com (login-time only; fail soft). */
export async function enrichClientMeta(meta: ClientMeta): Promise<ClientMeta> {
  if (meta.country && meta.city) return meta;
  const ip = meta.ipAddress;
  if (!ip || isPrivateOrLocalIp(ip) || meta.country === 'LOCAL') return meta;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,city`,
      { signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return meta;
    const data = (await res.json()) as {
      status?: string;
      countryCode?: string;
      city?: string;
    };
    if (data.status !== 'success') return meta;
    return {
      ...meta,
      country: meta.country || data.countryCode || null,
      city: meta.city || data.city || null,
    };
  } catch {
    return meta;
  }
}
