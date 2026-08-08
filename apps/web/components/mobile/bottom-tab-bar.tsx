"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", key: "tabs.home", match: (p: string) => p === "/" },
  {
    href: "/theater",
    key: "tabs.theater",
    match: (p: string) => p === "/theater" || p.startsWith("/theater/"),
  },
  {
    href: "/me",
    key: "tabs.me",
    match: (p: string) => p === "/me" || p.startsWith("/me/"),
  },
] as const;

/**
 * Fixed tab for home + theater + me.
 *
 * After apple-mobile-web-app-status-bar-style=black-translucent the page canvas
 * includes the home-indicator band and env(safe-area-inset-bottom) becomes
 * non-zero. Theater/me keep that pad so labels clear the indicator. Home feed
 * must NOT solid-pad it — that pad is the visible “extra bottom safe area”
 * over full-bleed video (flushSafeArea).
 */
export function BottomTabBar({
  flushSafeArea = false,
}: {
  flushSafeArea?: boolean;
}) {
  const pathname = usePathname() || "/";
  const { t } = useLocale();

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 border-t border-line/60 bg-base/90 backdrop-blur-xl",
        flushSafeArea ? "pb-0" : "pb-[var(--mobile-tab-safe-bottom)]",
      )}
      aria-label="Primary"
      style={{
        ["--mobile-tab-chrome-height" as string]: flushSafeArea
          ? "3rem"
          : "calc(3rem + var(--mobile-tab-safe-bottom))",
      }}
    >
      <div className="mx-auto flex h-12 max-w-lg items-stretch justify-around">
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-1 items-center justify-center text-[15px] transition-colors",
                active ? "font-semibold text-ink" : "font-normal text-ink-muted",
              )}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
