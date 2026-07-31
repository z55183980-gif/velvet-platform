"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { adminPath } from "@/lib/admin-path";

/** 兼容入口：跳转仪表盘 */
export default function AdminIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(adminPath("/dashboard"));
  }, [router]);
  return (
    <main className="min-h-screen bg-base text-ink flex items-center justify-center">
      <p className="text-ink-muted text-body-sm">…</p>
    </main>
  );
}
