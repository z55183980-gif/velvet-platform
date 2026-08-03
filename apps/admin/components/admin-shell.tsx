"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import {
  adminLogout,
  adminMe,
  clearAdminToken,
  getAdminToken,
  type AdminProfile,
} from "@velvet/api-client";
import { buttonVariants } from "@velvet/ui";
import { t, type LabelKey } from "@/lib/i18n";

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";

type NavItem = { href: string; key: LabelKey; finance?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/content", key: "content" },
  { href: "/banners", key: "banners" },
  { href: "/categories", key: "categories" },
  { href: "/users", key: "users" },
  { href: "/orders", key: "orders" },
  { href: "/withdraws", key: "withdraws", finance: true },
  { href: "/kyc", key: "kyc" },
  { href: "/wallet", key: "wallet", finance: true },
  { href: "/packages", key: "packages", finance: true },
  { href: "/vip-plans", key: "vipPlans", finance: true },
  { href: "/redeem-codes", key: "redeemCodes", finance: true },
  { href: "/ops", key: "ops", finance: true },
  { href: "/rates", key: "rates", finance: true },
  { href: "/reconcile", key: "reconcile" },
  { href: "/audit", key: "audit" },
  { href: "/creators", key: "creators" },
  { href: "/settings", key: "settings", finance: true },
];

export function AdminShell({ children, title }: { children: ReactNode; title?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getAdminToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        const me = await adminMe();
        if (cancelled) return;
        setAdmin(me);
        setReady(true);
      } catch {
        if (cancelled) return;
        clearAdminToken();
        router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-base text-ink flex items-center justify-center">
        <p className="text-ink-muted text-body-sm">{t("loading")}</p>
      </div>
    );
  }

  const role = admin?.role || "SUPER_ADMIN";
  const items = NAV.filter((n) => !n.finance || role === "SUPER_ADMIN");

  return (
    <div className="flex min-h-screen bg-[oklch(0.14_0.008_250)] text-ink">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-[oklch(0.17_0.008_250)]">
        <div className="border-b border-line px-4 py-5">
          <Link href="/dashboard" className="block">
            <span className="text-overline uppercase tracking-widest text-ink-subtle">Ops</span>
            <p className="mt-1 text-h4 font-semibold tracking-tight text-ink">Velvet</p>
          </Link>
          <p className="mt-2 truncate text-caption text-ink-muted">
            {admin?.displayName || admin?.username} · {role}
          </p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-body-sm transition ${
                  active
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-ink-muted hover:bg-surface-2/60 hover:text-ink"
                }`}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <a
            href={WEB_URL}
            className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-full justify-center"}
          >
            {t("backSite")}
          </a>
          <button
            type="button"
            className={buttonVariants({ variant: "secondary", size: "sm" }) + " w-full"}
            onClick={async () => {
              await adminLogout();
              router.replace("/login");
            }}
          >
            {t("logout")}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {title ? (
          <header className="border-b border-line px-6 py-4">
            <h1 className="text-h3 font-semibold">{title}</h1>
          </header>
        ) : null}
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </div>
  );
}

export { fmtNum, fmtDate } from "@velvet/ui";
