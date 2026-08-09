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
 * The standalone WebView already reserves its bottom system band, so the tab
 * stays h-12 without adding env(safe-area-inset-bottom) a second time.
 */
export function BottomTabBar() {
  const pathname = usePathname() || "/";
  const { t } = useLocale();

  return (
    <nav
      className="mobile-bottom-tab fixed inset-x-0 bottom-0 z-50 border-t border-line/60 bg-base/90 backdrop-blur-xl"
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
