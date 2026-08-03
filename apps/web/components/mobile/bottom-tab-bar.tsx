"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Home, User } from "lucide-react";
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
    href: "/me",
    key: "tabs.me",
    icon: User,
    match: (p: string) => p === "/me" || p.startsWith("/me/"),
  },
] as const;

export function BottomTabBar() {
  const pathname = usePathname() || "/";
  const { t } = useLocale();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-base/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-2">
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-caption transition-colors",
                active ? "text-brand" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon className={cn("h-5 w-5", active && "stroke-[2.25]")} />
              <span className="font-medium">{t(tab.key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
