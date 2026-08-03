/**
 * 后台前端入口路径。默认 /admin（与产品约定一致）。
 * 可用 NEXT_PUBLIC_ADMIN_BASE_PATH 改为私有口令路径，例如 /ops 或 /x7k2m。
 * 页面文件仍在 app/admin/*，非 /admin 入口由 middleware 重写进来。
 *
 * 生产分域：用户端 velvet.slc8.com；管理端 velvetadmin.slc8.com
 * （见 lib/site.ts / middleware host 分流）。本地仍用同域 /admin。
 */
const raw = (process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "/admin").trim();

function normalizeBase(p: string): string {
  let s = p.startsWith("/") ? p : `/${p}`;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  if (s === "/") return "/admin";
  return s;
}

export const ADMIN_BASE_PATH = normalizeBase(raw);

/** 拼后台前端路径，如 adminPath('/login') → /admin/login */
export function adminPath(sub = ""): string {
  if (!sub || sub === "/") return ADMIN_BASE_PATH;
  const path = sub.startsWith("/") ? sub : `/${sub}`;
  return `${ADMIN_BASE_PATH}${path}`;
}
