"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Sun, Moon, Crown } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { useTheme } from "@/components/theme-provider";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

/**
 * Desktop-only shell navbar.
 * Mobile primary nav is BottomTabBar; never mount compact top chrome on max-md
 * (avoids Feed-lock timing flash when returning home).
 */
export function Navbar() {
  const { t } = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, ready: authReady, openLogin, openVip } = useAuth();
  const { theme, cycleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [themeMounted, setThemeMounted] = useState(false);
  const filteredHome =
    !!searchParams.get("cat") || !!searchParams.get("q") || !!searchParams.get("sort");
  const isHome = pathname === "/" && !filteredHome;
  // Hero overlay only on desktop home
  const isHomeOverlay = isHome;

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  // Only choose Sun/Moon after mount so SSR HTML always matches the first client paint.
  const ThemeIcon = theme === "light" ? Sun : Moon;

  const links = [
    { href: "/", label: t("nav.home"), match: (p: string) => p === "/" && !filteredHome },
    { href: "/theater", label: t("nav.theater"), match: (p: string) => p.startsWith("/theater") },
    { href: "/?sort=hot", label: t("nav.hot"), match: () => searchParams.get("sort") === "hot" },
  ];
  const creatorActive = pathname.startsWith("/creator");

  useEffect(() => {
    // Overlay scroll styling only matters at md+
    const mq = window.matchMedia("(min-width: 768px)");
    if (!isHomeOverlay || !mq.matches) {
      setScrolled(false);
      return;
    }
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const onMq = () => {
      if (!mq.matches) setScrolled(false);
    };
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("scroll", onScroll);
      mq.removeEventListener("change", onMq);
    };
  }, [isHomeOverlay]);

  return (
    <header
      className={cn(
        // Desktop only — mobile never shows this chrome.
        "z-50 block shrink-0 transition-[background-color,border-color,backdrop-filter] duration-300",
        "sticky top-0 border-b border-line/60 bg-base/70 backdrop-blur-xl",
        // Desktop home: fixed overlay until scroll
        isHomeOverlay &&
          cn(
            "md:fixed md:inset-x-0 md:top-0 md:border-transparent",
            scrolled
              ? "md:border-white/5 md:bg-black/70"
              : "md:border-transparent md:bg-gradient-to-b md:from-black/55 md:via-black/20 md:to-transparent md:bg-base/0",
          ),
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-10">
        <Link
          href="/"
          className="group flex shrink-0 items-center transition-opacity hover:opacity-90"
          aria-label="Velvet"
        >
          <BrandLogo
            size={34}
            priority
            onDark={isHomeOverlay}
            wordmarkClassName={cn(
              "transition-colors",
              isHomeOverlay
                ? "group-hover:text-white/85"
                : "group-hover:text-brand",
            )}
          />
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3.5 py-2 text-[15px] transition-colors",
                  isHomeOverlay
                    ? active
                      ? "text-white"
                      : "text-white/72 hover:text-white"
                    : active
                      ? "text-ink"
                      : "text-ink-muted hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={cycleTheme}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-full transition-colors",
              isHomeOverlay
                ? "text-white/70 hover:bg-white/10 hover:text-white"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
            aria-label="theme"
            title={themeMounted ? theme : undefined}
            suppressHydrationWarning
          >
            {themeMounted ? (
              <ThemeIcon className="h-4 w-4" />
            ) : (
              <span className="inline-block h-4 w-4" aria-hidden />
            )}
          </button>

          <LanguageSwitcher tone={isHomeOverlay ? "onDark" : "default"} />

          <NotificationBell tone={isHomeOverlay ? "onDark" : "default"} />

          <button
            type="button"
            onClick={() => (user ? openVip() : openLogin())}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
              user?.isVip
                ? "bg-gold/15 text-gold hover:bg-gold/25"
                : isHomeOverlay
                  ? "bg-white/10 text-white/80 hover:bg-white/15 hover:text-white"
                  : "bg-surface-2/80 text-ink-muted hover:bg-surface-3 hover:text-ink",
            )}
            title={t("nav.vip")}
            aria-label={t("nav.vip")}
          >
            <Crown className="h-3.5 w-3.5" />
            <span className="text-body-sm font-medium">
              {user?.isVip ? t("vip.member") : t("nav.vip")}
            </span>
          </button>

          {!authReady ? (
            <span
              className={cn(
                "grid h-9 place-items-center rounded-full px-3 text-body-sm",
                isHomeOverlay ? "text-white/60" : "text-ink-muted",
              )}
            >
              …
            </span>
          ) : user ? (
            <Link
              href="/me"
              className={cn(
                "grid h-9 max-w-[7rem] place-items-center truncate rounded-full px-3 text-body-sm transition-colors",
                isHomeOverlay
                  ? "text-white/75 hover:bg-white/10 hover:text-white"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
              aria-label={t("nav.account")}
              title={user.label}
            >
              {user.nickname
                ? user.nickname.slice(0, 10)
                : user.email
                  ? user.email.split("@")[0].slice(0, 10)
                  : user.phone
                    ? user.phone.slice(-4)
                    : user.label.slice(0, 8)}
            </Link>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openLogin("register")}
                className={cn(
                  "grid h-9 place-items-center rounded-full px-4 text-body-sm font-medium transition-colors",
                  isHomeOverlay
                    ? "text-white/80 hover:bg-white/10 hover:text-white"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {t("nav.register")}
              </button>
              <button
                type="button"
                onClick={() => openLogin("login")}
                className="grid h-9 place-items-center rounded-full bg-brand px-4 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                {t("nav.login")}
              </button>
            </>
          )}

          <Link
            href="/creator"
            className={cn(
              "inline-flex rounded-md px-3.5 py-2 text-[15px] transition-colors",
              isHomeOverlay
                ? creatorActive
                  ? "text-white"
                  : "text-white/72 hover:text-white"
                : creatorActive
                  ? "text-ink"
                  : "text-ink-muted hover:text-ink",
            )}
          >
            {t("nav.creator")}
          </Link>
        </div>
      </div>
    </header>
  );
}
