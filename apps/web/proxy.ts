import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_ORIGIN,
  isAdminHost,
  isLocalHost,
  isWebHost,
} from "@/lib/site";
import { localeFromAcceptLanguage } from "@/lib/languages";
import {
  checkLiveDrama,
  LIVE_DRAMA_CHECKED_HEADER,
} from "@/lib/live-drama";

/**
 * 管理端已拆至独立应用 apps/admin（生产：admin.velvetmovie.space）。
 * 本中间件仅：
 * - 用户域访问 /admin|/ops|/console → 跳转管理端域名
 * - 误把管理域指到本应用时 → 跳转 ADMIN_ORIGIN
 * - 已删/下架短剧 document 请求 → 硬 404
 * - 首次访问若 Accept-Language 有值则写入 dv_locale（避免 SSR/CSR 语言不一致）；
 *   AL 为空时不写 cookie，留给客户端用 navigator.language，最终仍回退到 en。
 *
 * 界面语言只由 dv_locale cookie 承载（layout SSR 读取 + i18n 读写 + api 的
 * Accept-Language）。这里刻意不做 /zh|/en|/fr 路径前缀 rewrite：应用侧从不生成
 * 前缀链接，而 usePathname() 返回的是地址栏路径，前缀会让 app-shell / navbar /
 * bottom-tab-bar 的路径判断整体失配（例：/zh/drama/x 会多渲染底部导航栏）。
 * 若将来要做分语言 SEO，应连同前缀链接生成 + pathname 归一化 + hreflang 一起建。
 */
const ADMIN_PREFIXES = ["/admin", "/ops", "/console"];

function localeCookie(res: NextResponse, locale: string) {
  res.cookies.set("dv_locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
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

function hostRedirects(req: NextRequest, pathname: string): NextResponse | null {
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase() || "";
  const { search } = req.nextUrl;

  // 本地：/admin* → 独立管理端 :3001
  if (isLocalHost(host)) {
    if (isAdminPath(pathname)) {
      const dest = mapAdminPath(pathname);
      const localAdmin =
        process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3001";
      return NextResponse.redirect(`${localAdmin.replace(/\/$/, "")}${dest}${search}`, 308);
    }
    return null;
  }

  if (isWebHost(host)) {
    if (isAdminPath(pathname)) {
      const dest = mapAdminPath(pathname);
      return NextResponse.redirect(`${ADMIN_ORIGIN}${dest}${search}`, 308);
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

function withDefaultLocaleCookie(req: NextRequest, res: NextResponse) {
  if (req.cookies.get("dv_locale")?.value) return res;
  const acceptLanguage = req.headers.get("accept-language");
  // Empty AL is common on some mobile WebViews — do not stamp en and block navigator.
  if (!acceptLanguage?.trim()) return res;
  localeCookie(res, localeFromAcceptLanguage(acceptLanguage));
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const redirected = hostRedirects(req, pathname);
  if (redirected) return redirected;

  // Hard-404 missing / offline dramas (App Router page notFound() alone stays HTTP 200 under streaming).
  // On exists/unavailable, mark the request so the page skips a duplicate upstream probe.
  let requestHeaders: Headers | undefined;
  const dramaMatch = pathname.match(/^\/drama\/([^/]+)(?:\/play)?\/?$/);
  if (dramaMatch) {
    const presence = await checkLiveDrama(dramaMatch[1]);
    if (presence === "missing") {
      const url = req.nextUrl.clone();
      url.pathname = "/__drama_missing__";
      return withDefaultLocaleCookie(req, NextResponse.rewrite(url));
    }
    requestHeaders = new Headers(req.headers);
    requestHeaders.set(LIVE_DRAMA_CHECKED_HEADER, "1");
  }

  const passThrough = requestHeaders
    ? { request: { headers: requestHeaders } }
    : undefined;

  return withDefaultLocaleCookie(req, NextResponse.next(passThrough));
}

export const config = {
  // Locale cookie, admin host redirects, drama hard-404 — not API proxy or static assets.
  matcher: [
    "/((?!api|_next|favicon\\.ico|favicon\\.png|favicon-32\\.png|apple-touch-icon\\.png|sw\\.js|logo\\.webp|logo\\.png|logo@2x\\.png|splash-preview\\.html|covers(?:/|$)).*)",
  ],
};
