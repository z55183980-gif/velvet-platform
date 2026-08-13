"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Coins,
  CreditCard,
  FileText,
  Flag,
  FolderTree,
  Gift,
  Handshake,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquareWarning,
  Plus,
  RefreshCw,
  Settings2,
  Activity,
  ShieldCheck,
  Star,
  Ticket,
  UserCog,
  Users,
  Wallet,
  X,
  Flame,
  BarChart3,
} from "lucide-react";
import { useI18n, type LabelKey } from "@/lib/i18n";
import { AdminSessionProvider, useAdminSession } from "@/lib/admin-session";
import { useLocationSearchParams } from "@/lib/use-location-search";
import { UploadQueueProvider } from "@/lib/upload-queue";
import { UploadTaskPanel } from "@/components/upload-task-panel";

type NavItem = {
  href: string;
  key: LabelKey;
  icon: LucideIcon;
  finance?: boolean;
  end?: boolean;
};

type NavGroup = {
  id: string;
  titleKey: LabelKey;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    titleKey: "navWorkspace",
    items: [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboard, end: true },
    ],
  },
  {
    id: "content",
    titleKey: "navContent",
    items: [
      { href: "/content/add", key: "contentAdd", icon: Plus, end: true },
      { href: "/rs-sync", key: "rsDramaSync", icon: RefreshCw, end: true },
      { href: "/content", key: "content", icon: Clapperboard, end: true },
      { href: "/content?view=pending", key: "contentPending", icon: ShieldCheck, end: true },
      { href: "/hottest", key: "hottest", icon: Flame, end: true },
      { href: "/tags", key: "dramaTagsPage", icon: FolderTree, end: true },
    ],
  },
  {
    id: "ops",
    titleKey: "navOps",
    items: [
      { href: "/banners", key: "banners", icon: LayoutGrid },
      { href: "/featured", key: "featured", icon: Star, end: true },
      { href: "/messages", key: "messages", icon: Inbox, end: true },
      { href: "/feedback", key: "feedback", icon: MessageSquareWarning, end: true },
    ],
  },
  {
    id: "users",
    titleKey: "navUsers",
    items: [
      { href: "/users/overview", key: "userOverview", icon: BarChart3, end: true },
      { href: "/users", key: "users", icon: Users, end: true },
    ],
  },
  {
    id: "finance",
    titleKey: "navFinance",
    items: [
      { href: "/orders", key: "orders", icon: CreditCard },
      { href: "/refunds", key: "refunds", icon: Flag, end: true },
      { href: "/vip-plans", key: "vipPlans", icon: Gift, finance: true },
      { href: "/redeem-codes", key: "redeemCodes", icon: Ticket, finance: true },
      { href: "/wallet", key: "wallet", icon: Coins, finance: true },
    ],
  },
  {
    id: "creators",
    titleKey: "navCreators",
    items: [
      { href: "/creators", key: "creators", icon: Handshake },
      { href: "/withdraws", key: "withdraws", icon: Wallet, finance: true },
    ],
  },
  {
    id: "system",
    titleKey: "navSystem",
    items: [
      { href: "/ops-monitor", key: "opsMonitor", icon: Activity, end: true },
      { href: "/admins", key: "admins", icon: UserCog, finance: true },
      { href: "/audit", key: "audit", icon: FileText },
      { href: "/settings", key: "settings", icon: Settings2, finance: true },
    ],
  },
];

const COLLAPSE_KEY = "velvet-admin-nav-collapsed";

function parseHref(href: string) {
  const [path, qs = ""] = href.split("?");
  return { path, params: new URLSearchParams(qs) };
}

function isActive(pathname: string, searchParams: URLSearchParams, item: NavItem) {
  const { path, params } = parseHref(item.href);

  if ([...params.keys()].length > 0) {
    // List presets: treat legacy status params as the same view.
    if (path === "/content" && params.get("view") === "pending") {
      const view = searchParams.get("view");
      const matched =
        view === "pending" ||
        (!view && searchParams.get("status") === "PENDING_REVIEW");
      return pathname === path && matched;
    }

    for (const [key, value] of params.entries()) {
      if (searchParams.get(key) !== value) return false;
    }
    return pathname === path;
  }

  if (path === "/content") {
    const view = searchParams.get("view");
    const status = searchParams.get("status");
    // Pending keeps its own nav item; latest bookmarks stay under 剧集管理.
    const isPending =
      view === "pending" || status === "PENDING_REVIEW";
    return pathname === "/content" && !isPending;
  }

  if (path === "/content/add") {
    return pathname === "/content/add";
  }

  if (path === "/users") {
    return pathname === "/users" && !searchParams.get("status");
  }

  if (path === "/users/overview") {
    return pathname === "/users/overview";
  }

  if (item.end) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function resolveCrumb(
  pathname: string,
  searchParams: URLSearchParams,
  items: NavItem[],
  t: ReturnType<typeof useI18n>["t"],
) {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!items.includes(item)) continue;
      if (isActive(pathname, searchParams, item)) {
        return { group: t(group.titleKey), label: t(item.key) };
      }
    }
  }
  return { group: t("navWorkspace"), label: t("dashboard") };
}

function loadCollapsed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const ShellNestedContext = createContext(false);
const PageTitleContext = createContext<{
  title?: string;
  setTitle: (title?: string) => void;
}>({ setTitle: () => {} });

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch
      onClick={onNavigate}
      className={[
        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm transition-colors",
        active
          ? "bg-brand-soft font-semibold text-brand"
          : "font-medium text-ink-muted hover:bg-white/50 hover:text-ink",
      ].join(" ")}
    >
      {active ? <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand" /> : null}
      <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? "text-brand" : "text-ink-subtle"} />
      <span className="truncate">{t(item.key)}</span>
    </Link>
  );
}

function SidebarNav({
  groups,
  pathname,
  searchParams,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  searchParams: URLSearchParams;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const activeGroupId = useMemo(() => {
    for (const group of groups) {
      if (group.items.some((item) => isActive(pathname, searchParams, item))) return group.id;
    }
    return groups[0]?.id;
  }, [groups, pathname, searchParams]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  useEffect(() => {
    if (!activeGroupId) return;
    setCollapsed((prev) => {
      if (prev[activeGroupId] !== true) return prev;
      const next = { ...prev, [activeGroupId]: false };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [activeGroupId]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2.5 pt-3 pb-20">
      {groups.map((group) => {
        const open = collapsed[group.id] !== true;
        return (
          <div key={group.id} className="pb-1.5">
            <button
              type="button"
              onClick={() => toggle(group.id)}
              className={[
                "flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-body-sm font-medium tracking-wide transition-colors",
                open
                  ? "border-line/80 bg-white/55 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                  : "border-transparent bg-white/30 text-ink hover:border-line/60 hover:bg-white/50",
              ].join(" ")}
            >
              <span>{t(group.titleKey)}</span>
              <ChevronDown
                size={15}
                strokeWidth={2}
                className={[
                  "shrink-0 text-ink-muted transition-transform",
                  open ? "" : "-rotate-90",
                ].join(" ")}
              />
            </button>
            {open ? (
              <div className="mt-1 space-y-0.5 border-l border-line/70 ml-2.5 pl-1.5">
                {group.items.map((item) => (
                  <NavLink
                    key={`${item.key}-${item.href}`}
                    item={item}
                    active={isActive(pathname, searchParams, item)}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function AccountMenu({
  account,
  role,
  onLogout,
}: {
  account: string;
  role: string;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-white/50"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-caption font-semibold text-brand">
          {account.charAt(0).toUpperCase()}
        </span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-[120px] truncate text-body-sm font-semibold text-ink">{account}</span>
          <span className="block text-caption text-ink-muted">{role}</span>
        </span>
        <ChevronDown size={14} className="hidden text-ink-muted sm:block" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-white/95 py-1 shadow-2 backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-line px-3 py-2 sm:hidden">
            <div className="truncate text-sm font-semibold text-ink">{account}</div>
            <div className="truncate text-xs text-ink-muted">{role}</div>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut size={14} />
            {t("logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AdminShellFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const searchParams = useLocationSearchParams();
  const { admin, ready, logout } = useAdminSession();
  const [pageTitle, setPageTitle] = useState<string | undefined>();
  const [mobileOpen, setMobileOpen] = useState(false);
  const setTitle = useCallback((next?: string) => setPageTitle(next), []);

  // Do not default missing role to SUPER_ADMIN — hide finance until role is known.
  const isSuperAdmin = admin?.role === "SUPER_ADMIN";
  const flatItems = useMemo(
    () => NAV_GROUPS.flatMap((g) => g.items).filter((n) => !n.finance || isSuperAdmin),
    [isSuperAdmin],
  );
  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((n) => !n.finance || isSuperAdmin),
      })).filter((g) => g.items.length > 0),
    [isSuperAdmin],
  );
  const crumb = resolveCrumb(pathname, searchParams, flatItems, t);
  const account = admin?.displayName || admin?.username || "Admin";

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, searchParams]);

  if (!ready) {
    return (
      <div className="relative min-h-screen text-ink">
        <div className="glass-bg" aria-hidden />
        <div className="relative z-10 flex min-h-screen items-center justify-center">
          <p className="text-sm text-ink-muted">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (!admin) {
    return null;
  }

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-4 py-4" prefetch>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="Velvet"
        width={32}
        height={32}
        className="h-8 w-8 rounded-md object-contain ring-1 ring-black/5"
      />
      <span>
        <span className="block text-sm font-semibold text-ink">Velvet Ops</span>
        <span className="mt-0.5 block text-caption text-ink-muted">{t("brandSubtitle")}</span>
      </span>
    </Link>
  );

  return (
    <PageTitleContext.Provider value={{ title: pageTitle, setTitle }}>
      <div className="relative min-h-screen text-ink">
        <div className="glass-bg" aria-hidden />

        <aside className="glass-sidebar fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col lg:flex">
          <div className="glass-sidebar-content flex h-full flex-col">
            <div className="border-b border-line">{brand}</div>
            <SidebarNav groups={visibleGroups} pathname={pathname} searchParams={searchParams} />
          </div>
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
              aria-label={t("closeMenu")}
              onClick={() => setMobileOpen(false)}
            />
            <aside className="glass-sidebar absolute inset-y-0 left-0 flex w-[260px] flex-col shadow-3">
              <div className="glass-sidebar-content flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-line pr-2">
                  {brand}
                  <button
                    type="button"
                    className="mr-2 grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-white/50 hover:text-ink"
                    onClick={() => setMobileOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <SidebarNav
                  groups={visibleGroups}
                  pathname={pathname}
                  searchParams={searchParams}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </aside>
          </div>
        ) : null}

        <div className="relative z-10 flex h-dvh flex-col overflow-hidden lg:pl-[232px]">
          <header className="glass-header shrink-0">
            <div className="flex h-12 items-center justify-between gap-3 px-3 md:px-5">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-white/50 hover:text-ink lg:hidden"
                  onClick={() => setMobileOpen(true)}
                  aria-label={t("openMenu")}
                >
                  <Menu size={18} />
                </button>
                <span className="hidden text-ink-muted sm:inline">{crumb.group}</span>
                <ChevronRight size={14} className="hidden shrink-0 text-ink-subtle sm:block" />
                <span className="truncate font-semibold text-ink">{pageTitle || crumb.label}</span>
              </div>
              <AccountMenu
                account={account}
                role={admin?.role || "—"}
                onLogout={() => void logout()}
              />
            </div>
          </header>

          <main className="admin-main flex w-full min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-5">
            {children}
          </main>
        </div>
      </div>
    </PageTitleContext.Provider>
  );
}

function AdminShellNested({ children, title }: { children: ReactNode; title?: string }) {
  const { setTitle } = useContext(PageTitleContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(undefined);
  }, [title, setTitle]);
  return <>{children}</>;
}

/** 布局级壳：会话 + 侧栏持久化，避免路由切换整页重挂载 */
export function AdminShellRoot({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <UploadQueueProvider>
        <ShellNestedContext.Provider value={true}>
          <AdminShellFrame>{children}</AdminShellFrame>
          <UploadTaskPanel />
        </ShellNestedContext.Provider>
      </UploadQueueProvider>
    </AdminSessionProvider>
  );
}

/**
 * 页面级用法：在布局壳内仅同步标题；若无布局壳则自行渲染完整壳（兼容旧页面）。
 */
export function AdminShell({ children, title }: { children: ReactNode; title?: string }) {
  const nested = useContext(ShellNestedContext);
  if (nested) {
    return <AdminShellNested title={title}>{children}</AdminShellNested>;
  }
  return (
    <AdminShellRoot>
      <AdminShellNested title={title}>{children}</AdminShellNested>
    </AdminShellRoot>
  );
}

export { fmtNum, fmtDate } from "@velvet/ui";
