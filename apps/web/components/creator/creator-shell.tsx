"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/creator", labelKey: "creator.navOverview", match: (p: string) => p === "/creator" || p === "/creator/" },
  {
    href: "/creator/works",
    labelKey: "creator.navWorks",
    match: (p: string) => p.startsWith("/creator/works"),
  },
  {
    href: "/creator/upload",
    labelKey: "creator.navUpload",
    match: (p: string) => p.startsWith("/creator/upload"),
  },
  {
    href: "/creator/wallet",
    labelKey: "creator.navWallet",
    match: (p: string) =>
      p.startsWith("/creator/wallet") ||
      p.startsWith("/creator/earnings") ||
      p.startsWith("/creator/withdraw") ||
      p.startsWith("/creator/kyc"),
  },
] as const;

export function CreatorShell({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const pathname = usePathname() || "/creator";

  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-ink">{t("creator.title")}</h1>
          <p className="mt-1 text-body-sm text-ink-muted">{t("creator.subtitle")}</p>
        </div>
        <Link href="/" className="text-body-sm text-ink-muted hover:text-ink">
          ← {t("creator.backHome")}
        </Link>
      </div>

      <nav
        className="mt-6 -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
        aria-label={t("creator.title")}
      >
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "shrink-0 rounded-md px-3 py-2 text-body-sm transition-colors",
                active
                  ? "bg-brand text-white"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="mt-8">{children}</div>
    </div>
  );
}
