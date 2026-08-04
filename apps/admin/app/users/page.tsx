"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminForceLogout,
  adminGetUser,
  adminListUsers,
  adminSetUserStatus,
  adminSetUserVip,
  adminWalletAdjust,
  asRows,
} from "@velvet/api-client";
import { AdminShell } from "@/components/admin-shell";
import { useI18n, statusLabel } from "@/lib/i18n";
import { useLocationSearchParams } from "@/lib/use-location-search";
import { Badge, Button, DataTable, Input, Select, StatCard, fmtDate, fmtNum, type Column } from "@velvet/ui";

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
  locale?: string;
  status?: string;
  createdAt?: string;
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
};

function formatRegion(
  region: Row["region"],
  lang: "zh" | "en",
): { ip: string; place: string } | null {
  if (!region?.ipAddress && !region?.country && !region?.city) return null;
  const code = (region?.country || "").toUpperCase();
  const country =
    code === "LOCAL"
      ? lang === "zh"
        ? "本地"
        : "Local"
      : lang === "zh"
        ? COUNTRY_ZH[code] || code || ""
        : code || "";
  const city = region?.city || "";
  const place = [country, city].filter(Boolean).join(lang === "zh" ? " · " : ", ") || "—";
  return { ip: region?.ipAddress || "—", place };
}

function ModalShell({
  title,
  subtitle,
  onClose,
  t,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  t: ReturnType<typeof useI18n>["t"];
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        aria-label={t("close")}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-2xl border border-white/70 bg-white/95 p-5 shadow-3 backdrop-blur-md ${
          wide ? "max-w-2xl" : "max-w-lg"
        }`}
      >
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 className="text-h4 tracking-tight text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-caption text-ink-subtle">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-body-sm text-ink-muted transition hover:bg-panel hover:text-ink"
            onClick={onClose}
          >
            {t("close")}
          </button>
        </div>
        {children}
      </div>
    </div>
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
    <ModalShell title={t("userDetail")} subtitle={`ID ${userId}`} onClose={onClose} t={t}>
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
    </ModalShell>
  );
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
  const [reason, setReason] = useState("");
  const [delta, setDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const [extendDays, setExtendDays] = useState(30);
  const [vipDate, setVipDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => adminGetUser(userId) as Promise<Detail>,
  });
  const user = detailQ.data?.user;
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const actionMut = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "user", userId] });
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const act = (action: () => Promise<unknown>) => actionMut.mutate(action);

  return (
    <ModalShell title={t("edit")} subtitle={`ID ${userId}`} onClose={onClose} t={t} wide>
      {detailQ.isLoading ? <p className="text-ink-muted">{t("loading")}</p> : null}
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

          <div className="space-y-4 rounded-xl border border-line bg-white/55 p-4">
            <section className="space-y-2">
              <h3 className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                {t("status")}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-56"
                  placeholder={t("statusChangeReason")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                {(["ACTIVE", "SUSPENDED", "BANNED"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === "ACTIVE" ? "primary" : "danger"}
                    disabled={actionMut.isPending}
                    onClick={() =>
                      act(() =>
                        adminSetUserStatus(userId, s, reason || (s === "ACTIVE" ? "restore" : "")),
                      )
                    }
                  >
                    {statusLabel(t, s)}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={actionMut.isPending}
                  onClick={() => act(() => adminForceLogout(userId))}
                >
                  {t("forceLogout")}
                </Button>
              </div>
            </section>

            <section className="space-y-2 border-t border-line pt-3">
              <h3 className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                VIP
              </h3>
              <p className="text-body-sm text-ink-muted">
                {t("vipExpiry")}：
                {user.vipExpireAt ? fmtDate(user.vipExpireAt, dateLocale) : t("notActivated")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  className="w-28"
                  value={extendDays}
                  onChange={(e) => setExtendDays(Number(e.target.value))}
                />
                <Button
                  size="sm"
                  disabled={actionMut.isPending}
                  onClick={() => act(() => adminSetUserVip(userId, { extendDays }))}
                >
                  {t("extendVip")}
                </Button>
                <Input
                  type="datetime-local"
                  className="w-52"
                  value={vipDate}
                  onChange={(e) => setVipDate(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={actionMut.isPending}
                  onClick={() =>
                    act(() =>
                      adminSetUserVip(userId, {
                        vipExpireAt: vipDate ? new Date(vipDate).toISOString() : null,
                      }),
                    )
                  }
                >
                  {t("setExpire")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={actionMut.isPending}
                  onClick={() => act(() => adminSetUserVip(userId, { vipExpireAt: null }))}
                >
                  {t("clearVip")}
                </Button>
              </div>
            </section>

            <section className="space-y-2 border-t border-line pt-3">
              <h3 className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                {t("colCredits")}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  className="w-28"
                  value={delta}
                  onChange={(e) => setDelta(Number(e.target.value))}
                  placeholder={t("adjustCreditsPlaceholder")}
                />
                <Input
                  className="w-48"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder={t("adjustReasonPlaceholder")}
                />
                <Button
                  size="sm"
                  disabled={actionMut.isPending}
                  onClick={() => act(() => adminWalletAdjust(userId, delta, adjustReason))}
                >
                  {t("adjustBalance")}
                </Button>
              </div>
            </section>
          </div>

          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={onClose}>
              {t("close")}
            </Button>
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}

export default function AdminUsersPage() {
  const { t, locale } = useI18n();
  const searchParams = useLocationSearchParams();
  const statusFromUrl = searchParams.get("status") || "ALL";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(statusFromUrl);
  const [applied, setApplied] = useState({ q: "", status: statusFromUrl });
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => {
    setStatus(statusFromUrl);
    setApplied((prev) => ({ ...prev, status: statusFromUrl }));
  }, [statusFromUrl]);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["admin", "users", applied],
    queryFn: async () => {
      const res = await adminListUsers({
        q: applied.q || undefined,
        status: applied.status,
        page: 1,
        pageSize: 40,
      });
      return { rows: asRows<Row>(res), total: (res as { total?: number })?.total ?? 0 };
    },
  });

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
          <div className="min-w-[9rem] max-w-[14rem]">
            <div className="truncate text-body-sm font-medium text-ink">{r.nickname || "—"}</div>
            <div className="truncate text-caption text-ink-subtle">{r.email || r.phone || "—"}</div>
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
            <div className="min-w-[7.5rem]">
              <div className="font-mono text-caption tabular-nums text-ink">{formatted.ip}</div>
              <div className="text-caption text-ink-subtle">{formatted.place}</div>
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-full sm:w-64"
            placeholder={t("userSearchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setApplied({ q, status });
            }}
          />
          <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            {["ALL", "ACTIVE", "SUSPENDED", "BANNED"].map((s) => (
              <option key={s} value={s}>
                {statusLabel(t, s)}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => setApplied({ q, status })}>
            {t("query")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            {t("refresh")}
          </Button>
        </div>
        <p className="text-caption font-medium text-ink-subtle">
          {t("totalCount", { n: data?.total ?? 0 })}
        </p>
      </div>

      <DataTable columns={columns} rows={data?.rows || []} loading={isFetching} emptyTitle={t("empty")} />

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
    </AdminShell>
  );
}
