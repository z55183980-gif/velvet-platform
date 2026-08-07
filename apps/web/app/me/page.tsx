"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  ChevronRight,
  Clapperboard,
  HelpCircle,
  Heart,
  Languages,
  LogOut,
  PenLine,
  Crown,
  Sparkles,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { useLocale } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NotificationsModal } from "@/components/notifications-modal";
import { MobileMe, type MobileMeTab } from "@/components/mobile/mobile-me";
import {
  getFavorites,
  getFavoriteGroups,
  getWatchHistory,
  clearWatchHistory,
  getLikes,
  getMyOrders,
  getWalletTransactions,
  requestRefund,
  updateMe,
  removeFavorite,
  removeLike,
  updateFavorite,
  uploadAvatar,
  redeemCode,
} from "@/lib/api";
import { cn, formatAmount, mediaUrl } from "@/lib/utils";
import { pickTitleText } from "@/lib/languages";

type DesktopTab = "favorites" | "history" | "likes" | "orders";

type BillingFeedItem =
  | { kind: "order"; at: number; key: string; order: any }
  | { kind: "tx"; at: number; key: string; tx: any };

function mergeBillingFeed(orders: any[], transactions: any[]): BillingFeedItem[] {
  const rows: BillingFeedItem[] = [];
  for (const order of orders) {
    rows.push({
      kind: "order",
      at: order.createdAt ? new Date(order.createdAt).getTime() : 0,
      key: `order-${order.orderNo}`,
      order,
    });
  }
  for (const tx of transactions) {
    rows.push({
      kind: "tx",
      at: tx.createdAt ? new Date(tx.createdAt).getTime() : 0,
      key: `tx-${tx.id}`,
      tx,
    });
  }
  rows.sort((a, b) => b.at - a.at);
  return rows;
}

export default function AccountPage() {
  const { user, ready, openLogin, openVip, openRecharge, balance, logout, applySession } = useAuth();
  const { t, locale } = useLocale();

  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [desktopTab, setDesktopTab] = useState<DesktopTab>("favorites");
  const [mobileTab, setMobileTab] = useState<MobileMeTab>("history");
  const [favorites, setFavorites] = useState<any[]>([]);
  const [favGroups, setFavGroups] = useState<string[]>([]);
  const [favGroup, setFavGroup] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [likes, setLikes] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState("");
  const [editNote, setEditNote] = useState("");
  const [refundBusy, setRefundBusy] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);
  const [showNickname, setShowNickname] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const nicknameRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<
    Map<
      string,
      {
        favorites?: any[];
        favGroups?: string[];
        history?: any[];
        likes?: any[];
        orders?: any[];
        transactions?: any[];
      }
    >
  >(new Map());

  useEffect(() => {
    if (user?.nickname) setNickname(user.nickname);
    else if (user?.email) setNickname(user.email.split("@")[0]);
  }, [user]);

  const loadKind = useCallback(
    async (
      kind: "favorites" | "history" | "likes" | "orders" | "transactions",
      opts?: { force?: boolean },
    ) => {
      if (!user) return;
      const key = `${kind}|${kind === "favorites" ? favGroup : ""}`;
      const cached = cacheRef.current.get(key);
      const hasCached =
        (kind === "favorites" && cached?.favorites) ||
        (kind === "history" && cached?.history) ||
        (kind === "likes" && cached?.likes) ||
        (kind === "orders" && cached?.orders) ||
        (kind === "transactions" && cached?.transactions);

      if (hasCached && !opts?.force) {
        if (kind === "favorites") {
          setFavorites(cached!.favorites || []);
          if (cached!.favGroups) setFavGroups(cached!.favGroups);
        } else if (kind === "history") setHistory(cached!.history || []);
        else if (kind === "likes") setLikes(cached!.likes || []);
        else if (kind === "orders") setOrders(cached!.orders || []);
        else setTransactions(cached!.transactions || []);
        return;
      }

      try {
        if (kind === "favorites") {
          const [r, g] = await Promise.all([
            getFavorites(1, favGroup || undefined),
            getFavoriteGroups(),
          ]);
          const rows = r?.rows || [];
          const groups = g || [];
          cacheRef.current.set(key, { favorites: rows, favGroups: groups });
          setFavorites(rows);
          setFavGroups(groups);
        } else if (kind === "history") {
          const r = await getWatchHistory(1);
          const rows = r?.rows || [];
          cacheRef.current.set(key, { history: rows });
          setHistory(rows);
        } else if (kind === "likes") {
          const r = await getLikes(1);
          const rows = r?.rows || [];
          cacheRef.current.set(key, { likes: rows });
          setLikes(rows);
        } else if (kind === "orders") {
          const r = await getMyOrders(1);
          const rows = r?.rows || [];
          cacheRef.current.set(key, { orders: rows });
          setOrders(rows);
        } else {
          const r = await getWalletTransactions(1);
          const rows = r?.rows || [];
          cacheRef.current.set(key, { transactions: rows });
          setTransactions(rows);
        }
      } catch {
        if (kind === "favorites") setFavorites([]);
        else if (kind === "history") setHistory([]);
        else if (kind === "likes") setLikes([]);
        else if (kind === "orders") setOrders([]);
        else setTransactions([]);
      }
    },
    [user, favGroup],
  );

  // Prefetch lists once (mobile + desktop share cache); refresh favorites when group changes
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      const needsSkeleton =
        favorites.length === 0 &&
        history.length === 0 &&
        likes.length === 0 &&
        orders.length === 0;
      if (needsSkeleton) setInitialLoading(true);
      else setRefreshing(true);
      try {
        await Promise.all([
          loadKind("favorites"),
          loadKind("history"),
          loadKind("likes"),
          loadKind("orders"),
          loadKind("transactions"),
        ]);
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // favorites/history/orders lengths only gate first-paint skeleton
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, favGroup, loadKind]);

  const loading = initialLoading;

  const onSave = async () => {
    if (!nickname.trim()) return;
    setSaving(true);
    setSaved(false);
    setSaveErr(null);
    try {
      await updateMe({ nickname: nickname.trim() });
      await applySession();
      setSaved(true);
    } catch {
      setSaveErr(t("account.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const onAvatar = async (file: File | null) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      await uploadAvatar(file);
      await applySession();
    } catch {
      /* ignore */
    } finally {
      setAvatarBusy(false);
    }
  };

  const onRedeem = async () => {
    setRedeemBusy(true);
    setRedeemMsg(null);
    try {
      await redeemCode(code.trim());
      setCode("");
      setRedeemMsg(t("redeem.success"));
      await applySession();
    } catch (e: any) {
      setRedeemMsg(e?.message || t("redeem.fail"));
    } finally {
      setRedeemBusy(false);
    }
  };

  const onRefund = async (orderNo: string, reason: string) => {
    setRefundBusy(orderNo);
    try {
      await requestRefund(orderNo, reason);
      await loadKind("orders", { force: true });
    } catch {
      /* ignore */
    } finally {
      setRefundBusy(null);
    }
  };

  const billingFeed = useMemo(
    () => mergeBillingFeed(orders, transactions),
    [orders, transactions],
  );

  if (!ready) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-16 text-ink-muted">{t("common.loading")}</div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-[480px] px-4 py-20 text-center">
        <p className="text-overline uppercase tracking-widest text-brand">{t("account.title")}</p>
        <h1 className="mt-2 text-h2 font-semibold text-ink">{t("account.loginHint")}</h1>
        <p className="mt-3 text-body text-ink-muted">{t("account.loginVipHint")}</p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() => openLogin("login")}
            className="rounded-full bg-brand px-6 py-3 text-body-sm font-medium text-white hover:opacity-90"
          >
            {t("account.loginNow")}
          </button>
          <button
            onClick={() => openLogin("register")}
            className="rounded-full bg-gold px-6 py-3 text-body-sm font-semibold text-ink hover:opacity-90"
          >
            {t("account.freeRegister")}
          </button>
        </div>
      </div>
    );
  }

  const titleOf = (d: any) =>
    pickTitleText(locale, d?.titleEn || "", d?.titleZh || "") || "—";
  const avatar = mediaUrl(user.avatarUrl);

  return (
    <div className="pb-16 md:pb-24">
      <MobileMe
        user={user}
        nickname={nickname}
        setNickname={(v) => {
          setNickname(v);
          setSaved(false);
          setSaveErr(null);
        }}
        saving={saving}
        saved={saved}
        saveErr={saveErr}
        avatarBusy={avatarBusy}
        onSave={() => void onSave()}
        onAvatar={(f) => void onAvatar(f)}
        onLogout={() => logout()}
        openVip={openVip}
        openRecharge={openRecharge}
        balance={balance}
        t={t}
        locale={locale}
        titleOf={titleOf}
        tab={mobileTab}
        setTab={setMobileTab}
        favorites={favorites}
        favGroups={favGroups}
        favGroup={favGroup}
        setFavGroup={setFavGroup}
        history={history}
        likes={likes}
        orders={orders}
        transactions={transactions}
        loading={
          loading &&
          (mobileTab === "history" || mobileTab === "favorites" || mobileTab === "liked")
        }
        refreshing={
          refreshing &&
          (mobileTab === "history" || mobileTab === "favorites" || mobileTab === "liked")
        }
        onRefresh={(opts) => {
          const kind =
            mobileTab === "liked" ? "likes" : (mobileTab as "favorites" | "history");
          void (async () => {
            setRefreshing(true);
            try {
              await loadKind(kind, opts);
            } finally {
              setRefreshing(false);
            }
          })();
        }}
        onRemoveFavorite={async (dramaId) => {
          await removeFavorite(dramaId);
        }}
        onRemoveLike={async (dramaId) => {
          await removeLike(dramaId);
          setLikes((prev) => prev.filter((r) => String(r.dramaId ?? r.drama?.id) !== String(dramaId)));
          cacheRef.current.delete("likes|");
        }}
        onClearHistory={async () => {
          await clearWatchHistory();
          setRefreshing(true);
          try {
            await loadKind("history", { force: true });
          } finally {
            setRefreshing(false);
          }
        }}
        code={code}
        setCode={(v) => {
          setCode(v);
          setRedeemMsg(null);
        }}
        redeemBusy={redeemBusy}
        redeemMsg={redeemMsg}
        onRedeem={onRedeem}
        showNickname={showNickname}
        setShowNickname={setShowNickname}
        showHelp={showHelp}
        setShowHelp={setShowHelp}
        refundBusy={refundBusy}
        onRefund={onRefund}
      />

      {/* Desktop layout — preserved */}
      <div className="hidden md:block">
        <div
          className="border-b border-line"
          style={{
            background:
              "radial-gradient(900px 280px at 15% -40%, oklch(0.68 0.19 18 / 0.18), transparent 55%), var(--color-base)",
          }}
        >
          <div className="mx-auto max-w-[800px] px-4 py-8 md:px-6 md:py-12">
            <div className="flex items-start gap-4 md:gap-5">
              <label className="relative grid h-16 w-16 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-surface-2 ring-2 ring-line md:h-20 md:w-20">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-h3 font-semibold text-ink-muted">
                    {(nickname || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="absolute inset-0 opacity-0"
                  disabled={avatarBusy}
                  onChange={(e) => onAvatar(e.target.files?.[0] || null)}
                />
              </label>

              <div className="min-w-0 flex-1">
                <p className="text-overline uppercase tracking-widest text-brand">{t("account.title")}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h1 className="text-h3 font-bold text-ink md:text-h2">
                    {nickname || t("account.title")}
                  </h1>
                  {user.isVip && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-0.5 text-caption font-semibold text-gold">
                      <Crown className="h-3 w-3" />
                      {t("account.vipBadge")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-body-sm text-ink-muted">
                  {avatarBusy
                    ? t("account.uploading")
                    : user.isVip && user.vipExpireAt
                      ? t("vip.activeUntil", {
                          date: new Date(user.vipExpireAt).toLocaleDateString(locale),
                        })
                      : user.email || user.phone || t("account.subtitle")}
                </p>
              </div>

              <button
                onClick={() => logout()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-body-sm text-ink-muted hover:text-ink md:px-4"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("account.logout")}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              className="mt-8 flex w-full items-center gap-3 rounded-2xl border border-line/80 bg-surface/80 px-4 py-3.5 transition-colors hover:bg-surface-2"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/15">
                <Bell className="h-5 w-5 text-brand" />
              </span>
              <span className="min-w-0 flex-1 text-left text-body-sm font-medium text-ink">
                {t("account.messages")}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />
            </button>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={openRecharge}
                className="rounded-2xl border border-brand/20 p-4 text-left transition-colors hover:bg-surface-2/60"
                style={{
                  background:
                    "radial-gradient(280px 120px at 100% 0%, oklch(0.68 0.19 18 / 0.14), transparent 60%), var(--color-surface)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-brand" />
                      <p className="text-overline uppercase tracking-widest text-brand">
                        {t("account.balance")}
                      </p>
                    </div>
                    <p className="mt-2 text-[1.75rem] font-bold tabular-nums leading-none text-ink">
                      {balance != null ? formatAmount(balance) : "—"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-brand px-4 py-2 text-body-sm font-medium text-white">
                    {t("account.recharge")}
                  </span>
                </div>
              </button>

              <div
                className={cn(
                  "rounded-2xl border p-4",
                  user.isVip ? "border-gold/55" : "border-line/80",
                )}
                style={{
                  background: user.isVip
                    ? "radial-gradient(320px 140px at 0% 0%, oklch(0.82 0.12 85 / 0.32), transparent 62%), linear-gradient(135deg, oklch(0.82 0.11 85 / 0.08), transparent 50%), var(--color-surface)"
                    : "radial-gradient(280px 120px at 0% 0%, oklch(0.82 0.11 85 / 0.18), transparent 60%), var(--color-surface)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Crown className="h-3.5 w-3.5 text-gold" />
                      <p className="text-overline uppercase tracking-widest text-gold">
                        {t("vip.member")}
                      </p>
                    </div>
                    <p className="mt-1 text-body font-medium text-ink">
                      {user.isVip && user.vipExpireAt
                        ? t("vip.activeUntil", {
                            date: new Date(user.vipExpireAt).toLocaleDateString(locale),
                          })
                        : t("vip.inactive")}
                    </p>
                    {!user.isVip && (
                      <p className="mt-1 text-caption text-ink-muted">{t("vip.benefitWatch")}</p>
                    )}
                    {user.isVip && (
                      <p className="mt-1 text-caption text-ink-muted">{t("vip.benefitNoCredits")}</p>
                    )}
                  </div>
                  <button
                    onClick={openVip}
                    className={cn(
                      "shrink-0 rounded-full px-4 py-2 text-body-sm font-semibold transition-colors",
                      user.isVip
                        ? "border border-gold/70 bg-transparent text-gold hover:bg-gold/10"
                        : "bg-gold text-ink hover:opacity-90",
                    )}
                  >
                    {user.isVip ? t("vip.renew") : t("vip.open")}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-line/80 bg-surface p-4 sm:col-span-2">
                <p className="text-overline uppercase tracking-widest text-ink-subtle">
                  {t("vip.redeemSection")}
                </p>
                <p className="mt-1 text-caption text-ink-muted">{t("redeem.hint")}</p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setRedeemMsg(null);
                    }}
                    placeholder={t("redeem.placeholder")}
                    className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2.5 text-body-sm text-ink outline-none"
                  />
                  <button
                    disabled={redeemBusy || !code.trim()}
                    onClick={() => void onRedeem()}
                    className="shrink-0 rounded-full bg-surface-2 px-4 py-2.5 text-body-sm font-medium text-ink disabled:opacity-50 hover:bg-surface-3"
                  >
                    {t("redeem.submit")}
                  </button>
                </div>
                {redeemMsg ? (
                  <p
                    className={cn(
                      "mt-2 text-caption",
                      redeemMsg === t("redeem.success") ? "text-success" : "text-danger",
                    )}
                  >
                    {redeemMsg}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-line/80 bg-surface">
              <button
                type="button"
                onClick={() => {
                  setShowNickname((v) => !v);
                  if (!showNickname) {
                    requestAnimationFrame(() =>
                      nicknameRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
                    );
                  }
                }}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
              >
                <PenLine className="h-4 w-4 text-ink-muted" />
                <span className="flex-1 text-body-sm text-ink">{t("account.editNickname")}</span>
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-ink-subtle transition-transform",
                    showNickname && "rotate-90",
                  )}
                />
              </button>

              {showNickname && (
                <div ref={nicknameRef} className="border-t border-line px-4 py-4">
                  <label className="text-caption uppercase text-ink-subtle">{t("account.nickname")}</label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <input
                      value={nickname}
                      onChange={(e) => {
                        setNickname(e.target.value);
                        setSaved(false);
                        setSaveErr(null);
                      }}
                      className="min-w-[12rem] flex-1 rounded-lg bg-surface-2 px-4 py-2.5 text-body text-ink outline-none focus:bg-surface-3"
                    />
                    <button
                      onClick={onSave}
                      disabled={saving || !nickname.trim()}
                      className="rounded-full bg-brand px-4 py-2.5 text-body-sm font-medium text-white disabled:opacity-50"
                    >
                      {saved ? t("account.saved") : t("account.save")}
                    </button>
                  </div>
                  {saveErr ? <p className="mt-2 text-caption text-danger">{saveErr}</p> : null}
                </div>
              )}

              <div className="flex items-center gap-3 border-t border-line px-4 py-3">
                <Languages className="h-4 w-4 text-ink-muted" />
                <span className="flex-1 text-body-sm text-ink">{t("account.language")}</span>
                <LanguageSwitcher />
              </div>

              <Link
                href="/creator/"
                className="flex items-center gap-3 border-t border-line px-4 py-3.5 transition-colors hover:bg-surface-2"
              >
                <Clapperboard className="h-4 w-4 text-ink-muted" />
                <span className="flex-1 text-body-sm text-ink">{t("account.creatorCenter")}</span>
                <ChevronRight className="h-4 w-4 text-ink-subtle" />
              </Link>

              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
              >
                <HelpCircle className="h-4 w-4 text-ink-muted" />
                <span className="flex-1 text-body-sm text-ink">{t("account.helpAbout")}</span>
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-ink-subtle transition-transform",
                    showHelp && "rotate-90",
                  )}
                />
              </button>
              {showHelp && (
                <p className="border-t border-line px-4 py-3 text-body-sm text-ink-muted">
                  {t("account.helpBody")}
                </p>
              )}
            </div>
          </div>
        </div>

        <div ref={listRef} className="mx-auto max-w-[1100px] scroll-mt-20 px-4 pt-8 md:px-6">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {(
              [
                ["favorites", t("account.favorites")],
                ["history", t("account.history")],
                ["likes", t("account.tabLiked")],
                ["orders", t("account.orders")],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setDesktopTab(k)}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2 text-body-sm transition-colors",
                  desktopTab === k
                    ? "bg-brand text-white"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-6 min-h-[160px]">
            {loading && desktopTab !== "orders" && (
              <p className="text-body-sm text-ink-muted">{t("common.loading")}</p>
            )}

            {(!loading || refreshing) && desktopTab === "favorites" && (
              <div
                className={cn("transition-opacity duration-200", refreshing && "opacity-60")}
                aria-busy={refreshing}
              >
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => setFavGroup("")}
                    className={cn(
                      "rounded-full px-3 py-1 text-caption",
                      !favGroup ? "bg-brand text-white" : "bg-surface-2 text-ink-muted",
                    )}
                  >
                    {t("account.allGroups")}
                  </button>
                  {favGroups.map((g) => (
                    <button
                      key={g}
                      onClick={() => setFavGroup(g)}
                      className={cn(
                        "rounded-full px-3 py-1 text-caption",
                        favGroup === g ? "bg-brand text-white" : "bg-surface-2 text-ink-muted",
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                {favorites.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-body-sm text-ink-muted">{t("account.emptyFav")}</p>
                    <Link
                      href="/theater"
                      className="mt-3 inline-flex rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink hover:bg-surface-3"
                    >
                      {t("account.goTheater")}
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-x-3 gap-y-5 xl:grid-cols-5">
                    {favorites.map((row) => {
                      const d = row.drama || row;
                      const slug = d.slug || d.id;
                      const dramaId = String(row.dramaId ?? d.id);
                      const editing = editId === dramaId;
                      return (
                        <div key={row.id || slug} className="group relative min-w-0">
                          <Link href={`/drama/${slug}`} className="block">
                            <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
                              {d.coverUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={d.coverUrl}
                                  alt=""
                                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                                />
                              ) : null}
                            </div>
                            <p className="mt-2 line-clamp-2 text-sm leading-snug text-ink">
                              {titleOf(d)}
                            </p>
                            {(row.group || row.note) && (
                              <p className="mt-0.5 truncate text-xs text-ink-muted">
                                {row.group ? `[${row.group}] ` : ""}
                                {row.note || ""}
                              </p>
                            )}
                          </Link>
                          <div className="pointer-events-none absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                            <button
                              type="button"
                              title={t("account.note")}
                              onClick={() => {
                                setEditId(editing ? null : dramaId);
                                setEditGroup(row.group || "");
                                setEditNote(row.note || "");
                              }}
                              className="grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white backdrop-blur-sm hover:bg-black/80"
                            >
                              <PenLine className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title={t("account.favorites")}
                              onClick={async () => {
                                await removeFavorite(d.id);
                                void loadKind("favorites", { force: true });
                              }}
                              className="grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white backdrop-blur-sm hover:bg-red-500/90"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {editing && (
                            <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-10 space-y-2 rounded-lg border border-line bg-surface p-2 shadow-lg">
                              <input
                                value={editGroup}
                                onChange={(e) => setEditGroup(e.target.value)}
                                placeholder={t("account.group")}
                                className="w-full rounded-md border border-line bg-surface-3 px-2 py-1.5 text-xs text-ink"
                              />
                              <input
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                placeholder={t("account.note")}
                                className="w-full rounded-md border border-line bg-surface-3 px-2 py-1.5 text-xs text-ink"
                              />
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  className="flex-1 rounded-md bg-brand px-2 py-1.5 text-xs text-white"
                                  onClick={async () => {
                                    await updateFavorite(dramaId, {
                                      group: editGroup.trim() || null,
                                      note: editNote.trim() || null,
                                    });
                                    setEditId(null);
                                    void loadKind("favorites", { force: true });
                                  }}
                                >
                                  {t("account.save")}
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md bg-surface-2 px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                                  onClick={() => setEditId(null)}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {(!loading || refreshing) && desktopTab === "history" && (
              <div
                className={cn("transition-opacity duration-200", refreshing && "opacity-60")}
                aria-busy={refreshing}
              >
                <div className="mb-4 flex justify-end">
                  {history.length > 0 && (
                    <button
                      onClick={async () => {
                        await clearWatchHistory();
                        void loadKind("history", { force: true });
                      }}
                      className="text-xs text-ink-muted hover:text-ink"
                    >
                      {t("account.clearHistory")}
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-ink-muted">{t("account.emptyHistory")}</p>
                    <Link
                      href="/theater"
                      className="mt-3 inline-flex rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink hover:bg-surface-3"
                    >
                      {t("account.goTheater")}
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-x-3 gap-y-5 xl:grid-cols-5">
                    {history.map((row) => {
                      const d = row.drama;
                      const slug = d?.slug || row.dramaId;
                      const epNo = row.episode?.episodeNumber;
                      const progress =
                        epNo != null
                          ? t("account.watchedToEpisode", { n: Number(epNo) })
                          : null;
                      const timeLabel = row.progressSec
                        ? `${Math.floor(row.progressSec / 60)}:${String(row.progressSec % 60).padStart(2, "0")}`
                        : null;
                      return (
                        <Link
                          key={row.id}
                          href={`/drama/${slug}/play`}
                          className="group min-w-0"
                        >
                          <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
                            {d?.coverUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={d.coverUrl}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                              />
                            ) : null}
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-snug text-ink">
                            {titleOf(d)}
                          </p>
                          {(progress || timeLabel) && (
                            <p className="mt-0.5 truncate text-xs text-ink-muted">
                              {[progress, timeLabel].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {(!loading || refreshing) && desktopTab === "likes" && (
              <div
                className={cn("transition-opacity duration-200", refreshing && "opacity-60")}
                aria-busy={refreshing}
              >
                {likes.length === 0 ? (
                  <div className="py-8 text-center">
                    <Heart className="mx-auto h-8 w-8 text-ink-subtle" />
                    <p className="mt-3 text-body-sm text-ink-muted">{t("account.emptyLiked")}</p>
                    <Link
                      href="/theater"
                      className="mt-3 inline-flex rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink hover:bg-surface-3"
                    >
                      {t("account.goTheater")}
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-x-3 gap-y-5 xl:grid-cols-5">
                    {likes.map((row) => {
                      const d = row.drama || row;
                      const slug = d.slug || d.id;
                      const dramaId = String(row.dramaId ?? d.id);
                      return (
                        <div key={row.id || slug} className="group relative min-w-0">
                          <Link href={`/drama/${slug}`} className="block">
                            <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
                              {d.coverUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={d.coverUrl}
                                  alt=""
                                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                                />
                              ) : null}
                            </div>
                            <p className="mt-2 line-clamp-2 text-sm leading-snug text-ink">
                              {titleOf(d)}
                            </p>
                          </Link>
                          <button
                            type="button"
                            title={t("account.tabLiked")}
                            onClick={async () => {
                              await removeLike(dramaId);
                              setLikes((prev) =>
                                prev.filter(
                                  (r) => String(r.dramaId ?? r.drama?.id) !== dramaId,
                                ),
                              );
                              cacheRef.current.delete("likes|");
                            }}
                            className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-red-500/90 group-hover:opacity-100 group-focus-within:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {desktopTab === "orders" && (
              <div
                className={cn("space-y-2 transition-opacity duration-200", refreshing && "opacity-60")}
                aria-busy={refreshing}
              >
                {billingFeed.length === 0 && (
                  <p className="py-8 text-center text-sm text-ink-muted">{t("account.emptyOrders")}</p>
                )}
                {billingFeed.map((item) => {
                  if (item.kind === "order") {
                    const o = item.order;
                    const canRequest =
                      o.paymentStatus === "PAID" &&
                      (o.orderType === "TOPUP" || o.orderType === "EPISODE_UNLOCK") &&
                      !o.refundStatus;
                    return (
                      <div
                        key={item.key}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-ink">{o.orderNo}</div>
                          <div className="text-xs text-ink-muted">
                            {o.orderType} · {o.paymentStatus}
                            {o.refundStatus ? ` · ${o.refundStatus}` : ""}
                            {" · "}
                            {o.createdAt ? new Date(o.createdAt).toLocaleString(locale) : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {canRequest ? (
                            <button
                              type="button"
                              disabled={refundBusy === o.orderNo}
                              className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                              onClick={() =>
                                void onRefund(
                                  o.orderNo,
                                  o.orderType === "TOPUP"
                                    ? t("account.refundTopup")
                                    : t("account.refundUnlock"),
                                )
                              }
                            >
                              {t("account.requestRefund")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  }

                  const tx = item.tx;
                  const amount = Number(tx.amountCredits ?? 0);
                  const positive = amount > 0;
                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-ink">{tx.type}</div>
                        <div className="truncate text-xs text-ink-muted">
                          {tx.remark || ""}
                          {tx.createdAt ? ` · ${new Date(tx.createdAt).toLocaleString(locale)}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={cn(
                            "text-sm font-semibold tabular-nums",
                            positive ? "text-success" : "text-danger",
                          )}
                        >
                          {positive ? "+" : ""}
                          {formatAmount(amount)}
                        </div>
                        <div className="text-xs text-ink-subtle tabular-nums">
                          {formatAmount(Number(tx.balanceAfter ?? 0))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {orders.length > 0 && (
                  <p className="pt-1 text-caption text-ink-muted">{t("account.refundHint")}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <NotificationsModal open={notifOpen} onClose={() => setNotifOpen(false)} />
    </div>
  );
}
