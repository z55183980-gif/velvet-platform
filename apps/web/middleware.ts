import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_ORIGIN,
  isAdminHost,
  isLocalHost,
  isWebHost,
} from "@/lib/site";

/**
 * 管理端已拆至独立应用 apps/admin（生产：admin.velvetmovie.space）。
 * 本中间件仅：
 * - 用户域访问 /admin|/ops|/console → 跳转管理端域名
 * - 误把管理域指到本应用时 → 跳转 ADMIN_ORIGIN
 * - locale 前缀 rewrite
 */
const ADMIN_PREFIXES = ["/admin", "/ops", "/console"];
const LOCALE_PREFIXES = ["zh", "en", "fr", "ru", "vi"] as const;

function localeRewrite(
  req: NextRequest,
  prefix: (typeof LOCALE_PREFIXES)[number],
): NextResponse | null {
  const { pathname } = req.nextUrl;
  const root = `/${prefix}`;
  if (pathname !== root && !pathname.startsWith(`${root}/`)) return null;

  const url = req.nextUrl.clone();
  const rest = pathname.slice(root.length) || "/";
  url.pathname = rest.startsWith("/") ? rest : `/${rest}`;

  const res = NextResponse.rewrite(url);
  res.cookies.set("dv_locale", prefix, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}

function mapAdminPath(pathname: string): string {
  for (const p of ADMIN_PREFIXES) {
    if (pathname === p) return "/dashboard";
    if (pathname.startsWith(`${p}/`)) {
      const rest = pathname.slice(p.length);
      return rest.startsWith("/") ? rest : `/${rest}`;
    }
  }
  return pathname;
}

function hostRedirects(req: NextRequest): NextResponse | null {
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase() || "";
  const { pathname, search } = req.nextUrl;

  // 本地：/admin* → 独立管理端 :3001
  if (isLocalHost(host)) {
    for (const p of ADMIN_PREFIXES) {
      if (pathname === p || pathname.startsWith(`${p}/`)) {
        const dest = mapAdminPath(pathname);
        const localAdmin =
          process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3001";
        return NextResponse.redirect(`${localAdmin.replace(/\/$/, "")}${dest}${search}`, 308);
      }
    }
    return null;
  }

  if (isWebHost(host)) {
    for (const p of ADMIN_PREFIXES) {
      if (pathname === p || pathname.startsWith(`${p}/`)) {
        const dest = mapAdminPath(pathname);
        return NextResponse.redirect(`${ADMIN_ORIGIN}${dest}${search}`, 308);
      }
    }
    return null;
  }

  // 管理域若仍指向 web 构建，整站跳到独立管理端
  if (isAdminHost(host)) {
    const dest = mapAdminPath(pathname === "/" ? "/admin" : pathname);
    return NextResponse.redirect(`${ADMIN_ORIGIN}${dest}${search}`, 308);
  }

  return null;
}

export function middleware(req: NextRequest) {
  const redirected = hostRedirects(req);
  if (redirected) return redirected;

  for (const prefix of LOCALE_PREFIXES) {
    const rewritten = localeRewrite(req, prefix);
    if (rewritten) return rewritten;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
