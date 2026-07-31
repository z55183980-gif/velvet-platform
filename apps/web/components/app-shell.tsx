"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { ADMIN_BASE_PATH } from "@/lib/admin-path";

const ADMIN_PREFIXES = [ADMIN_BASE_PATH, "/admin", "/ops", "/console"];

function isAdminPath(pathname: string | null) {
  if (!pathname) return false;
  return ADMIN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Consumer chrome (Navbar/Footer). Admin routes render children only. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isAdminPath(pathname)) {
    return <>{children}</>;
  }
  return (
    <>
      <Navbar />
      <main>{children}</main>
      <Footer />
    </>
  );
}
