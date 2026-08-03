"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-context";
import { useLocale } from "@/lib/i18n";
import {
  getFavorites,
  getFavoriteGroups,
  getWatchHistory,
  clearWatchHistory,
  getWalletTransactions,
  getMyOrders,
  requestRefund,
  updateMe,
  removeFavorite,
  updateFavorite,
  uploadAvatar,
  redeemCode,
} from "@/lib/api";
import { mediaUrl } from "@/lib/utils";

type Tab = "favorites" | "history" | "transactions" | "orders";

export default function AccountPage() {
  const { user, balance, ready, openLogin, openRecharge, openVip, logout, applySession } = useAuth();
  const { t, locale } = useLocale();
  const zh = locale === "zh";

  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("favorites");
  const [favorites, setFavorites] = useState<any[]>([]);
  const [favGroups, setFavGroups] = useState<string[]>([]);
  const [favGroup, setFavGroup] = useState<string>("");
  const [history, setHistory] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState("");
  const [editNote, setEditNote] = useState("");
  const [refundBusy, setRefundBusy] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user?.nickname) setNickname(user.nickname);
    else if (user?.email) setNickname(user.email.split("@")[0]);
  }, [user]);

  const loadTab = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (tab === "favorites") {
        const [r, g] = await Promise.all([
          getFavorites(1, favGroup || undefined),
          getFavoriteGroups(),
        ]);
        setFavorites(r?.rows || []);
        setFavGroups(g || []);
      } else if (tab === "history") {
        const r = await getWatchHistory(1);
        setHistory(r?.rows || []);
      } else if (tab === "orders") {
        const r = await getMyOrders(1);
        setOrders(r?.rows || []);
      } else {
        const r = await getWalletTransactions(1);
        setTxs(r?.rows || []);
      }
    } catch {
      if (tab === "favorites") setFavorites([]);
      else if (tab === "history") setHistory([]);
      else if (tab === "orders") setOrders([]);
      else setTxs([]);
    } finally {
      setLoading(false);
    }
  }, [user, tab, favGroup]);

  useEffect(() => {
    loadTab();
  }, [loadTab]);

  const onSave = async () => {
    if (!nickname.trim()) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateMe({ nickname: nickname.trim() });
      await applySession();
      setSaved(true);
    } catch {
      /* ignore */
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

  if (!ready) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-16 text-ink-muted">…</div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-[480px] px-4 py-20 text-center">
        <h1 className="text-h2 font-semibold text-ink">{t("account.title")}</h1>
        <p className="mt-2 text-body text-ink-muted">{t("account.loginHint")}</p>
        <button
          onClick={() => openLogin()}
          className="mt-6 rounded-full bg-brand px-6 py-3 text-body-sm font-medium text-white hover:opacity-90"
        >
          {t("nav.login")}
        </button>
      </div>
    );
  }

  const titleOf = (d: any) => (zh ? d?.titleZh || d?.titleVi : d?.titleVi || d?.titleZh) || "—";
  const avatar = mediaUrl((user as any).avatarUrl);

  return (
    <div className="pb-16 md:pb-24">
      <div
        className="border-b border-line"
        style={{
          background:
            "radial-gradient(900px 280px at 15% -40%, oklch(0.68 0.19 18 / 0.18), transparent 55%), var(--color-base)",
        }}
      >
        <div className="mx-auto max-w-[800px] px-4 py-10 md:px-6 md:py-14">
          <div className="flex flex-wrap items-end gap-6">
            <label className="relative grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-surface-2 ring-2 ring-line">
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
              <p className="text-overline uppercase text-brand">{t("account.title")}</p>
              <h1 className="mt-1 text-h2 font-bold text-ink">{nickname || t("account.title")}</h1>
              <p className="mt-1 text-body-sm text-ink-muted">
                {avatarBusy
                  ? zh
                    ? "上传中…"
                    : "Đang tải…"
                  : user.email || user.phone || t("account.subtitle")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <p className="text-caption uppercase text-ink-subtle">{t("account.balance")}</p>
              <p className="text-h3 font-bold tabular-nums text-ink">
                {balance != null ? balance.toLocaleString("vi-VN") : "—"}
                <span className="ml-1 text-body-sm font-medium text-ink-muted">
                  {t("card.credits")}
                </span>
              </p>
              <div className="flex gap-2">
                <button
                  onClick={openRecharge}
                  className="rounded-full bg-brand px-4 py-2 text-body-sm font-medium text-white hover:opacity-90"
                >
                  {t("account.recharge")}
                </button>
                <button
                  onClick={() => logout()}
                  className="rounded-full bg-surface-2 px-4 py-2 text-body-sm text-ink-muted hover:text-ink"
                >
                  {t("account.logout")}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div
              className="rounded-2xl border border-line/80 p-4"
              style={{
                background:
                  "radial-gradient(280px 120px at 0% 0%, oklch(0.82 0.11 85 / 0.18), transparent 60%), var(--color-surface)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-overline uppercase tracking-widest text-gold">{t("vip.member")}</p>
                  <p className="mt-1 text-body font-medium text-ink">
                    {user.isVip && user.vipExpireAt
                      ? t("vip.activeUntil", {
                          date: new Date(user.vipExpireAt).toLocaleDateString(locale),
                        })
                      : t("vip.inactive")}
                  </p>
                  <p className="mt-1 text-caption text-ink-muted">{t("vip.inactiveHint")}</p>
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
                  onClick={async () => {
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
                  }}
                  className="shrink-0 rounded-full bg-surface-2 px-4 py-2.5 text-body-sm font-medium text-ink disabled:opacity-50 hover:bg-surface-3"
                >
                  {t("redeem.submit")}
                </button>
              </div>
              {redeemMsg ? (
                <p
                  className={`mt-2 text-caption ${
                    redeemMsg === t("redeem.success") ? "text-success" : "text-danger"
                  }`}
                >
                  {redeemMsg}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <label className="text-caption uppercase text-ink-subtle">{t("account.nickname")}</label>
              <input
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  setSaved(false);
                }}
                className="mt-1.5 w-full rounded-lg bg-surface-2 px-4 py-2.5 text-body text-ink outline-none ring-0 focus:bg-surface-3"
              />
            </div>
            <button
              onClick={onSave}
              disabled={saving || !nickname.trim()}
              className="rounded-full bg-surface-2 px-4 py-2.5 text-body-sm font-medium text-ink disabled:opacity-50"
            >
              {saved ? t("account.saved") : t("account.save")}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[800px] px-4 pt-8 md:px-6">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {(
          [
            ["favorites", t("account.favorites")],
            ["history", t("account.history")],
            ["transactions", t("account.transactions")],
            ["orders", zh ? "订单/退款" : "Đơn / Hoàn"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`shrink-0 rounded-full px-4 py-2 text-body-sm transition-colors ${
              tab === k ? "bg-brand text-white" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 min-h-[160px]">
        {loading && <p className="text-body-sm text-ink-muted">…</p>}

        {!loading && tab === "favorites" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFavGroup("")}
                className={`rounded-full px-3 py-1 text-caption ${
                  !favGroup ? "bg-brand text-white" : "bg-surface-2 text-ink-muted"
                }`}
              >
                {zh ? "全部" : "Tất cả"}
              </button>
              {favGroups.map((g) => (
                <button
                  key={g}
                  onClick={() => setFavGroup(g)}
                  className={`rounded-full px-3 py-1 text-caption ${
                    favGroup === g ? "bg-brand text-white" : "bg-surface-2 text-ink-muted"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            {favorites.length === 0 && (
              <p className="text-body-sm text-ink-muted">{t("account.emptyFav")}</p>
            )}
            {favorites.map((row) => {
              const d = row.drama || row;
              const slug = d.slug || d.id;
              const dramaId = String(row.dramaId ?? d.id);
              const editing = editId === dramaId;
              return (
                <div
                  key={row.id || slug}
                  className="rounded-lg bg-surface-2/60 px-3 py-2.5"
                >
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
                      {zh ? "备注" : "Ghi chú"}
                    </button>
                    <button
                      onClick={async () => {
                        await removeFavorite(d.id);
                        loadTab();
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
                        placeholder={zh ? "分组" : "Nhóm"}
                        className="w-28 rounded-md border border-line bg-surface-3 px-2 py-1.5 text-xs text-ink"
                      />
                      <input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder={zh ? "备注" : "Ghi chú"}
                        className="min-w-[140px] flex-1 rounded-md border border-line bg-surface-3 px-2 py-1.5 text-xs text-ink"
                      />
                      <button
                        className="rounded-md bg-brand px-3 py-1.5 text-xs text-white"
                        onClick={async () => {
                          await updateFavorite(dramaId, {
                            // empty string -> null so group/note can be cleared
                            group: editGroup.trim() || null,
                            note: editNote.trim() || null,
                          });
                          setEditId(null);
                          loadTab();
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

        {!loading && tab === "history" && (
          <div className="space-y-2">
            <div className="flex justify-end">
              {history.length > 0 && (
                <button
                  onClick={async () => {
                    await clearWatchHistory();
                    loadTab();
                  }}
                  className="text-xs text-ink-muted hover:text-ink"
                >
                  {t("account.clearHistory")}
                </button>
              )}
            </div>
            {history.length === 0 && (
              <p className="text-sm text-ink-muted">{t("account.emptyHistory")}</p>
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
                      {epNo != null
                        ? zh
                          ? `${t("account.episode")} ${epNo} 集`
                          : `${t("account.episode")} ${epNo}`
                        : ""}
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

        {!loading && tab === "transactions" && (
          <div className="space-y-2">
            {txs.length === 0 && (
              <p className="text-sm text-ink-muted">{t("account.emptyTx")}</p>
            )}
            {txs.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-lg bg-surface-2/60 px-3 py-2.5"
              >
                <div>
                  <div className="text-body-sm text-ink">{tx.type || tx.note || "—"}</div>
                  <div className="text-caption text-ink-muted">
                    {tx.createdAt ? new Date(tx.createdAt).toLocaleString() : ""}
                  </div>
                </div>
                <div
                  className={`text-body-sm font-medium tabular-nums ${
                    Number(tx.amountCredits ?? tx.delta ?? 0) >= 0
                      ? "text-success"
                      : "text-danger"
                  }`}
                >
                  {Number(tx.amountCredits ?? tx.delta ?? 0) > 0 ? "+" : ""}
                  {Number(tx.amountCredits ?? tx.delta ?? 0).toLocaleString("vi-VN")}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && tab === "orders" && (
          <div className="space-y-2">
            {orders.length === 0 && (
              <p className="text-sm text-ink-muted">{zh ? "暂无订单" : "Chưa có đơn"}</p>
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
                      {o.refundStatus ? ` · refund:${o.refundStatus}` : ""}
                      {" · "}
                      {o.createdAt ? new Date(o.createdAt).toLocaleString() : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-ink">
                      {Number(o.amountCredits || 0).toLocaleString("vi-VN")} 积分
                    </span>
                    {canRequest ? (
                      <button
                        type="button"
                        disabled={refundBusy === o.orderNo}
                        className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                        onClick={async () => {
                          setRefundBusy(o.orderNo);
                          try {
                            await requestRefund(
                              o.orderNo,
                              o.orderType === "TOPUP"
                                ? zh
                                  ? "申请充值退款"
                                  : "Yêu cầu hoàn nạp"
                                : zh
                                  ? "申请解锁退款"
                                  : "Yêu cầu hoàn mở khóa",
                            );
                            await loadTab();
                          } catch {
                            /* ignore */
                          } finally {
                            setRefundBusy(null);
                          }
                        }}
                      >
                        {zh ? "申请退款" : "Yêu cầu hoàn"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <p className="text-caption text-ink-muted pt-1">
              {zh
                ? "充值退款需管理员审批；解锁单也可在此申请，或走自助退款接口。"
                : "Hoàn nạp cần admin duyệt; đơn mở khóa có thể tự hoàn hoặc gửi yêu cầu."}
            </p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
