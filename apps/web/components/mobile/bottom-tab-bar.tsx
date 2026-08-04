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

export function BottomTabBar({ inline = false }: { inline?: boolean }) {
  const pathname = usePathname() || "/";
  const { t } = useLocale();

  return (
    <nav
      className={cn(
        // --mobile-tab-safe-bottom: env(safe-area) in browser; +air in standalone
        // (see globals.css). Works for both fixed overlay and feed-lock inline.
        "z-50 pb-[var(--mobile-tab-safe-bottom)] md:hidden",
        // Home feed: solid immersive chrome (parent .feed-immersive forces dark tokens).
        // Other pages: follow the active theme.
        inline
          ? "relative shrink-0 border-t border-line/60 bg-base"
          : "fixed inset-x-0 bottom-0 border-t border-line/60 bg-base/90 backdrop-blur-xl",
      )}
      aria-label="Primary"
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
