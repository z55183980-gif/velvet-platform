"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clapperboard, Home, LockKeyhole, UserRound, type LucideIcon } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", key: "tabs.home", icon: Home, match: (p: string) => p === "/" },
  {
    href: "/theater",
    key: "tabs.theater",
    icon: Clapperboard,
    match: (p: string) => p === "/theater" || p.startsWith("/theater/"),
  },
  {
    href: "/secret",
    key: "tabs.secret",
    icon: LockKeyhole,
    special: true,
    match: (p: string) => p === "/secret" || p.startsWith("/secret/"),
  },
  {
    href: "/me",
    key: "tabs.me",
    icon: UserRound,
    match: (p: string) => p === "/me" || p.startsWith("/me/"),
  },
] as const;

/**
 * Fixed tab for home + theater + me.
 * The label row stays h-12. Theater/Me may add standalone-only safe padding;
 * the immersive home feed keeps its separate viewport treatment.
 */
export function BottomTabBar({
  immersive = false,
  standaloneSafeArea = false,
}: {
  immersive?: boolean;
  standaloneSafeArea?: boolean;
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { t } = useLocale();
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useEffect(() => {
    setPendingPath(null);
  }, [pathname]);

  useEffect(() => {
    const prefetchTabs = () => {
      for (const tab of tabs) router.prefetch(tab.href);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(prefetchTabs, { timeout: 1200 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = globalThis.setTimeout(prefetchTabs, 250);
    return () => globalThis.clearTimeout(id);
  }, [router]);

  const visualPath = pendingPath ?? pathname;

  return (
    <nav
      className={cn(
        "mobile-bottom-tab fixed inset-x-0 bottom-0 z-50 border-t border-line/60 bg-base/90 backdrop-blur-xl",
        immersive && "mobile-bottom-tab-immersive",
        standaloneSafeArea && "standalone-safe-bottom-tab",
      )}
      aria-label={t("common.primaryNavigation")}
    >
      <div className="mx-auto flex h-12 max-w-lg items-stretch justify-around">
        {tabs.map((tab) => {
          const active = tab.match(visualPath);
          const Icon = "icon" in tab ? (tab.icon as LucideIcon) : null;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (!tab.match(pathname)) setPendingPath(tab.href);
              }}
              className={cn(
                "touch-manipulation flex flex-1 items-center justify-center text-[15px] transition-colors active:opacity-70",
                "special" in tab && tab.special
                  ? active
                    ? "font-semibold text-rose-300"
                    : "font-medium text-rose-300/80"
                  : active
                    ? "font-semibold text-ink"
                    : "font-normal text-ink-muted",
              )}
            >
              {"special" in tab && tab.special ? (
                <span className="flex items-center gap-1.5">
                  {Icon ? <Icon className="h-4 w-4 stroke-[1.6]" aria-hidden /> : null}
                  {t(tab.key)}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  {Icon ? <Icon className="h-4 w-4 stroke-[1.6]" aria-hidden /> : null}
                  {t(tab.key)}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
