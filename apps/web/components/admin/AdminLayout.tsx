"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  AdminProfile,
  adminLogout,
  adminMe,
  clearAdminToken,
  getAdminToken,
} from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import { adminPath } from "@/lib/admin-path";

type NavItem = { href: string; key: string; finance?: boolean };

function buildNav(): NavItem[] {
  return [
    { href: adminPath("/dashboard"), key: "admin.dashboard" },
    { href: adminPath("/content"), key: "admin.content" },
    { href: adminPath("/banners"), key: "admin.banners" },
    { href: adminPath("/categories"), key: "admin.categories" },
    { href: adminPath("/users"), key: "admin.users" },
    { href: adminPath("/orders"), key: "admin.orders" },
    { href: adminPath("/withdraws"), key: "admin.withdraws", finance: true },
    { href: adminPath("/kyc"), key: "admin.kyc" },
    { href: adminPath("/wallet"), key: "admin.wallet", finance: true },
    { href: adminPath("/packages"), key: "admin.packages", finance: true },
    { href: adminPath("/vip-plans"), key: "admin.vipPlans", finance: true },
    { href: adminPath("/redeem-codes"), key: "admin.redeemCodes", finance: true },
    { href: adminPath("/ops"), key: "admin.ops", finance: true },
    { href: adminPath("/rates"), key: "admin.rates", finance: true },
    { href: adminPath("/reconcile"), key: "admin.reconcile" },
    { href: adminPath("/audit"), key: "admin.audit" },
    { href: adminPath("/creators"), key: "admin.creators" },
    { href: adminPath("/settings"), key: "admin.settings", finance: true },
  ];
}

export function AdminLayout({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [ready, setReady] = useState(false);
  const loginHref = adminPath("/login");
  const dashHref = adminPath("/dashboard");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getAdminToken();
      if (!token) {
        router.replace(loginHref);
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
        router.replace(loginHref);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loginHref]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-base text-ink flex items-center justify-center">
        <p className="text-ink-muted text-body-sm">{t("admin.loading")}</p>
      </div>
    );
  }

  const role = admin?.role || "SUPER_ADMIN";
  const items = buildNav().filter((n) => !n.finance || role === "SUPER_ADMIN");

  return (
    <div className="flex min-h-screen bg-[oklch(0.14_0.008_250)] text-ink">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-[oklch(0.17_0.008_250)]">
        <div className="border-b border-line px-4 py-5">
          <Link href={dashHref} className="block">
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
              (item.href !== dashHref && pathname.startsWith(item.href));
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
          <Link
            href="/"
            className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-full justify-center"}
          >
            {t("admin.backSite")}
          </Link>
          <button
            type="button"
            className={buttonVariants({ variant: "secondary", size: "sm" }) + " w-full"}
            onClick={async () => {
              await adminLogout();
              router.replace(loginHref);
            }}
          >
            {t("admin.logout")}
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

export function fmtNum(v: string | number | bigint | null | undefined) {
  if (v == null) return "0";
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString();
}

export function fmtDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function hoursAgo(v: string | Date | null | undefined) {
  if (!v) return 0;
  const d = typeof v === "string" ? new Date(v) : v;
  return (Date.now() - d.getTime()) / 3600000;
}
