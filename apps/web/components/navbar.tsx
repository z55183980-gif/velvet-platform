"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, Sun, Moon, Monitor, Crown } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { useTheme } from "@/components/theme-provider";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { cn } from "@/lib/utils";

export function Navbar({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile";
}) {
  const { t } = useLocale();
  const { user, balance, ready: authReady, openLogin, openRecharge, openVip } = useAuth();
  const { theme, cycleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const isMobileShell = variant === "mobile";

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  const links = [
    { href: "/", label: t("nav.home") },
    { href: "/theater", label: t("nav.theater") },
    { href: "/?sort=latest", label: t("nav.new") },
    { href: "/?sort=hot", label: t("nav.hot") },
    { href: "/creator/", label: t("nav.creator") },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-transparent bg-base/70 backdrop-blur-xl transition-[border-color] data-[scrolled]:border-line",
        isMobileShell && "border-b border-line/60",
      )}
    >
      <div
        className={cn(
          "mx-auto flex items-center gap-5 px-4",
          isMobileShell ? "h-12 max-w-lg" : "h-14 max-w-[1200px] md:h-16 md:px-6",
        )}
      >
        <Link href="/" className="group flex items-baseline gap-0.5">
          <span className="text-h3 font-bold tracking-tight text-ink transition-colors group-hover:text-brand md:text-h4">
            Velvet
          </span>
        </Link>

        {!isMobileShell && (
          <nav className="hidden items-center gap-0.5 md:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2 text-body-sm text-ink-muted transition-colors hover:text-ink"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={cycleTheme}
            className={cn(
              "h-9 w-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink",
              isMobileShell ? "grid" : "hidden sm:grid",
            )}
            aria-label="theme"
            title={theme}
          >
            <ThemeIcon className="h-4 w-4" />
          </button>

          <LanguageSwitcher
            className={cn(isMobileShell ? "" : "hidden sm:block")}
          />

          <NotificationBell />

          <button
            type="button"
            onClick={() => (user ? openVip() : openLogin())}
            className={cn(
              "items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
              user?.isVip
                ? "bg-gold/15 text-gold hover:bg-gold/25"
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
              "items-center gap-2 rounded-full bg-surface-2/80 px-3 py-1.5 transition-colors hover:bg-surface-3",
              isMobileShell ? "inline-flex" : "hidden sm:inline-flex",
            )}
            title={t("recharge.title")}
          >
            {!isMobileShell && (
              <span className="text-caption text-ink-subtle">{t("nav.balance")}</span>
            )}
            <span className="text-body-sm font-medium tabular-nums text-ink">
              {!authReady ? "…" : balance != null ? balance.toLocaleString("vi-VN") : "—"}
            </span>
            <span className="grid h-5 w-5 place-items-center rounded-full bg-brand text-[11px] font-bold leading-none text-white">
              +
            </span>
          </button>

          {!authReady ? (
            <span className="grid h-9 place-items-center rounded-full px-3 text-body-sm text-ink-muted">
              …
            </span>
          ) : user ? (
            <Link
              href="/me"
              className="grid h-9 max-w-[7rem] place-items-center truncate rounded-full px-3 text-body-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
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
              className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink md:hidden"
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
        <div className="border-t border-line bg-base/95 backdrop-blur-xl md:hidden">
          <nav className="mx-auto flex max-w-[1200px] flex-col px-4 py-3">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-md px-3 py-3 text-body text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink",
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
