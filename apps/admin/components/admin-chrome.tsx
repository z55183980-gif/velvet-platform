"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShellRoot } from "@/components/admin-shell";

/** 登录页裸渲染；其余路由共用持久壳，避免菜单点击整页重挂载 */
export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return <>{children}</>;
  }
  return <AdminShellRoot>{children}</AdminShellRoot>;
}
