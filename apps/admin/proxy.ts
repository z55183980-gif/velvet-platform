import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Legacy /admin|/ops|/console bookmarks → root routes */
const LEGACY = ["/admin", "/ops", "/console"];

function createNonce(): string {
  return btoa(crypto.randomUUID()).replace(/=+$/g, "");
}

/** Admin CSP — tighter than web (no Stripe/Google checkout frames). */
function buildContentSecurityPolicy(nonce: string): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "https://static.cloudflareinsights.com",
  ];
  if (process.env.NODE_ENV !== "production") scriptSrc.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self'",
    "form-action 'self'",
    process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function withContentSecurityPolicy(res: NextResponse, policy: string): NextResponse {
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = createNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  for (const p of LEGACY) {
    if (pathname === p) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      return withContentSecurityPolicy(
        NextResponse.redirect(url, 308),
        contentSecurityPolicy,
      );
    }
    if (pathname.startsWith(`${p}/`)) {
      const url = req.nextUrl.clone();
      url.pathname = pathname.slice(p.length) || "/dashboard";
      return withContentSecurityPolicy(
        NextResponse.redirect(url, 308),
        contentSecurityPolicy,
      );
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return withContentSecurityPolicy(response, contentSecurityPolicy);
}

export const config = {
  matcher: [
    "/((?!api|_next|favicon\\.ico|favicon\\.svg|.*\\.(?:png|jpg|jpeg|gif|webp|ico|svg)$).*)",
  ],
};
