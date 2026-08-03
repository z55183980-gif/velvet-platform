"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, X, Sun, Moon, Monitor, Crown } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { useTheme } from "@/components/theme-provider";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

export function Navbar({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile";
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, balance, ready: authReady, openLogin, openRecharge, openVip } = useAuth();
  const { theme, cycleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isMobileShell = variant === "mobile";
  const filteredHome =
    !!searchParams.get("cat") || !!searchParams.get("q") || !!searchParams.get("sort");
  const isHomeOverlay = !isMobileShell && pathname === "/" && !filteredHome;

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  const links = [
    { href: "/", label: t("nav.home"), match: (p: string) => p === "/" && !filteredHome },
    { href: "/theater", label: t("nav.theater"), match: (p: string) => p.startsWith("/theater") },
    { href: "/?sort=latest", label: t("nav.new"), match: () => searchParams.get("sort") === "latest" },
    { href: "/?sort=hot", label: t("nav.hot"), match: () => searchParams.get("sort") === "hot" },
    { href: "/creator/", label: t("nav.creator"), match: (p: string) => p.startsWith("/creator") },
  ];

  useEffect(() => {
    if (!isHomeOverlay) {
      setScrolled(false);
      return;
    }
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHomeOverlay]);

  return (
    <header
      className={cn(
        "z-50 transition-[background-color,border-color,backdrop-filter] duration-300",
        isHomeOverlay
          ? cn(
              "fixed inset-x-0 top-0 border-b border-transparent",
              scrolled
                ? "border-white/5 bg-black/70 backdrop-blur-xl"
                : "bg-gradient-to-b from-black/55 via-black/20 to-transparent",
            )
          : cn(
              "sticky top-0 border-b border-transparent bg-base/70 backdrop-blur-xl",
              isMobileShell && "border-b border-line/60",
            ),
      )}
    >
      <div
        className={cn(
          "mx-auto flex items-center gap-6 px-4",
          isMobileShell ? "h-12 max-w-lg" : "h-14 max-w-[1280px] md:h-16 md:px-10",
        )}
      >
        <Link
          href="/"
          className="group flex shrink-0 items-center transition-opacity hover:opacity-90"
          aria-label="Velvet"
        >
          <BrandLogo
            size={isMobileShell ? 28 : 34}
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

        {!isMobileShell && (
          <nav className="hidden items-center gap-1 md:flex">
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
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={cycleTheme}
            className={cn(
              "h-9 w-9 place-items-center rounded-full transition-colors",
              isHomeOverlay
                ? "text-white/70 hover:bg-white/10 hover:text-white"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              isMobileShell ? "grid" : "hidden sm:grid",
            )}
            aria-label="theme"
            title={theme}
          >
            <ThemeIcon className="h-4 w-4" />
          </button>

          <LanguageSwitcher
            tone={isHomeOverlay ? "onDark" : "default"}
            className={cn(isMobileShell ? "" : "hidden sm:block")}
          />

          <NotificationBell tone={isHomeOverlay ? "onDark" : "default"} />

          <button
            type="button"
            onClick={() => (user ? openVip() : openLogin())}
            className={cn(
              "items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
              user?.isVip
                ? "bg-gold/15 text-gold hover:bg-gold/25"
                : isHomeOverlay
                  ? "bg-white/10 text-white/80 hover:bg-white/15 hover:text-white"
                  : "bg-surface-2/80 text-ink-muted hover:bg-surface-3 hover:text-ink",
              isMobileShell ? "inline-flex" : "hidden sm:inline-flex",
            )}
            title={t("nav.vip")}
            aria-label={t("nav.vip")}
          >
            <Crown className="h-3.5 w-3.5" />
            <span className="text-body-sm font-medium">
              {user?.isVip ? t("vip.member") : t("nav.vip")}
            </span>
          </button>

          <button
            type="button"
            onClick={openRecharge}
            className={cn(
              "items-center gap-2 rounded-full px-3 py-1.5 transition-colors",
              isHomeOverlay
                ? "bg-white/10 hover:bg-white/15"
                : "bg-surface-2/80 hover:bg-surface-3",
              isMobileShell ? "inline-flex" : "hidden sm:inline-flex",
            )}
            title={t("recharge.title")}
          >
            {!isMobileShell && (
              <span
                className={cn(
                  "text-caption",
                  isHomeOverlay ? "text-white/55" : "text-ink-subtle",
                )}
              >
                {t("nav.balance")}
              </span>
            )}
            <span
              className={cn(
                "text-body-sm font-medium tabular-nums",
                isHomeOverlay ? "text-white" : "text-ink",
              )}
            >
              {!authReady ? "…" : balance != null ? balance.toLocaleString("vi-VN") : "—"}
            </span>
            <span className="grid h-5 w-5 place-items-center rounded-full bg-brand text-[11px] font-bold leading-none text-white">
              +
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
            <button
              onClick={() => openLogin()}
              className="grid h-9 place-items-center rounded-full bg-brand px-4 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {t("nav.login")}
            </button>
          )}

          {!isMobileShell && (
            <button
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full md:hidden",
                isHomeOverlay
                  ? "text-white/80 hover:bg-white/10 hover:text-white"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
              onClick={() => setOpen((o) => !o)}
              aria-label="menu"
              aria-expanded={open}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {!isMobileShell && open && (
        <div
          className={cn(
            "border-t backdrop-blur-xl md:hidden",
            isHomeOverlay ? "border-white/10 bg-black/90" : "border-line bg-base/95",
          )}
        >
          <nav className="mx-auto flex max-w-[1280px] flex-col px-4 py-3">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-md px-3 py-3 text-body transition-colors",
                  isHomeOverlay
                    ? "text-white/75 hover:bg-white/10 hover:text-white"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex gap-2 border-t border-line pt-3">
              <button
                onClick={cycleTheme}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-surface-2 px-3 py-2.5 text-body-sm text-ink-muted"
              >
                <ThemeIcon className="h-4 w-4" />
                {theme}
              </button>
              <div className="flex flex-1 items-center justify-center rounded-full bg-surface-2 px-2 py-1">
                <LanguageSwitcher />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                if (user) openVip();
                else openLogin();
              }}
              className={cn(
                "mt-2 flex items-center justify-between rounded-full px-4 py-2.5 text-body-sm",
                user?.isVip ? "bg-gold/15 text-gold" : "bg-surface-2 text-ink",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Crown className="h-4 w-4" />
                {user?.isVip ? t("vip.member") : t("nav.vip")}
              </span>
              <span className="text-caption opacity-80">{t("vip.open")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openRecharge();
              }}
              className="mt-2 flex items-center justify-between rounded-full bg-surface-2 px-4 py-2.5 text-body-sm"
            >
              <span className="text-ink-muted">{t("nav.balance")}</span>
              <span className="font-medium tabular-nums">
                {!authReady
                  ? "…"
                  : balance != null
                    ? `${balance.toLocaleString("vi-VN")} ${t("card.credits")}`
                    : "—"}
              </span>
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
