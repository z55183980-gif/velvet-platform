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
 * The outer height is always h-12 + --mobile-tab-safe-bottom so every tab keeps
 * identical geometry. On the immersive home feed only the safe-area background
 * is transparent, allowing video to remain full-bleed without shortening the tab.
 */
export function BottomTabBar({
  transparentSafeArea = false,
}: {
  transparentSafeArea?: boolean;
}) {
  const pathname = usePathname() || "/";
  const { t } = useLocale();

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 border-t border-line/60 pb-[var(--mobile-tab-safe-bottom)]",
        !transparentSafeArea && "bg-base/90 backdrop-blur-xl",
      )}
      aria-label="Primary"
      style={{
        ["--mobile-tab-chrome-height" as string]:
          "calc(3rem + var(--mobile-tab-safe-bottom))",
      }}
    >
      <div
        className={cn(
          "h-12",
          transparentSafeArea && "bg-base/90 backdrop-blur-xl",
        )}
      >
        <div className="mx-auto flex h-full max-w-lg items-stretch justify-around">
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
      </div>
    </nav>
  );
}
