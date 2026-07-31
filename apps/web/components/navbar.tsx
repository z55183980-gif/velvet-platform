"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, Globe, Sun, Moon, Monitor } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { useTheme } from "@/components/theme-provider";
import { NotificationBell } from "@/components/notification-bell";
import { cn } from "@/lib/utils";

export function Navbar() {
  const { locale, setLocale, t } = useLocale();
  const { user, balance, ready: authReady, openLogin, openRecharge } = useAuth();
  const { theme, cycleTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  const links = [
    { href: "/", label: t("nav.home") },
    { href: "/?sort=latest", label: t("nav.new") },
    { href: "/?sort=hot", label: t("nav.hot") },
    { href: "/?cat=ngon_tinh", label: t("nav.categories") },
    { href: "/creator/", label: locale === "vi" ? "Sáng tạo" : "创作者" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-base/70 backdrop-blur-xl transition-[border-color] data-[scrolled]:border-line">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-5 px-4 md:h-16 md:px-6">
        <Link href="/" className="group flex items-baseline gap-0.5">
          <span className="text-h3 font-bold tracking-tight text-ink transition-colors group-hover:text-brand md:text-h4">
            Drama
          </span>
          <span className="text-h3 font-bold tracking-tight text-brand md:text-h4">VN</span>
        </Link>

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

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={cycleTheme}
            className="hidden h-9 w-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:grid"
            aria-label="theme"
            title={theme}
          >
            <ThemeIcon className="h-4 w-4" />
          </button>

          <button
            onClick={() => setLocale(locale === "vi" ? "zh" : "vi")}
            className="hidden h-9 items-center gap-1.5 rounded-full px-2.5 text-body-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:inline-flex"
            aria-label={t("langSwitchHint")}
            title={t("langSwitchHint")}
          >
            <Globe className="h-4 w-4" />
            <span className="font-medium text-ink">{t("langToggle")}</span>
            <span className="text-caption text-ink-subtle">→ {locale === "vi" ? "中文" : "VI"}</span>
          </button>

          <NotificationBell />

          <button
            type="button"
            onClick={openRecharge}
            className="hidden items-center gap-2 rounded-full bg-surface-2/80 px-3 py-1.5 transition-colors hover:bg-surface-3 sm:inline-flex"
            title={t("recharge.title")}
          >
            <span className="text-caption text-ink-subtle">{t("nav.balance")}</span>
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

          <button
            className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label="menu"
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
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
              <button
                onClick={() => setLocale(locale === "vi" ? "zh" : "vi")}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-surface-2 px-3 py-2.5 text-body-sm text-ink-muted"
                title={t("langSwitchHint")}
              >
                <Globe className="h-4 w-4" />
                {t("langToggle")} → {locale === "vi" ? "中文" : "VI"}
              </button>
            </div>
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
