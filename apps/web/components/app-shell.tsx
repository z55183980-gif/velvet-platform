"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { BottomTabBar } from "@/components/mobile/bottom-tab-bar";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { cn } from "@/lib/utils";

function isImmersivePlay(pathname: string | null) {
  if (!pathname) return false;
  return pathname === "/drama" || pathname.startsWith("/drama/");
}

/** Consumer chrome (Navbar/Footer/BottomTab). */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  const immersive = isMobile && isImmersivePlay(pathname);
  const showBottomTab = isMobile && !immersive;
  const showFooter = !isMobile;
  const showNavbar = !immersive;

  return (
    <>
      {showNavbar && (
        <Suspense
          fallback={
            <header className="sticky top-0 z-50 h-12 bg-base/70 backdrop-blur-xl md:h-16" />
          }
        >
          <Navbar variant={isMobile ? "mobile" : "desktop"} />
        </Suspense>
      )}
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
