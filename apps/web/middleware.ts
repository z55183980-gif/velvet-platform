import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 公开入口：NEXT_PUBLIC_ADMIN_BASE_PATH（默认 /admin）
 * 同时兼容 /ops、/console 作为别名（rewrite 到 app/admin）。
 *
 * Locale URL 前缀（docs/01 §3.5）：
 * - `/zh`、`/zh/*` → rewrite 到去掉前缀的路径，并设置 dv_locale=zh
 * - `/vi`、`/vi/*` → 同理（vi）
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

function tryRewrite(pathname: string, prefix: string): string | null {
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    const rest = pathname.slice(prefix.length) || "";
    return `/admin${rest}`;
  }
  return null;
}

function localeRewrite(req: NextRequest, prefix: "zh" | "vi"): NextResponse | null {
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const zh = localeRewrite(req, "zh");
  if (zh) return zh;
  const vi = localeRewrite(req, "vi");
  if (vi) return vi;

  const base = publicBase();

  // 主入口若不是 /admin，则 rewrite
  if (base !== "/admin") {
    const target = tryRewrite(pathname, base);
    if (target) {
      const url = req.nextUrl.clone();
      url.pathname = target;
      return NextResponse.rewrite(url);
    }
  }

  // 别名入口始终可用
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
    "/zh",
    "/zh/:path*",
    "/vi",
    "/vi/:path*",
    "/admin",
    "/admin/:path*",
    "/ops",
    "/ops/:path*",
    "/console",
    "/console/:path*",
  ],
};
