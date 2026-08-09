"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminCreateUser,
  adminDeleteUser,
  adminForceLogout,
  adminGetUser,
  adminListUsers,
  adminResetUserPassword,
  adminSetUserStatus,
  adminSetUserVip,
  adminWalletAdjust,
  asRows,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { ConfirmModal, GlassModal } from "@/components/glass-modal";
import { useI18n, statusLabel } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";
import { Badge, Button, cn, DataTable, Input, Select, StatCard, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { Plus } from "lucide-react";

function statusTone(status?: string): "success" | "warning" | "danger" | "default" {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "warning";
  if (status === "BANNED") return "danger";
  return "default";
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-1 text-body-sm">
      <dt className="text-caption font-medium text-ink-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

type Row = {
  id: string | number;
  nickname?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  locale?: string;
  status?: string;
  createdAt?: string;
  vipExpireAt?: string | null;
  wallet?: { balanceCredits?: string | number };
  region?: {
    ipAddress?: string | null;
    country?: string | null;
    city?: string | null;
    at?: string;
  } | null;
};

type DetailUser = {
  id: string | number;
  nickname?: string;
  email?: string;
  phone?: string;
  locale?: string;
  status?: string;
  createdAt?: string;
  vipExpireAt?: string | null;
  wallet?: {
    balanceCredits?: number;
    totalRechargedCredits?: number;
    totalSpentCredits?: number;
  };
};

type Detail = { user?: DetailUser };

type ModalState = { mode: "detail" | "edit"; id: string } | null;

function paginationItems(page: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const visible = new Set([1, total, page - 1, page, page + 1]);
  const pages = [...visible].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  pages.forEach((value, index) => {
    if (index > 0 && value - pages[index - 1] > 1) result.push("ellipsis");
    result.push(value);
  });
  return result;
}

const COUNTRY_ZH: Record<string, string> = {
  LOCAL: "本地",
  VN: "越南",
  CN: "中国",
  HK: "香港",
  TW: "台湾",
  MO: "澳门",
  US: "美国",
  SG: "新加坡",
  MY: "马来西亚",
  TH: "泰国",
  JP: "日本",
  KR: "韩国",
  ID: "印尼",
  PH: "菲律宾",
  AU: "澳大利亚",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  CA: "加拿大",
  IN: "印度",
  BR: "巴西",
  RU: "俄罗斯",
  AE: "阿联酋",
  SA: "沙特",
  TR: "土耳其",
  IT: "意大利",
  ES: "西班牙",
  NL: "荷兰",
  NZ: "新西兰",
};

const COUNTRY_EN: Record<string, string> = {
  LOCAL: "Local",
  VN: "Vietnam",
  CN: "China",
  HK: "Hong Kong",
  TW: "Taiwan",
  MO: "Macao",
  US: "United States",
  SG: "Singapore",
  MY: "Malaysia",
  TH: "Thailand",
  JP: "Japan",
  KR: "South Korea",
  ID: "Indonesia",
  PH: "Philippines",
  AU: "Australia",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  CA: "Canada",
  IN: "India",
  BR: "Brazil",
  RU: "Russia",
  AE: "UAE",
  SA: "Saudi Arabia",
  TR: "Turkey",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  NZ: "New Zealand",
};

function countryFlagEmoji(code: string): string {
  if (code === "LOCAL") return "🏠";
  if (!/^[A-Z]{2}$/.test(code)) return "🏳️";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...[...code].map((ch) => base + ch.charCodeAt(0) - 65),
  );
}

function formatRegion(
  region: Row["region"],
  lang: "zh" | "en",
): { flag: string; place: string; ip: string } | null {
  if (!region?.ipAddress && !region?.country && !region?.city) return null;
  const code = (region?.country || "").toUpperCase();
  const country =
    (lang === "zh" ? COUNTRY_ZH[code] : COUNTRY_EN[code]) || code || "";
  const city = region?.city || "";
  const place = [country, city].filter(Boolean).join(" · ") || "—";
  return {
    flag: code ? countryFlagEmoji(code) : "🏳️",
    place,
    ip: region?.ipAddress || "—",
  };
}

function subscriptionState(vipExpireAt?: string | null): "active" | "expired" | "none" {
  if (!vipExpireAt) return "none";
  return new Date(vipExpireAt).getTime() > Date.now() ? "active" : "expired";
}

function modalTitle(title: string, subtitle?: string) {
  return (
    <div>
      <div>{title}</div>
      {subtitle ? <p className="mt-0.5 text-caption font-normal text-ink-subtle">{subtitle}</p> : null}
    </div>
  );
}

function CreateUserModal({
  onClose,
  t,
}: {
  onClose: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [locale, setLocale] = useState("en");
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      adminCreateUser({
        email: email.trim(),
        password,
        nickname: nickname.trim() || undefined,
        username: username.trim() || undefined,
        phone: phone.trim() || undefined,
        locale,
      }),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }
    setError(null);
    createMut.mutate();
  };

  return (
    <GlassModal
      open
      onClose={() => {
        if (!createMut.isPending) onClose();
      }}
      title={modalTitle(t("createUser"), t("createUserHint"))}
      size="md"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!createMut.isPending) submit();
        }}
      >
        {error ? <p className="text-body-sm text-danger">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-caption font-medium text-ink-subtle sm:col-span-2">
            {t("fieldEmail")}
            <Input
              className="mt-1.5"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle sm:col-span-2">
            {t("newPassword")}
            <Input
              className="mt-1.5"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle">
            {t("fieldNickname")}
            <span className="ml-1 font-normal text-ink-subtle/70">({t("optional")})</span>
            <Input
              className="mt-1.5"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={64}
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle">
            {t("loginAccount")}
            <span className="ml-1 font-normal text-ink-subtle/70">({t("optional")})</span>
            <Input
              className="mt-1.5"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("usernameHint")}
              maxLength={24}
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle">
            {t("fieldPhone")}
            <span className="ml-1 font-normal text-ink-subtle/70">({t("optional")})</span>
            <Input
              className="mt-1.5"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={32}
            />
          </label>
          <label className="block text-caption font-medium text-ink-subtle">
            {t("colLocale")}
            <Select className="mt-1.5" value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="zh">{t("localeZh")}</option>
              <option value="en">{t("localeEn")}</option>
              <option value="fr">{t("localeFr")}</option>
            </Select>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={createMut.isPending}
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={createMut.isPending}>
            {createMut.isPending ? t("loading") : t("createUser")}
          </Button>
        </div>
      </form>
    </GlassModal>
  );
}

function UserDetailModal({
  userId,
  onClose,
  onEdit,
  t,
  locale,
}: {
  userId: string;
  onClose: () => void;
  onEdit: () => void;
  t: ReturnType<typeof useI18n>["t"];
  locale: string;
}) {
  const detailQ = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => adminGetUser(userId) as Promise<Detail>,
  });
  const user = detailQ.data?.user;
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  return (
    <GlassModal open onClose={onClose} title={modalTitle(t("userDetail"), `ID ${userId}`)} size="md">
      {detailQ.isLoading ? <p className="text-ink-muted">{t("loading")}</p> : null}
      {detailQ.error ? (
        <p className="text-body-sm text-danger">{(detailQ.error as Error).message}</p>
      ) : null}

      {user ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label={t("colCredits")} value={fmtNum(user.wallet?.balanceCredits)} />
            <StatCard label={t("totalRecharged")} value={fmtNum(user.wallet?.totalRechargedCredits)} />
            <StatCard label={t("totalSpent")} value={fmtNum(user.wallet?.totalSpentCredits)} />
          </div>
          <dl className="space-y-2.5 rounded-xl border border-line bg-white/55 p-4">
            <FieldRow label={t("colUser")}>{user.nickname || "—"}</FieldRow>
            <FieldRow label="Email">{user.email || "—"}</FieldRow>
            <FieldRow label="Phone">{user.phone || "—"}</FieldRow>
            <FieldRow label={t("colLocale")}>
              <span className="rounded-md bg-panel px-1.5 py-0.5 text-caption font-medium uppercase tracking-wide text-ink-muted">
                {user.locale || "—"}
              </span>
            </FieldRow>
            <FieldRow label={t("status")}>
              <Badge tone={statusTone(user.status)}>{statusLabel(t, user.status)}</Badge>
            </FieldRow>
            <FieldRow label="VIP">
              {user.vipExpireAt ? fmtDate(user.vipExpireAt, dateLocale) : t("notActivated")}
            </FieldRow>
            <FieldRow label={t("colCreated")}>{fmtDate(user.createdAt, dateLocale)}</FieldRow>
          </dl>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}>
              {t("close")}
            </Button>
            <Button size="sm" onClick={onEdit}>
              {t("edit")}
            </Button>
          </div>
        </div>
      ) : null}
    </GlassModal>
  );
}

type EditTab = "status" | "vip" | "wallet";
type UserStatus = "ACTIVE" | "SUSPENDED" | "BANNED";
type VipAction = "extend" | "setExpire" | "clear";

const USER_STATUSES: UserStatus[] = ["ACTIVE", "SUSPENDED", "BANNED"];

function asUserStatus(value?: string): UserStatus {
  if (value === "SUSPENDED" || value === "BANNED") return value;
  return "ACTIVE";
}

function UserEditModal({
  userId,
  onClose,
  t,
  locale,
}: {
  userId: string;
  onClose: () => void;
  t: ReturnType<typeof useI18n>["t"];
  locale: string;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<EditTab>("status");
  const [targetStatus, setTargetStatus] = useState<UserStatus | null>(null);
  const [reason, setReason] = useState("");
  const [vipAction, setVipAction] = useState<VipAction>("extend");
  const [delta, setDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const [extendDays, setExtendDays] = useState(30);
  const [vipDate, setVipDate] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => adminGetUser(userId) as Promise<Detail>,
  });
  const user = detailQ.data?.user;
  const currentStatus = asUserStatus(user?.status);
  const selectedStatus = targetStatus ?? currentStatus;
  const statusDirty = selectedStatus !== currentStatus;
  const currentCredits = Number(user?.wallet?.balanceCredits ?? 0);
  const walletDeltaValid = Number.isFinite(delta) && delta !== 0;
  const balanceAfter = currentCredits + (Number.isFinite(delta) ? delta : 0);
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  useEffect(() => {
    if (!user) return;
    setTargetStatus(asUserStatus(user.status));
  }, [user]);

  const actionMut = useMutation({
    mutationFn: async ({ run, ok }: { run: () => Promise<unknown>; ok: string }) => {
      await run();
      return ok;
    },
    onSuccess: async (ok) => {
      setError(null);
      setToast(ok);
      setReason("");
      setAdjustReason("");
      setDelta(0);
      setNewPassword("");
      await qc.invalidateQueries({ queryKey: ["admin", "user", userId] });
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => {
      setToast(null);
      setError(e.message);
    },
  });
  const act = (run: () => Promise<unknown>, ok: string) => actionMut.mutate({ run, ok });

  const tabs: Array<{ key: EditTab; label: string }> = [
    { key: "status", label: t("editTabStatus") },
    { key: "vip", label: t("editTabVip") },
    { key: "wallet", label: t("editTabWallet") },
  ];

  const vipActions: Array<{ key: VipAction; label: string }> = [
    { key: "extend", label: t("vipActionExtend") },
    { key: "setExpire", label: t("vipActionSetExpire") },
    { key: "clear", label: t("vipActionClear") },
  ];

  const vipApplyDisabled =
    actionMut.isPending ||
    (vipAction === "extend" && (!Number.isFinite(extendDays) || extendDays <= 0)) ||
    (vipAction === "setExpire" && !vipDate);

  const applyVip = () => {
    if (vipAction === "extend") {
      act(() => adminSetUserVip(userId, { extendDays }), t("userVipUpdated"));
      return;
    }
    if (vipAction === "setExpire") {
      act(
        () =>
          adminSetUserVip(userId, {
            vipExpireAt: vipDate ? new Date(vipDate).toISOString() : null,
          }),
        t("userVipUpdated"),
      );
      return;
    }
    act(() => adminSetUserVip(userId, { vipExpireAt: null }), t("userVipUpdated"));
  };

  return (
    <GlassModal open onClose={onClose} title={modalTitle(t("edit"), `ID ${userId}`)} size="lg">
      {detailQ.isLoading ? <p className="text-ink-muted">{t("loading")}</p> : null}
      {toast ? (
        <div className="mb-3 rounded-xl border border-success/20 bg-success-soft px-3 py-2 text-body-sm text-success">
          {toast}
        </div>
      ) : null}
      {error || detailQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{error || (detailQ.error as Error).message}</p>
      ) : null}

      {user ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-white/55 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body font-semibold text-ink">{user.nickname || "—"}</p>
              <Badge tone={statusTone(user.status)}>{statusLabel(t, user.status)}</Badge>
            </div>
            <p className="mt-1 text-caption text-ink-muted">
              {user.email || user.phone || "—"}
            </p>
            <p className="mt-2 text-body-sm text-ink-muted">
              <span className="tabular-nums text-ink">{fmtNum(user.wallet?.balanceCredits)}</span>{" "}
              {t("colCredits")}
              <span className="mx-2 text-line-strong">·</span>
              VIP {user.vipExpireAt ? fmtDate(user.vipExpireAt, dateLocale) : t("notActivated")}
            </p>
          </div>

          <div
            role="tablist"
            aria-label={t("edit")}
            className="inline-flex w-full rounded-2xl border border-line bg-white/80 p-1"
          >
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={cn(
                  "flex flex-1 items-center justify-center rounded-xl px-3 py-2 text-body-sm font-semibold transition",
                  tab === item.key
                    ? "bg-brand text-white shadow-brand"
                    : "text-ink-muted hover:bg-panel hover:text-ink",
                )}
                onClick={() => {
                  setTab(item.key);
                  setToast(null);
                  setError(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-white/55 p-4">
            {tab === "status" ? (
              <section className="space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-body-sm">
                    <span className="text-caption font-medium text-ink-subtle">{t("statusCurrent")}</span>
                    <Badge tone={statusTone(currentStatus)}>{statusLabel(t, currentStatus)}</Badge>
                  </div>
                  <p className="text-caption font-medium text-ink-subtle">{t("statusTarget")}</p>
                  <div
                    role="radiogroup"
                    aria-label={t("statusTarget")}
                    className="inline-flex w-full max-w-md rounded-xl border border-line bg-panel/60 p-1"
                  >
                    {USER_STATUSES.map((s) => {
                      const selected = selectedStatus === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={actionMut.isPending}
                          onClick={() => setTargetStatus(s)}
                          className={cn(
                            "flex flex-1 items-center justify-center rounded-lg px-2.5 py-2 text-body-sm font-medium transition",
                            selected
                              ? s === "BANNED"
                                ? "bg-danger text-white shadow-sm"
                                : s === "SUSPENDED"
                                  ? "bg-warning text-white shadow-sm"
                                  : "bg-white text-ink shadow-sm ring-1 ring-line"
                              : "text-ink-muted hover:bg-white/70 hover:text-ink",
                          )}
                        >
                          {statusLabel(t, s)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Input
                    className="w-full"
                    placeholder={t("statusChangeReasonOptional")}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={actionMut.isPending || !statusDirty}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={actionMut.isPending || !statusDirty}
                      variant={selectedStatus === "BANNED" ? "danger" : "primary"}
                      onClick={() =>
                        act(
                          () =>
                            adminSetUserStatus(
                              userId,
                              selectedStatus,
                              reason.trim() || (selectedStatus === "ACTIVE" ? "restore" : "status change"),
                            ),
                          t("userStatusUpdated"),
                        )
                      }
                    >
                      {t("applyStatusChange")}
                    </Button>
                    {!statusDirty ? (
                      <span className="text-caption text-ink-subtle">{t("statusAlreadyCurrent")}</span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2 border-t border-line pt-4">
                  <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                    {t("resetPasswordSection")}
                  </p>
                  <p className="text-body-sm text-ink-muted">{t("resetPasswordHint")}</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-[12rem] flex-1 space-y-1.5 sm:max-w-xs">
                      <span className="text-caption font-medium text-ink-subtle">{t("newPassword")}</span>
                      <Input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={actionMut.isPending}
                        placeholder={t("newPassword")}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actionMut.isPending || !newPassword}
                      onClick={() => {
                        if (newPassword.length < 6) {
                          setToast(null);
                          setError(t("passwordTooShort"));
                          return;
                        }
                        act(
                          () => adminResetUserPassword(userId, newPassword),
                          t("userPasswordResetOk"),
                        );
                      }}
                    >
                      {t("applyResetPassword")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 border-t border-line pt-4">
                  <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                    {t("forceLogoutSection")}
                  </p>
                  <p className="text-body-sm text-ink-muted">{t("forceLogoutHint")}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={actionMut.isPending}
                    onClick={() => act(() => adminForceLogout(userId), t("userForceLogoutOk"))}
                  >
                    {t("forceLogout")}
                  </Button>
                </div>
              </section>
            ) : null}

            {tab === "vip" ? (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-body-sm">
                  <span className="text-caption font-medium text-ink-subtle">{t("vipExpiry")}</span>
                  <span className="font-medium text-ink">
                    {user.vipExpireAt ? fmtDate(user.vipExpireAt, dateLocale) : t("notActivated")}
                  </span>
                </div>

                <div className="space-y-2">
                  <p className="text-caption font-medium text-ink-subtle">{t("vipAction")}</p>
                  <div
                    role="radiogroup"
                    aria-label={t("vipAction")}
                    className="inline-flex w-full max-w-md rounded-xl border border-line bg-panel/60 p-1"
                  >
                    {vipActions.map((item) => {
                      const selected = vipAction === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={actionMut.isPending}
                          onClick={() => setVipAction(item.key)}
                          className={cn(
                            "flex flex-1 items-center justify-center rounded-lg px-2.5 py-2 text-body-sm font-medium transition",
                            selected
                              ? item.key === "clear"
                                ? "bg-danger text-white shadow-sm"
                                : "bg-white text-ink shadow-sm ring-1 ring-line"
                              : "text-ink-muted hover:bg-white/70 hover:text-ink",
                          )}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {vipAction === "extend" ? (
                  <label className="block space-y-1.5">
                    <span className="text-caption font-medium text-ink-subtle">{t("vipExtendDaysLabel")}</span>
                    <Input
                      type="number"
                      min={1}
                      className="w-36"
                      value={extendDays}
                      onChange={(e) => setExtendDays(Number(e.target.value))}
                      disabled={actionMut.isPending}
                    />
                  </label>
                ) : null}

                {vipAction === "setExpire" ? (
                  <label className="block space-y-1.5">
                    <span className="text-caption font-medium text-ink-subtle">{t("vipSetExpireLabel")}</span>
                    <Input
                      type="datetime-local"
                      className="w-full max-w-xs"
                      value={vipDate}
                      onChange={(e) => setVipDate(e.target.value)}
                      disabled={actionMut.isPending}
                    />
                  </label>
                ) : null}

                {vipAction === "clear" ? (
                  <p className="text-body-sm text-ink-muted">{t("vipClearHint")}</p>
                ) : null}

                <Button
                  size="sm"
                  variant={vipAction === "clear" ? "danger" : "primary"}
                  disabled={vipApplyDisabled}
                  onClick={applyVip}
                >
                  {t("applyVipChange")}
                </Button>
              </section>
            ) : null}

            {tab === "wallet" ? (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-body-sm">
                  <span className="text-caption font-medium text-ink-subtle">{t("creditBalance")}</span>
                  <span className="tabular-nums font-medium text-ink">{fmtNum(currentCredits)}</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-caption font-medium text-ink-subtle">{t("walletAdjustDelta")}</span>
                    <Input
                      type="number"
                      className="w-full"
                      value={delta}
                      onChange={(e) => setDelta(Number(e.target.value))}
                      placeholder={t("adjustCreditsPlaceholder")}
                      disabled={actionMut.isPending}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-caption font-medium text-ink-subtle">{t("adjustReasonPlaceholder")}</span>
                    <Input
                      className="w-full"
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder={t("adjustReasonPlaceholder")}
                      disabled={actionMut.isPending}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-body-sm">
                  <span className="text-caption font-medium text-ink-subtle">{t("walletAfterBalance")}</span>
                  <span
                    className={cn(
                      "tabular-nums font-medium",
                      walletDeltaValid ? (balanceAfter < 0 ? "text-danger" : "text-ink") : "text-ink-subtle",
                    )}
                  >
                    {walletDeltaValid ? fmtNum(balanceAfter) : "—"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={actionMut.isPending || !walletDeltaValid}
                    onClick={() =>
                      act(
                        () => adminWalletAdjust(userId, delta, adjustReason),
                        t("userWalletAdjusted"),
                      )
                    }
                  >
                    {t("applyWalletAdjust")}
                  </Button>
                  {!walletDeltaValid ? (
                    <span className="text-caption text-ink-subtle">{t("walletDeltaRequired")}</span>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={onClose}>
              {t("close")}
            </Button>
          </div>
        </div>
      ) : null}
    </GlassModal>
  );
}

export default function AdminUsersPage() {
  const { t, locale } = useI18n();
  const searchParams = useLocationSearchParams();
  const statusFromUrl = searchParams.get("status") || "ALL";
  const initialPage = Math.max(1, Number(searchParams.get("page")) || 1);
  const initialPageSize = [10, 20, 50].includes(Number(searchParams.get("pageSize")))
    ? Number(searchParams.get("pageSize"))
    : 20;
  const initialLocale = searchParams.get("locale") || "ALL";
  const initialQuery = searchParams.get("q") || "";
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState(statusFromUrl);
  const [localeFilter, setLocaleFilter] = useState(initialLocale);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [jumpPage, setJumpPage] = useState("");
  const [applied, setApplied] = useState({
    q: initialQuery,
    status: statusFromUrl,
    locale: initialLocale,
    page: initialPage,
    pageSize: initialPageSize,
  });
  const [modal, setModal] = useState<ModalState>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const qc = useQueryClient();

  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteUser(id),
    onSuccess: async () => {
      setDeleteError(null);
      setDeleteTarget(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => {
      setDeleteError(e.message);
    },
  });

  useEffect(() => {
    const nextStatus = searchParams.get("status") || "ALL";
    const nextLocale = searchParams.get("locale") || "ALL";
    const nextQuery = searchParams.get("q") || "";
    const nextPage = Math.max(1, Number(searchParams.get("page")) || 1);
    const rawPageSize = Number(searchParams.get("pageSize"));
    const nextPageSize = [10, 20, 50].includes(rawPageSize) ? rawPageSize : 20;
    setQ(nextQuery);
    setStatus(nextStatus);
    setLocaleFilter(nextLocale);
    setPage(nextPage);
    setPageSize(nextPageSize);
    setApplied((prev) => {
      const next = { q: nextQuery, status: nextStatus, locale: nextLocale, page: nextPage, pageSize: nextPageSize };
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
  }, [searchParams]);

  // Search box: debounce apply; status/locale apply immediately on change.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed === applied.q) return;
    const timer = window.setTimeout(() => {
      setPage(1);
      setApplied((prev) => ({ ...prev, q: trimmed, page: 1 }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [q, applied.q]);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["admin", "users", applied],
    queryFn: async () => {
      const res = await adminListUsers({
        q: applied.q || undefined,
        status: applied.status,
        locale: applied.locale === "ALL" ? undefined : applied.locale,
        page: applied.page,
        pageSize: applied.pageSize,
      });
      return { rows: asRows<Row>(res), total: (res as { total?: number })?.total ?? 0 };
    },
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const goToPage = useCallback((nextPage: number) => {
    const next = Math.min(totalPages, Math.max(1, Math.floor(nextPage)));
    setPage(next);
    setApplied((prev) => ({ ...prev, page: next }));
  }, [totalPages]);
  const applyFiltersNow = () => {
    const trimmed = q.trim();
    setPage(1);
    setApplied({ q: trimmed, status, locale: localeFilter, page: 1, pageSize });
  };
  const setStatusFilter = (next: string) => {
    setStatus(next);
    setPage(1);
    setApplied((prev) => ({ ...prev, status: next, page: 1 }));
  };
  const setLocaleFilterImmediate = (next: string) => {
    setLocaleFilter(next);
    setPage(1);
    setApplied((prev) => ({ ...prev, locale: next, page: 1 }));
  };

  useEffect(() => {
    if (isFetching || !data || page <= totalPages) return;
    goToPage(totalPages);
  }, [data, goToPage, isFetching, page, totalPages]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (key: string, value: string, defaultValue = "") => {
      if (!value || value === defaultValue) params.delete(key);
      else params.set(key, value);
    };
    setOrDelete("q", applied.q);
    setOrDelete("status", applied.status, "ALL");
    setOrDelete("locale", applied.locale, "ALL");
    setOrDelete("page", String(applied.page), "1");
    setOrDelete("pageSize", String(applied.pageSize), "20");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [applied]);

  const columns: Column<Row>[] = useMemo(
    () => [
      {
        key: "id",
        header: t("colId"),
        cell: (r) => (
          <span className="font-mono text-caption tabular-nums text-ink-subtle">{String(r.id)}</span>
        ),
      },
      {
        key: "user",
        header: t("colUser"),
        cell: (r) => (
          <div className="flex min-w-[12rem] max-w-[16rem] items-center gap-2.5">
            {r.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-line" />
            ) : (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-caption font-semibold text-brand">
                {(r.nickname || r.email || "?").charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-body-sm font-medium text-ink">
                {r.nickname || "—"}
              </div>
              <div className="truncate text-caption text-ink-subtle">{r.email || r.phone || `ID ${r.id}`}</div>
            </div>
          </div>
        ),
      },
      {
        key: "locale",
        header: t("colLocale"),
        cell: (r) => (
          <span className="inline-flex rounded-md bg-panel px-1.5 py-0.5 text-caption font-medium uppercase tracking-wide text-ink-muted">
            {r.locale || "—"}
          </span>
        ),
      },
      {
        key: "region",
        header: t("colRegion"),
        cell: (r) => {
          const formatted = formatRegion(r.region, locale);
          if (!formatted) return <span className="text-caption text-ink-subtle">—</span>;
          return (
            <div
              className="flex max-w-[16rem] items-center gap-1.5"
              title={formatted.ip !== "—" ? `IP ${formatted.ip}` : undefined}
            >
              <span className="shrink-0 text-[15px] leading-none" aria-hidden>
                {formatted.flag}
              </span>
              <span className="truncate text-body-sm text-ink">{formatted.place}</span>
            </div>
          );
        },
      },
      {
        key: "status",
        header: t("status"),
        cell: (r) => <Badge tone={statusTone(r.status)}>{statusLabel(t, r.status)}</Badge>,
      },
      {
        key: "subscription",
        header: t("colSubscription"),
        cell: (r) => {
          const state = subscriptionState(r.vipExpireAt);
          const dateLocale = locale === "en" ? "en-US" : "zh-CN";
          if (state === "none") {
            return <span className="text-caption text-ink-subtle">{t("notActivated")}</span>;
          }
          const date = fmtDate(r.vipExpireAt, dateLocale);
          if (state === "active") {
            return (
              <div className="min-w-[8.5rem]">
                <Badge tone="warning">VIP</Badge>
                <div className="mt-1 whitespace-nowrap text-caption text-ink-muted">
                  {t("vipUntilDate", { date })}
                </div>
              </div>
            );
          }
          return (
            <div className="min-w-[8.5rem]">
              <Badge tone="default">{t("vipExpired")}</Badge>
              <div className="mt-1 whitespace-nowrap text-caption text-ink-subtle">
                {t("vipExpiredAt", { date })}
              </div>
            </div>
          );
        },
      },
      {
        key: "credits",
        header: t("colCredits"),
        cell: (r) => (
          <span className="text-body-sm font-medium tabular-nums text-ink">
            {fmtNum(r.wallet?.balanceCredits)}
          </span>
        ),
        className: "text-right",
      },
      {
        key: "created",
        header: t("colCreated"),
        cell: (r) => (
          <span className="whitespace-nowrap text-caption text-ink-muted">
            {fmtDate(r.createdAt, locale === "en" ? "en-US" : "zh-CN")}
          </span>
        ),
      },
      {
        key: "actions",
        header: t("actions"),
        cell: (r) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-body-sm font-medium text-brand transition hover:bg-brand-soft"
              onClick={() => setModal({ mode: "detail", id: String(r.id) })}
            >
              {t("details")}
            </button>
            <span className="text-ink-subtle/40" aria-hidden>
              |
            </span>
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-body-sm font-medium text-brand transition hover:bg-brand-soft"
              onClick={() => setModal({ mode: "edit", id: String(r.id) })}
            >
              {t("edit")}
            </button>
            <span className="text-ink-subtle/40" aria-hidden>
              |
            </span>
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-body-sm font-medium text-danger transition hover:bg-danger/10"
              onClick={() => {
                setDeleteError(null);
                setDeleteTarget({
                  id: String(r.id),
                  label: r.nickname || r.email || r.phone || String(r.id),
                });
              }}
            >
              {t("delete")}
            </button>
          </div>
        ),
      },
    ],
    [t, locale],
  );

  const title = statusFromUrl === "BANNED" ? t("usersBanned") : t("users");

  return (
    <AdminShell title={title}>
      {error ? <p className="mb-3 text-body-sm text-danger">{(error as Error).message}</p> : null}

      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          className="cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97]"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          {t("createUser")}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/45 p-3">
        <Input
          className="w-full sm:w-64"
          placeholder={t("userSearchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyFiltersNow();
          }}
        />
        <Select className="w-36" value={status} onChange={(e) => setStatusFilter(e.target.value)}>
          {["ALL", "ACTIVE", "SUSPENDED", "BANNED"].map((s) => (
            <option key={s} value={s}>
              {statusLabel(t, s)}
            </option>
          ))}
        </Select>
        <Select className="w-32" value={localeFilter} onChange={(e) => setLocaleFilterImmediate(e.target.value)}>
          <option value="ALL">{t("localeAll")}</option>
          <option value="zh">{t("localeZh")}</option>
          <option value="en">{t("localeEn")}</option>
          <option value="fr">{t("localeFr")}</option>
        </Select>
        <Button size="sm" onClick={applyFiltersNow}>
          {t("query")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {t("refresh")}
        </Button>
      </div>

      <DataTable className="users-table" columns={columns} rows={data?.rows || []} loading={isFetching} emptyTitle={t("empty")} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/45 px-3 py-2 text-caption text-ink-muted">
        <div className="flex items-center gap-3 font-medium text-ink-subtle">
          <span>{t("totalCount", { n: data?.total ?? 0 })}</span>
          <Select
            className="h-8 w-24 text-caption"
            value={String(pageSize)}
            onChange={(e) => {
              const next = Number(e.target.value);
              setPageSize(next);
              setPage(1);
              setApplied((prev) => ({ ...prev, page: 1, pageSize: next }));
            }}
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n} / {t("page")}
              </option>
            ))}
          </Select>
          {(data?.total ?? 0) > 0 ? (
            <span className="font-normal text-ink-muted">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data!.total)} / {data!.total}
            </span>
          ) : null}
        </div>
        {(data?.total ?? 0) > 0 ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" disabled={page <= 1 || isFetching} onClick={() => {
              goToPage(page - 1);
            }}>{t("previousPage")}</Button>
            <div className="hidden items-center gap-1 sm:flex">
              {paginationItems(page, totalPages).map((item, index) => item === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="grid h-9 w-7 place-items-center text-ink-subtle">…</span>
              ) : (
                <button
                  key={item}
                  type="button"
                  aria-current={item === page ? "page" : undefined}
                  disabled={isFetching}
                  onClick={() => goToPage(item)}
                  className={[
                    "grid h-9 min-w-9 place-items-center rounded-xl px-2 font-medium transition",
                    item === page
                      ? "bg-brand text-white shadow-brand"
                      : "border border-white/70 bg-white/65 text-ink-muted hover:-translate-y-0.5 hover:bg-white hover:text-ink hover:shadow-sm",
                  ].join(" ")}
                >
                  {item}
                </button>
              ))}
            </div>
            <Button size="sm" variant="secondary" disabled={page >= totalPages || isFetching} onClick={() => {
              goToPage(page + 1);
            }}>{t("nextPage")}</Button>
            {totalPages > 1 ? (
              <div className="ml-2 hidden items-center gap-1 lg:flex">
                <Input
                  type="number"
                  min={1}
                  max={totalPages}
                  className="h-9 w-16 px-2 text-center text-caption"
                  value={jumpPage}
                  placeholder={String(page)}
                  onChange={(event) => setJumpPage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && jumpPage) {
                      goToPage(Number(jumpPage));
                      setJumpPage("");
                    }
                  }}
                />
                <Button size="sm" variant="ghost" disabled={!jumpPage || isFetching} onClick={() => {
                  goToPage(Number(jumpPage));
                  setJumpPage("");
                }}>{t("goToPage")}</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {createOpen ? <CreateUserModal onClose={() => setCreateOpen(false)} t={t} /> : null}

      {modal?.mode === "detail" ? (
        <UserDetailModal
          userId={modal.id}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ mode: "edit", id: modal.id })}
          t={t}
          locale={locale}
        />
      ) : null}
      {modal?.mode === "edit" ? (
        <UserEditModal userId={modal.id} onClose={() => setModal(null)} t={t} locale={locale} />
      ) : null}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => {
          if (deleteMut.isPending) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMut.mutate(deleteTarget.id);
        }}
        title={
          deleteTarget
            ? `${t("delete")} · ${deleteTarget.label} (ID ${deleteTarget.id})`
            : t("delete")
        }
        message={deleteError || t("confirmDeleteUser")}
        confirmLabel={t("delete")}
        confirmVariant="danger"
        busy={deleteMut.isPending}
      />
    </AdminShell>
  );
}
