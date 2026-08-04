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

export function isAdminHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return hostOf(hostname) === hostOf(ADMIN_HOST);
}

export function isWebHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return hostOf(hostname) === hostOf(WEB_HOST);
}

export function isLocalHost(hostname: string | null | undefined): boolean {
  if (!hostname) return true;
  const h = hostOf(hostname);
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0";
}
