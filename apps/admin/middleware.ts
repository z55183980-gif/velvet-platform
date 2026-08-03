import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Legacy /admin|/ops|/console bookmarks → root routes */
const LEGACY = ["/admin", "/ops", "/console"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  for (const p of LEGACY) {
    if (pathname === p) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url, 308);
    }
    if (pathname.startsWith(`${p}/`)) {
      const url = req.nextUrl.clone();
      url.pathname = pathname.slice(p.length) || "/dashboard";
      return NextResponse.redirect(url, 308);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/ops/:path*", "/console/:path*"],
};
