import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_ORIGIN,
  isAdminHost,
  isLocalHost,
  isWebHost,
} from "@/lib/site";
import { localeFromAcceptLanguage } from "@/lib/languages";

/**
 * 管理端已拆至独立应用 apps/admin（生产：admin.velvetmovie.space）。
 * 本中间件仅：
 * - 用户域访问 /admin|/ops|/console（含 /zh|/en|/fr 前缀）→ 跳转管理端域名
 * - 误把管理域指到本应用时 → 跳转 ADMIN_ORIGIN
 * - locale 前缀 rewrite
 * - 首次访问根据 Accept-Language 写入 dv_locale（避免 SSR/CSR 语言不一致）
 */
const ADMIN_PREFIXES = ["/admin", "/ops", "/console"];
const LOCALE_PREFIXES = ["zh", "en", "fr"] as const;

function localeCookie(res: NextResponse, locale: string) {
  res.cookies.set("dv_locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

/** Strip /zh|/en|/fr prefix; returns unprefixed path + optional locale. */
function stripLocalePrefix(pathname: string): {
  pathname: string;
  locale: (typeof LOCALE_PREFIXES)[number] | null;
} {
  for (const prefix of LOCALE_PREFIXES) {
    const root = `/${prefix}`;
    if (pathname === root || pathname.startsWith(`${root}/`)) {
      const rest = pathname.slice(root.length) || "/";
      return {
        pathname: rest.startsWith("/") ? rest : `/${rest}`,
        locale: prefix,
      };
    }
  }
  return { pathname, locale: null };
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

function isAdminPath(pathname: string): boolean {
  return ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function hostRedirects(req: NextRequest, logicalPathname: string): NextResponse | null {
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase() || "";
  const { search } = req.nextUrl;

  // 本地：/admin* → 独立管理端 :3001
  if (isLocalHost(host)) {
    if (isAdminPath(logicalPathname)) {
      const dest = mapAdminPath(logicalPathname);
      const localAdmin =
        process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3001";
      return NextResponse.redirect(`${localAdmin.replace(/\/$/, "")}${dest}${search}`, 308);
    }
    return null;
  }

  if (isWebHost(host)) {
    if (isAdminPath(logicalPathname)) {
      const dest = mapAdminPath(logicalPathname);
      return NextResponse.redirect(`${ADMIN_ORIGIN}${dest}${search}`, 308);
    }
    return null;
  }

  // 管理域若仍指向 web 构建，整站跳到独立管理端
  if (isAdminHost(host)) {
    const dest = mapAdminPath(logicalPathname === "/" ? "/admin" : logicalPathname);
    return NextResponse.redirect(`${ADMIN_ORIGIN}${dest}${search}`, 308);
  }

  return null;
}

function withDefaultLocaleCookie(req: NextRequest, res: NextResponse) {
  if (req.cookies.get("dv_locale")?.value) return res;
  const locale = localeFromAcceptLanguage(req.headers.get("accept-language"));
  localeCookie(res, locale);
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname: logicalPath, locale } = stripLocalePrefix(req.nextUrl.pathname);

  // Admin redirects use the unprefixed path so /zh/admin → admin host (not 404).
  const redirected = hostRedirects(req, logicalPath);
  if (redirected) {
    if (locale) localeCookie(redirected, locale);
    return redirected;
  }

  // Locale-prefixed consumer URLs → rewrite to unprefixed app routes.
  if (locale) {
    const url = req.nextUrl.clone();
    url.pathname = logicalPath;
    const res = NextResponse.rewrite(url);
    localeCookie(res, locale);
    return res;
  }

  return withDefaultLocaleCookie(req, NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
