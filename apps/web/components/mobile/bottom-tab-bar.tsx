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
 * Fixed bottom height = h-12 (3rem) + --mobile-tab-safe-bottom.
 * Home (inline) and theater (fixed) share the same token so chrome height matches;
 * video stage size is independent (flex-1 sibling above inline tab).
 */
export function BottomTabBar({ inline = false }: { inline?: boolean }) {
  const pathname = usePathname() || "/";
  const { t } = useLocale();

  return (
    <nav
      className={cn(
        "z-50 border-t border-line/60 pb-[var(--mobile-tab-safe-bottom)]",
        inline
          ? // Home feed: solid dark chrome via .feed-immersive; sits under video stage.
            "relative shrink-0 bg-base"
          : "fixed inset-x-0 bottom-0 bg-base/90 backdrop-blur-xl",
      )}
      aria-label="Primary"
      style={{
        // Explicit total chrome height contract for layout math elsewhere.
        ["--mobile-tab-chrome-height" as string]:
          "calc(3rem + var(--mobile-tab-safe-bottom))",
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
