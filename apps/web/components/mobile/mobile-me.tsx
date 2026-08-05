"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Check,
  ChevronRight,
  Clapperboard,
  Crown,
  Heart,
  HelpCircle,
  Languages,
  LogOut,
  Moon,
  PenLine,
  Search,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  Ticket,
  X,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { cn, mediaUrl } from "@/lib/utils";
import { isPwaStandalone, openPwaInstallGuide } from "@/lib/pwa";

export type MobileMeTab = "history" | "favorites" | "liked";

type TitleOf = (d: any) => string;

type Props = {
  user: {
    nickname?: string | null;
    email?: string | null;
    phone?: string | null;
    avatarUrl?: string | null;
    isVip?: boolean;
    vipExpireAt?: string | Date | null;
  };
  nickname: string;
  setNickname: (v: string) => void;
  saving: boolean;
  saved: boolean;
  saveErr: string | null;
  avatarBusy: boolean;
  onSave: () => void;
  onAvatar: (file: File | null) => void;
  onLogout: () => void;
  openVip: () => void;
  openRecharge: () => void;
  balance: number | null;
  t: (path: string, vars?: Record<string, string | number>) => string;
  locale: string;
  titleOf: TitleOf;
  tab: MobileMeTab;
  setTab: (t: MobileMeTab) => void;
  favorites: any[];
  favGroups: string[];
  favGroup: string;
  setFavGroup: (g: string) => void;
  history: any[];
  likes: any[];
  orders: any[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: (opts?: { force?: boolean }) => void;
  onRemoveFavorite: (dramaId: string | number) => Promise<void>;
  onRemoveLike: (dramaId: string | number) => Promise<void>;
  onClearHistory: () => Promise<void>;
  code: string;
  setCode: (v: string) => void;
  redeemBusy: boolean;
  redeemMsg: string | null;
  onRedeem: () => Promise<void>;
  showNickname: boolean;
  setShowNickname: (v: boolean | ((p: boolean) => boolean)) => void;
  showHelp: boolean;
  setShowHelp: (v: boolean | ((p: boolean) => boolean)) => void;
  refundBusy: string | null;
  onRefund: (orderNo: string, reason: string) => Promise<void>;
};

function progressLabel(
  row: any,
  t: Props["t"],
): string | null {
  const epNo = row.episode?.episodeNumber;
  if (epNo != null && Number.isFinite(Number(epNo))) {
    return t("account.watchedToEpisode", { n: Number(epNo) });
  }
  return null;
}

/** Finished = latest progress reached the drama's last episode. */
function isHistoryFinished(row: any): boolean {
  if (typeof row?.finished === "boolean") return row.finished;
  const total = Number(row?.drama?.totalEpisodes || 0);
  const epNo = Number(row?.episode?.episodeNumber || 0);
  return total > 0 && epNo >= total;
}

type HistoryStatusFilter = "all" | "finished" | "unfinished";

export function MobileMe(props: Props) {
  const {
    user,
    nickname,
    setNickname,
    saving,
    saved,
    saveErr,
    avatarBusy,
    onSave,
    onAvatar,
    onLogout,
    openVip,
    openRecharge,
    balance,
    t,
    locale,
    titleOf,
    tab,
    setTab,
    favorites,
    favGroups,
    favGroup,
    setFavGroup,
    history,
    likes,
    orders,
    loading,
    refreshing,
    onRefresh,
    onRemoveFavorite,
    onRemoveLike,
    onClearHistory,
    code,
    setCode,
    redeemBusy,
    redeemMsg,
    onRedeem,
    showNickname,
    setShowNickname,
    showHelp,
    setShowHelp,
    refundBusy,
    onRefund,
  } = props;

  const { resolved, setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showGroups, setShowGroups] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatusFilter>("all");
  const [themeMounted, setThemeMounted] = useState(false);

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  const avatar = mediaUrl(user.avatarUrl);

  const matchesQuery = (title: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return title.toLowerCase().includes(q);
  };

  const historyRows = useMemo(
    () =>
      history.filter((row) => {
        const d = row.drama;
        if (!matchesQuery(titleOf(d))) return false;
        if (historyStatus === "finished") return isHistoryFinished(row);
        if (historyStatus === "unfinished") return !isHistoryFinished(row);
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, query, locale, historyStatus],
  );

  const favoriteRows = useMemo(
    () =>
      favorites.filter((row) => {
        const d = row.drama || row;
        return matchesQuery(titleOf(d));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites, query, locale],
  );

  const likedRows = useMemo(
    () =>
      likes.filter((row) => {
        const d = row.drama || row;
        return matchesQuery(titleOf(d));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [likes, query, locale],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitEdit = () => {
    setEditing(false);
    setSelected(new Set());
  };

  const onTabChange = (next: MobileMeTab) => {
    exitEdit();
    setShowGroups(false);
    setHistoryStatus("all");
    setTab(next);
  };

  const deleteSelectedFavorites = async () => {
    const ids = [...selected];
    for (const id of ids) {
      await onRemoveFavorite(id);
    }
    exitEdit();
    onRefresh({ force: true });
  };

  const deleteSelectedLikes = async () => {
    const ids = [...selected];
    for (const id of ids) {
      await onRemoveLike(id);
    }
    exitEdit();
    onRefresh({ force: true });
  };

  const tabs: { key: MobileMeTab; label: string }[] = [
    { key: "history", label: t("account.tabHistory") },
    { key: "favorites", label: t("account.tabFavorites") },
    { key: "liked", label: t("account.tabLiked") },
  ];

  return (
    <div className="md:hidden">
      {/* Top actions: night mode + settings */}
      <div className="flex items-center justify-end gap-1 px-3 pt-2">
        <button
          type="button"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
          className="grid h-10 w-10 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
          aria-label={t("account.nightMode")}
          title={t("account.nightMode")}
        >
          {themeMounted ? (
            resolved === "dark" ? (
              <Moon className="h-5 w-5" />
            ) : (
              <Sun className="h-5 w-5" />
            )
          ) : (
            <span className="inline-block h-5 w-5" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
          aria-label={t("account.settingsTitle")}
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>

      {/* Avatar + name */}
      <div className="mt-1 flex items-center gap-3.5 px-4">
        <label className="relative grid h-[4.25rem] w-[4.25rem] shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-surface-2 ring-2 ring-line">
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
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[1.35rem] font-bold leading-tight text-ink">
              {nickname || t("account.title")}
            </h1>
            {user.isVip && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-caption font-semibold text-gold">
                <Crown className="h-3 w-3" />
                {t("account.vipBadge")}
              </span>
            )}
          </div>
          <p className="mt-1 text-body-sm text-ink-muted">
            {avatarBusy ? t("account.uploading") : t("account.bioHint")}
          </p>
        </div>
      </div>

      {/* Credits + VIP */}
      <div className="mt-6 grid grid-cols-2 gap-2.5 px-4">
        <button
          type="button"
          onClick={openRecharge}
          className="rounded-2xl border border-brand/20 bg-surface p-3.5 text-left transition-colors active:bg-surface-2"
          style={{
            background:
              "radial-gradient(200px 100px at 100% 0%, oklch(0.68 0.19 18 / 0.14), transparent 65%), var(--color-surface)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            <p className="text-overline uppercase tracking-widest text-brand">
              {t("account.balance")}
            </p>
          </div>
          <p className="mt-2 truncate text-[1.35rem] font-bold tabular-nums leading-none text-ink">
            {balance != null ? balance.toLocaleString(locale) : "—"}
          </p>
          <p className="mt-2 text-caption font-medium text-brand">{t("account.recharge")}</p>
        </button>

        <div
          className="rounded-2xl border border-gold/25 p-3.5"
          style={{
            background:
              "radial-gradient(200px 100px at 0% 0%, oklch(0.82 0.11 85 / 0.22), transparent 65%), var(--color-surface)",
          }}
        >
          <p className="text-overline uppercase tracking-widest text-gold">{t("vip.member")}</p>
          <p className="mt-2 line-clamp-2 text-body-sm font-medium leading-snug text-ink">
            {user.isVip && user.vipExpireAt
              ? t("vip.activeUntil", {
                  date: new Date(user.vipExpireAt).toLocaleDateString(locale),
                })
              : t("vip.inactive")}
          </p>
          <button
            type="button"
            onClick={openVip}
            className="mt-2 text-caption font-semibold text-gold"
          >
            {user.isVip ? t("vip.renew") : t("vip.open")}
          </button>
        </div>
      </div>

      {/* Content tabs + search */}
      <div className="mt-6 flex items-end gap-1 border-b border-line px-4">
        <div className="flex min-w-0 flex-1 gap-5 overflow-x-auto">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => onTabChange(key)}
              className={cn(
                "relative shrink-0 pb-2.5 text-[15px] transition-colors",
                tab === key ? "font-semibold text-ink" : "font-normal text-ink-muted",
              )}
            >
              {label}
              {tab === key && (
                <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-brand" />
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setSearchOpen((v) => !v);
            if (searchOpen) setQuery("");
          }}
          className="mb-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
          aria-label={t("account.searchPlaceholder")}
        >
          {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
        </button>
      </div>

      {searchOpen && (
        <div className="border-b border-line px-4 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("account.searchPlaceholder")}
            className="w-full rounded-xl bg-surface-2 px-3 py-2.5 text-body-sm text-ink outline-none placeholder:text-ink-subtle"
            autoFocus
          />
        </div>
      )}

      {/* Filter pills */}
      <div className="mt-3 flex items-center gap-2 overflow-x-auto px-4 pb-1">
        {tab === "history" ? (
          <>
            {(
              [
                ["all", t("account.allGroups")],
                ["finished", t("account.filterFinished")],
                ["unfinished", t("account.filterUnfinished")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setHistoryStatus(key)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-caption font-medium transition-colors",
                  historyStatus === key
                    ? "bg-brand text-white"
                    : "bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </>
        ) : (
          <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-caption font-medium text-ink">
            {t("account.allGroups")}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {tab === "favorites" ? (
            <button
              type="button"
              onClick={() => setShowGroups((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-caption",
                showGroups ? "bg-brand/15 text-brand" : "text-ink-muted hover:bg-surface-2",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t("account.filterAction")}
            </button>
          ) : tab === "liked" ? (
            <button
              type="button"
              disabled
              title={t("account.filterStatusHint")}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-caption text-ink-subtle disabled:cursor-not-allowed"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t("account.filterAction")}
            </button>
          ) : null}
          {(tab === "history" || tab === "favorites" || tab === "liked") && (
            <button
              type="button"
              onClick={() => {
                if (editing) exitEdit();
                else setEditing(true);
              }}
              className={cn(
                "rounded-full px-2.5 py-1.5 text-caption",
                editing ? "bg-brand/15 text-brand" : "text-ink-muted hover:bg-surface-2",
              )}
            >
              {editing ? t("account.doneAction") : t("account.editAction")}
            </button>
          )}
        </div>
      </div>

      {showGroups && tab === "favorites" && (
        <div className="mt-2 flex flex-wrap gap-2 px-4">
          <button
            type="button"
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
              type="button"
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
      )}

      {editing && tab === "history" && historyRows.length > 0 && (
        <div className="mt-2 flex justify-end px-4">
          <button
            type="button"
            onClick={async () => {
              await onClearHistory();
              exitEdit();
            }}
            className="text-caption text-danger"
          >
            {t("account.clearHistory")}
          </button>
        </div>
      )}

      {editing && tab === "favorites" && selected.size > 0 && (
        <div className="mt-2 flex justify-end px-4">
          <button
            type="button"
            onClick={() => void deleteSelectedFavorites()}
            className="text-caption text-danger"
          >
            {t("account.deleteSelected")} ({selected.size})
          </button>
        </div>
      )}

      {editing && tab === "liked" && selected.size > 0 && (
        <div className="mt-2 flex justify-end px-4">
          <button
            type="button"
            onClick={() => void deleteSelectedLikes()}
            className="text-caption text-danger"
          >
            {t("account.deleteSelected")} ({selected.size})
          </button>
        </div>
      )}

      {/* Lists / grids */}
      <div
        className={cn(
          "min-h-[200px] px-3 pb-6 pt-3 transition-opacity duration-200",
          refreshing && "opacity-60",
        )}
        aria-busy={refreshing}
      >
        {loading && <p className="px-1 text-body-sm text-ink-muted">{t("common.loading")}</p>}

        {(!loading || refreshing) && tab === "history" && (
          <>
            {historyRows.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-body-sm text-ink-muted">{t("account.emptyHistory")}</p>
                <Link
                  href="/theater"
                  className="mt-3 inline-flex rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink"
                >
                  {t("account.goTheater")}
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-x-2 gap-y-4">
                {historyRows.map((row) => {
                  const d = row.drama;
                  const slug = d?.slug || row.dramaId;
                  const label = progressLabel(row, t);
                  return (
                    <Link key={row.id} href={`/drama/${slug}`} className="group min-w-0">
                      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
                        {d?.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={d.coverUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-ink">
                        {titleOf(d)}
                      </p>
                      {label ? (
                        <p className="mt-0.5 text-[11px] text-ink-subtle">{label}</p>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        {(!loading || refreshing) && tab === "favorites" && (
          <>
            {favoriteRows.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-body-sm text-ink-muted">{t("account.emptyFav")}</p>
                <Link
                  href="/theater"
                  className="mt-3 inline-flex rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink"
                >
                  {t("account.goTheater")}
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-x-2 gap-y-4">
                {favoriteRows.map((row) => {
                  const d = row.drama || row;
                  const slug = d.slug || d.id;
                  const dramaId = String(row.dramaId ?? d.id);
                  const isSelected = selected.has(dramaId);
                  return (
                    <div key={row.id || slug} className="relative min-w-0">
                      {editing && (
                        <button
                          type="button"
                          onClick={() => toggleSelect(dramaId)}
                          className={cn(
                            "absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border",
                            isSelected
                              ? "border-brand bg-brand text-white"
                              : "border-white/70 bg-black/40 text-transparent",
                          )}
                          aria-pressed={isSelected}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <Link
                        href={editing ? "#" : `/drama/${slug}`}
                        onClick={(e) => {
                          if (editing) {
                            e.preventDefault();
                            toggleSelect(dramaId);
                          }
                        }}
                        className="block"
                      >
                        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
                          {d.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={d.coverUrl}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-ink">
                          {titleOf(d)}
                        </p>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {(!loading || refreshing) && tab === "liked" && (
          <>
            {likedRows.length === 0 ? (
              <div className="py-12 text-center">
                <Heart className="mx-auto h-8 w-8 text-ink-subtle" />
                <p className="mt-3 text-body-sm text-ink-muted">{t("account.emptyLiked")}</p>
                <Link
                  href="/theater"
                  className="mt-3 inline-flex rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink"
                >
                  {t("account.goTheater")}
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-x-2 gap-y-4">
                {likedRows.map((row) => {
                  const d = row.drama || row;
                  const slug = d.slug || d.id;
                  const dramaId = String(row.dramaId ?? d.id);
                  const isSelected = selected.has(dramaId);
                  return (
                    <div key={row.id || slug} className="relative min-w-0">
                      {editing && (
                        <button
                          type="button"
                          onClick={() => toggleSelect(dramaId)}
                          className={cn(
                            "absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border",
                            isSelected
                              ? "border-brand bg-brand text-white"
                              : "border-white/70 bg-black/40 text-transparent",
                          )}
                          aria-pressed={isSelected}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <Link
                        href={editing ? "#" : `/drama/${slug}`}
                        onClick={(e) => {
                          if (editing) {
                            e.preventDefault();
                            toggleSelect(dramaId);
                          }
                        }}
                        className="block"
                      >
                        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
                          {d.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={d.coverUrl}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-ink">
                          {titleOf(d)}
                        </p>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Settings sheet — redeem, nickname, language, creator, help, orders, messages, logout */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label={t("account.closeSettings")}
            onClick={() => setSettingsOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl border border-line bg-base pb-[calc(1rem+var(--mobile-tab-safe-bottom))] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-base/95 px-4 py-3 backdrop-blur">
              <h2 className="text-body font-semibold text-ink">{t("account.settingsTitle")}</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-surface-2"
                aria-label={t("account.closeSettings")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 p-4">
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
                    }}
                    placeholder={t("redeem.placeholder")}
                    className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2.5 text-body-sm text-ink outline-none"
                  />
                  <button
                    type="button"
                    disabled={redeemBusy || !code.trim()}
                    onClick={() => void onRedeem()}
                    className="shrink-0 rounded-full bg-surface-2 px-4 py-2.5 text-body-sm font-medium text-ink disabled:opacity-50"
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

              <div className="overflow-hidden rounded-2xl border border-line/80 bg-surface">
                <button
                  type="button"
                  onClick={() => setShowNickname((v) => !v)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2"
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
                  <div className="border-t border-line px-4 py-4">
                    <label className="text-caption uppercase text-ink-subtle">
                      {t("account.nickname")}
                    </label>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <input
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        className="min-w-[12rem] flex-1 rounded-lg bg-surface-2 px-4 py-2.5 text-body text-ink outline-none"
                      />
                      <button
                        type="button"
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
                  href="/notifications"
                  className="flex items-center gap-3 border-t border-line px-4 py-3.5 hover:bg-surface-2"
                  onClick={() => setSettingsOpen(false)}
                >
                  <Bell className="h-4 w-4 text-ink-muted" />
                  <span className="flex-1 text-body-sm text-ink">{t("account.messages")}</span>
                  <ChevronRight className="h-4 w-4 text-ink-subtle" />
                </Link>

                <Link
                  href="/creator/"
                  className="flex items-center gap-3 border-t border-line px-4 py-3.5 hover:bg-surface-2"
                  onClick={() => setSettingsOpen(false)}
                >
                  <Clapperboard className="h-4 w-4 text-ink-muted" />
                  <span className="flex-1 text-body-sm text-ink">{t("account.creatorCenter")}</span>
                  <ChevronRight className="h-4 w-4 text-ink-subtle" />
                </Link>

                {!isPwaStandalone() && (
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      openPwaInstallGuide();
                    }}
                    className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left hover:bg-surface-2"
                  >
                    <Smartphone className="h-4 w-4 text-ink-muted" />
                    <span className="flex-1 text-body-sm text-ink">{t("pwa.settingsEntry")}</span>
                    <ChevronRight className="h-4 w-4 text-ink-subtle" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowHelp((v) => !v)}
                  className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left hover:bg-surface-2"
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

                <button
                  type="button"
                  onClick={() => {
                    onLogout();
                    setSettingsOpen(false);
                  }}
                  className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left hover:bg-surface-2"
                >
                  <LogOut className="h-4 w-4 text-ink-muted" />
                  <span className="flex-1 text-body-sm text-ink">{t("account.logout")}</span>
                </button>
              </div>

              {/* Orders kept as secondary section */}
              <div className="rounded-2xl border border-line/80 bg-surface p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Ticket className="h-4 w-4 text-ink-muted" />
                  <p className="text-body-sm font-medium text-ink">{t("account.orders")}</p>
                </div>
                {orders.length === 0 ? (
                  <p className="text-caption text-ink-muted">{t("account.emptyOrders")}</p>
                ) : (
                  <div className="space-y-2">
                    {orders.slice(0, 8).map((o) => {
                      const canRequest =
                        o.paymentStatus === "PAID" &&
                        (o.orderType === "TOPUP" || o.orderType === "EPISODE_UNLOCK") &&
                        !o.refundStatus;
                      return (
                        <div
                          key={o.orderNo}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-ink">{o.orderNo}</div>
                            <div className="text-xs text-ink-muted">
                              {o.orderType} · {o.paymentStatus}
                              {o.refundStatus ? ` · ${o.refundStatus}` : ""}
                            </div>
                          </div>
                          {canRequest ? (
                            <button
                              type="button"
                              disabled={refundBusy === o.orderNo}
                              className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted disabled:opacity-50"
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
                      );
                    })}
                    <p className="text-caption text-ink-muted">{t("account.refundHint")}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
