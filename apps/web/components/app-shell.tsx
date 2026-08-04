"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { BottomTabBar } from "@/components/mobile/bottom-tab-bar";
import {
  MobileFeedLockProvider,
  useMobileFeedLock,
} from "@/components/mobile/mobile-feed-lock";
import { PwaInstallRoot } from "@/components/pwa-install";
import { cn } from "@/lib/utils";

function isDramaPath(pathname: string | null) {
  if (!pathname) return false;
  return pathname === "/drama" || pathname.startsWith("/drama/");
}

/** Consumer chrome (Navbar/Footer/BottomTab). CSS-responsive — no JS breakpoint flash. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <MobileFeedLockProvider>
      <AppShellInner>{children}</AppShellInner>
    </MobileFeedLockProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onDrama = isDramaPath(pathname);
  const { locked: lockMobileHome } = useMobileFeedLock();

  return (
    <div
      className={cn(
        // Only while mobile VerticalFeed is mounted: pin entire chrome; main is the video stage.
        // feed-immersive locks dark palette so light theme cannot bleach the home feed.
        lockMobileHome &&
          "feed-immersive max-md:fixed max-md:inset-0 max-md:flex max-md:h-dvh max-md:flex-col max-md:overflow-hidden max-md:overscroll-none",
      )}
    >
      <Suspense
        fallback={
          <header className="sticky top-0 z-50 h-12 shrink-0 bg-base/70 backdrop-blur-xl md:h-16" />
        }
      >
        <Navbar />
      </Suspense>
      <main
        className={cn(
          // Contain accidental horizontal overflow (chips/grid) without locking vertical scroll.
          "overflow-x-clip",
          // Reserve fixed tab height (h-12) + same safe-bottom token as BottomTabBar.
          // Feed-lock zeroes this: tab is inline in the flex column instead.
          !onDrama && "pb-[calc(3rem+var(--mobile-tab-safe-bottom))] md:pb-0",
          onDrama && "max-md:bg-base",
          lockMobileHome &&
            "max-md:min-h-0 max-md:flex-1 max-md:overflow-hidden max-md:overscroll-none max-md:pb-0",
        )}
      >
        {children}
      </main>
      {/* Footer desktop-only via CSS — always mounted to avoid hydration layout jump */}
      <div className="hidden md:block">
        <Footer />
      </div>
      {/* Bottom tabs mobile-only; already has md:hidden. Hidden on drama detail. */}
      {!onDrama && <BottomTabBar inline={lockMobileHome} />}
      <PwaInstallRoot />
    </div>
  );
}
