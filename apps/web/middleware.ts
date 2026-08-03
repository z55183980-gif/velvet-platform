import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_ORIGIN,
  isAdminHost,
  isLocalHost,
  isWebHost,
  WEB_ORIGIN,
} from "@/lib/site";

/**
 * 公开入口：NEXT_PUBLIC_ADMIN_BASE_PATH（默认 /admin）
 * 同时兼容 /ops、/console 作为别名（rewrite 到 app/admin）。
 *
 * 生产域名分流：
 * - 用户端 velvet.slc8.com → 观众/创作者；访问 /admin 跳转到管理端域名
 * - 管理端 velvetadmin.slc8.com → 管理后台；根路径进 /admin
 *
 * Locale URL 前缀：
 * - `/zh` `/en` `/fr` `/ru` `/vi`（及子路径）→ rewrite 去掉前缀，并设置 dv_locale
 * 实际页面仍为无前缀路由；LocaleProvider 会读取 cookie 同步客户端语言。
 */
function publicBase(): string {
  const raw = (process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "/admin").trim();
  let s = raw.startsWith("/") ? raw : `/${raw}`;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  if (s === "/") return "/admin";
  return s;
}

const ALIASES = ["/ops", "/console"];
const LOCALE_PREFIXES = ["zh", "en", "fr", "ru", "vi"] as const;

function tryRewrite(pathname: string, prefix: string): string | null {
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    const rest = pathname.slice(prefix.length) || "";
    return `/admin${rest}`;
  }
  return null;
}

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

function isPassthroughPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.svg" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  );
}

function hostRedirects(req: NextRequest): NextResponse | null {
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase() || "";
  if (isLocalHost(host)) return null;

  const { pathname, search } = req.nextUrl;
  const base = publicBase();

  // 用户端：/admin（及别名）→ 管理端域名
  if (isWebHost(host)) {
    const adminPrefixes = [base, "/admin", ...ALIASES];
    for (const p of adminPrefixes) {
      if (pathname === p || pathname.startsWith(`${p}/`)) {
        const rest = pathname === p ? "" : pathname.slice(p.length);
        const target = `${ADMIN_ORIGIN}${base}${rest}${search}`;
        return NextResponse.redirect(target, 308);
      }
    }
    return null;
  }

  // 管理端：根路径 → /admin；非后台路径回用户端
  if (isAdminHost(host)) {
    if (isPassthroughPath(pathname)) return null;

    if (pathname === "/") {
      return NextResponse.redirect(`${ADMIN_ORIGIN}${base}${search}`, 308);
    }

    const onAdmin =
      pathname === base ||
      pathname.startsWith(`${base}/`) ||
      pathname === "/admin" ||
      pathname.startsWith("/admin/") ||
      ALIASES.some((a) => pathname === a || pathname.startsWith(`${a}/`));

    if (!onAdmin) {
      return NextResponse.redirect(`${WEB_ORIGIN}${pathname}${search}`, 308);
    }
  }

  return null;
}

export function middleware(req: NextRequest) {
  const redirected = hostRedirects(req);
  if (redirected) return redirected;

  const { pathname } = req.nextUrl;

  for (const prefix of LOCALE_PREFIXES) {
    const rewritten = localeRewrite(req, prefix);
    if (rewritten) return rewritten;
  }

  const base = publicBase();

  if (base !== "/admin") {
    const target = tryRewrite(pathname, base);
    if (target) {
      const url = req.nextUrl.clone();
      url.pathname = target;
      return NextResponse.rewrite(url);
    }
  }

  for (const alias of ALIASES) {
    if (alias === base) continue;
    const target = tryRewrite(pathname, alias);
    if (target) {
      const url = req.nextUrl.clone();
      url.pathname = target;
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Host 分流需要匹配大部分路径；静态资源与 Next 内部路径在 middleware 内放行。
     */
    "/((?!_next/static|_next/image).*)",
  ],
};
