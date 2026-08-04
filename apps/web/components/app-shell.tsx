"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { BottomTabBar } from "@/components/mobile/bottom-tab-bar";
import { cn } from "@/lib/utils";

function isDramaPath(pathname: string | null) {
  if (!pathname) return false;
  return pathname === "/drama" || pathname.startsWith("/drama/");
}

/** Consumer chrome (Navbar/Footer/BottomTab). CSS-responsive — no JS breakpoint flash. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onDrama = isDramaPath(pathname);

  return (
    <>
      <Suspense
        fallback={
          <header className="sticky top-0 z-50 h-12 bg-base/70 backdrop-blur-xl md:h-16" />
        }
      >
        <Navbar />
      </Suspense>
      <main
        className={cn(
          !onDrama && "pb-[calc(3rem+env(safe-area-inset-bottom))] md:pb-0",
          onDrama && "max-md:bg-base",
        )}
      >
        {children}
      </main>
      {/* Footer desktop-only via CSS — always mounted to avoid hydration layout jump */}
      <div className="hidden md:block">
        <Footer />
      </div>
      {/* Bottom tabs mobile-only; already has md:hidden. Hidden on drama detail. */}
      {!onDrama && <BottomTabBar />}
    </>
  );
}
