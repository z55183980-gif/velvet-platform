"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { BottomTabBar } from "@/components/mobile/bottom-tab-bar";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { ADMIN_BASE_PATH } from "@/lib/admin-path";
import { cn } from "@/lib/utils";

const ADMIN_PREFIXES = [ADMIN_BASE_PATH, "/admin", "/ops", "/console"];

function isAdminPath(pathname: string | null) {
  if (!pathname) return false;
  return ADMIN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isImmersivePlay(pathname: string | null) {
  if (!pathname) return false;
  return pathname === "/drama" || pathname.startsWith("/drama/");
}

/** Consumer chrome (Navbar/Footer/BottomTab). Admin routes render children only. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  if (isAdminPath(pathname)) {
    return <>{children}</>;
  }

  const immersive = isMobile && isImmersivePlay(pathname);
  const showBottomTab = isMobile && !immersive;
  const showFooter = !isMobile;
  const showNavbar = !immersive;

  return (
    <>
      {showNavbar && <Navbar variant={isMobile ? "mobile" : "desktop"} />}
      <main
        className={cn(
          showBottomTab && "pb-[calc(3.5rem+env(safe-area-inset-bottom))]",
          immersive && "min-h-dvh bg-black",
        )}
      >
        {children}
      </main>
      {showFooter && <Footer />}
      {showBottomTab && <BottomTabBar />}
    </>
  );
}
