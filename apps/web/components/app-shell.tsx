"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { markInAppNavigation } from "@/lib/nav-history";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { BottomTabBar } from "@/components/mobile/bottom-tab-bar";
import {
  MobileFeedLockProvider,
  useMobileFeedLock,
} from "@/components/mobile/mobile-feed-lock";
import { PwaInstallRoot } from "@/components/pwa-install";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { cn } from "@/lib/utils";
import { lockPortraitOrientation } from "@/lib/screen-orientation";

function isDramaPath(pathname: string | null) {
  if (!pathname) return false;
  return pathname === "/drama" || pathname.startsWith("/drama/");
}

/** Consumer chrome (Navbar desktop / Footer desktop / BottomTab mobile). */
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
  const { mobile: isMobile, ready: mobileReady } = useIsMobile();

  // Record that back() has an in-app destination (see lib/nav-history).
  const entryPathRef = useRef(pathname);
  useEffect(() => {
    if (pathname !== entryPathRef.current) markInAppNavigation();
  }, [pathname]);

  useEffect(() => {
    if (!mobileReady || !isMobile) return;
    const videoControlsOrientation = pathname === "/" || isDramaPath(pathname);
    if (!videoControlsOrientation) void lockPortraitOrientation();
  }, [mobileReady, isMobile, pathname]);

  return (
    <div
      className={cn(
        // Home feed: full-bleed stage under a fixed tab (same chrome as theater).
        // Prefer inset-0 over h-dvh so PWA translucent sizing stays stable.
        lockMobileHome &&
          isMobile &&
          "feed-immersive fixed inset-0 flex flex-col overflow-hidden overscroll-none",
      )}
    >
      <MaintenanceBanner />
      {mobileReady && !isMobile ? (
        <Suspense fallback={<header className="sticky top-0 z-50 h-16 shrink-0 bg-base/70 backdrop-blur-xl" />}>
          <Navbar />
        </Suspense>
      ) : null}
      <main
        className={cn(
          "overflow-x-clip",
          !lockMobileHome &&
            isMobile &&
            !onDrama &&
            "pt-[env(safe-area-inset-top,0px)]",
          // Theater/me: reserve fixed tab under scroll content.
          // Home feed: no main pb — video stays full-bleed; feed overlays clear the tab.
          !lockMobileHome &&
            !onDrama &&
            isMobile &&
            "pb-[calc(3rem+var(--mobile-tab-safe-bottom))]",
          onDrama && isMobile && "bg-base",
          lockMobileHome &&
            isMobile &&
            "min-h-0 flex-1 overflow-hidden overscroll-none pb-0",
        )}
      >
        {children}
      </main>
      {mobileReady && !isMobile ? <Footer /> : null}
      {mobileReady && isMobile && !onDrama ? (
        <BottomTabBar transparentSafeArea={lockMobileHome} />
      ) : null}
      <PwaInstallRoot />
    </div>
  );
}
