/**
 * Production / deploy hostnames.
 * Localhost is used when these are unset (dev).
 */
export const WEB_HOST = (
  process.env.NEXT_PUBLIC_WEB_HOST || "velvetmovie.space"
).trim().toLowerCase();

export const ADMIN_HOST = (
  process.env.NEXT_PUBLIC_ADMIN_HOST || "admin.velvetmovie.space"
).trim().toLowerCase();

export const WEB_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL || `https://${WEB_HOST}`
).replace(/\/$/, "");

export const ADMIN_ORIGIN = (
  process.env.NEXT_PUBLIC_ADMIN_URL || `https://${ADMIN_HOST}`
).replace(/\/$/, "");

function hostOf(originOrHost: string): string {
  const s = originOrHost.trim().toLowerCase();
  try {
    if (s.includes("://")) return new URL(s).hostname;
  } catch {
    /* ignore */
  }
  return s.split("/")[0].split(":")[0];
}

/** `www.` is an alias of the apex, not a separate site. */
function stripWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

export function isAdminHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return hostOf(hostname) === hostOf(ADMIN_HOST);
}

/** Apex + `www.` alias both count as the consumer site. */
export function isWebHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return stripWww(hostOf(hostname)) === stripWww(hostOf(WEB_HOST));
}

export function isLocalHost(hostname: string | null | undefined): boolean {
  if (!hostname) return true;
  const h = hostOf(hostname);
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "[::1]") {
    return true;
  }
  // 私网 IP：手机通过局域网访问本地 dev
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}
