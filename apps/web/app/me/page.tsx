"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  ChevronRight,
  Clapperboard,
  HelpCircle,
  Languages,
  LogOut,
  PenLine,
  Crown,
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
  requestRefund,
  updateMe,
  removeFavorite,
  removeLike,
  updateFavorite,
  uploadAvatar,
  redeemCode,
} from "@/lib/api";
import { cn, mediaUrl } from "@/lib/utils";

type DesktopTab = "favorites" | "history" | "orders";

export default function AccountPage() {
  const { user, ready, openLogin, openVip, logout, applySession } = useAuth();
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
      { favorites?: any[]; favGroups?: string[]; history?: any[]; likes?: any[]; orders?: any[] }
    >
  >(new Map());

  useEffect(() => {
    if (user?.nickname) setNickname(user.nickname);
    else if (user?.email) setNickname(user.email.split("@")[0]);
  }, [user]);

  const loadKind = useCallback(
    async (kind: "favorites" | "history" | "likes" | "orders", opts?: { force?: boolean }) => {
      if (!user) return;
      const key = `${kind}|${kind === "favorites" ? favGroup : ""}`;
      const cached = cacheRef.current.get(key);
      const hasCached =
        (kind === "favorites" && cached?.favorites) ||
        (kind === "history" && cached?.history) ||
        (kind === "likes" && cached?.likes) ||
        (kind === "orders" && cached?.orders);

      if (hasCached && !opts?.force) {
        if (kind === "favorites") {
          setFavorites(cached!.favorites || []);
          if (cached!.favGroups) setFavGroups(cached!.favGroups);
        } else if (kind === "history") setHistory(cached!.history || []);
        else if (kind === "likes") setLikes(cached!.likes || []);
        else setOrders(cached!.orders || []);
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
        } else {
          const r = await getMyOrders(1);
          const rows = r?.rows || [];
          cacheRef.current.set(key, { orders: rows });
          setOrders(rows);
        }
      } catch {
        if (kind === "favorites") setFavorites([]);
        else if (kind === "history") setHistory([]);
        else if (kind === "likes") setLikes([]);
        else setOrders([]);
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
    locale === "zh" ? d?.titleZh || d?.titleEn : d?.titleEn || d?.titleZh || "—";
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
              <div
                className="rounded-2xl border border-line/80 p-4"
                style={{
                  background:
                    "radial-gradient(280px 120px at 0% 0%, oklch(0.82 0.11 85 / 0.18), transparent 60%), var(--color-surface)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-overline uppercase tracking-widest text-gold">{t("vip.member")}</p>
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
                    className="shrink-0 rounded-full bg-gold px-4 py-2 text-body-sm font-semibold text-ink hover:opacity-90"
                  >
                    {user.isVip ? t("vip.renew") : t("vip.open")}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-line/80 bg-surface p-4">
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

        <div ref={listRef} className="mx-auto max-w-[800px] scroll-mt-20 px-4 pt-8 md:px-6">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {(
              [
                ["favorites", t("account.favorites")],
                ["history", t("account.history")],
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
                className={cn("space-y-2 transition-opacity duration-200", refreshing && "opacity-60")}
                aria-busy={refreshing}
              >
                <div className="flex flex-wrap gap-2">
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
                {favorites.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-body-sm text-ink-muted">{t("account.emptyFav")}</p>
                    <Link
                      href="/theater"
                      className="mt-3 inline-flex rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink hover:bg-surface-3"
                    >
                      {t("account.goTheater")}
                    </Link>
                  </div>
                )}
                {favorites.map((row) => {
                  const d = row.drama || row;
                  const slug = d.slug || d.id;
                  const dramaId = String(row.dramaId ?? d.id);
                  const editing = editId === dramaId;
                  return (
                    <div key={row.id || slug} className="rounded-lg bg-surface-2/60 px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <Link href={`/drama/${slug}`} className="flex min-w-0 flex-1 items-center gap-3">
                          {d.coverUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={d.coverUrl} alt="" className="h-14 w-10 rounded object-cover" />
                          )}
                          <div className="min-w-0">
                            <span className="truncate text-sm text-ink">{titleOf(d)}</span>
                            {(row.group || row.note) && (
                              <div className="truncate text-xs text-ink-muted">
                                {row.group ? `[${row.group}] ` : ""}
                                {row.note || ""}
                              </div>
                            )}
                          </div>
                        </Link>
                        <button
                          onClick={() => {
                            setEditId(editing ? null : dramaId);
                            setEditGroup(row.group || "");
                            setEditNote(row.note || "");
                          }}
                          className="text-xs text-ink-muted hover:text-ink"
                        >
                          {t("account.note")}
                        </button>
                        <button
                          onClick={async () => {
                            await removeFavorite(d.id);
                            void loadKind("favorites", { force: true });
                          }}
                          className="text-xs text-ink-muted hover:text-red-400"
                        >
                          ✕
                        </button>
                      </div>
                      {editing && (
                        <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-2">
                          <input
                            value={editGroup}
                            onChange={(e) => setEditGroup(e.target.value)}
                            placeholder={t("account.group")}
                            className="w-28 rounded-md border border-line bg-surface-3 px-2 py-1.5 text-xs text-ink"
                          />
                          <input
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            placeholder={t("account.note")}
                            className="min-w-[140px] flex-1 rounded-md border border-line bg-surface-3 px-2 py-1.5 text-xs text-ink"
                          />
                          <button
                            className="rounded-md bg-brand px-3 py-1.5 text-xs text-white"
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {(!loading || refreshing) && desktopTab === "history" && (
              <div
                className={cn("space-y-2 transition-opacity duration-200", refreshing && "opacity-60")}
                aria-busy={refreshing}
              >
                <div className="flex justify-end">
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
                {history.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-ink-muted">{t("account.emptyHistory")}</p>
                    <Link
                      href="/theater"
                      className="mt-3 inline-flex rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink hover:bg-surface-3"
                    >
                      {t("account.goTheater")}
                    </Link>
                  </div>
                )}
                {history.map((row) => {
                  const d = row.drama;
                  const slug = d?.slug || row.dramaId;
                  const epNo = row.episode?.episodeNumber;
                  return (
                    <Link
                      key={row.id}
                      href={`/drama/${slug}`}
                      className="flex items-center gap-3 rounded-lg bg-surface-2/60 px-3 py-2.5 transition-colors hover:bg-surface-2"
                    >
                      {d?.coverUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.coverUrl} alt="" className="h-14 w-10 rounded object-cover" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-ink">{titleOf(d)}</div>
                        <div className="text-xs text-ink-muted">
                          {epNo != null ? `${t("account.episode")} ${epNo}` : ""}
                          {row.progressSec
                            ? ` · ${Math.floor(row.progressSec / 60)}:${String(row.progressSec % 60).padStart(2, "0")}`
                            : ""}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {desktopTab === "orders" && (
              <div
                className={cn("space-y-2 transition-opacity duration-200", refreshing && "opacity-60")}
                aria-busy={refreshing}
              >
                {orders.length === 0 && (
                  <p className="py-8 text-center text-sm text-ink-muted">{t("account.emptyOrders")}</p>
                )}
                {orders.map((o) => {
                  const canRequest =
                    o.paymentStatus === "PAID" &&
                    (o.orderType === "TOPUP" || o.orderType === "EPISODE_UNLOCK") &&
                    !o.refundStatus;
                  return (
                    <div
                      key={o.orderNo}
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
