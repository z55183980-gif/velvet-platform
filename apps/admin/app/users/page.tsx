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
import { GlassModal } from "@/components/glass-modal";
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

function modalTitle(title: string, subtitle?: string) {
  return (
    <div>
      <div>{title}</div>
      {subtitle ? <p className="mt-0.5 text-caption font-normal text-ink-subtle">{subtitle}</p> : null}
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
    <GlassModal open onClose={onClose} title={modalTitle(t("edit"), `ID ${userId}`)} size="lg">
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
  const goToPage = (nextPage: number) => {
    const next = Math.min(totalPages, Math.max(1, Math.floor(nextPage)));
    setPage(next);
    setApplied((prev) => ({ ...prev, page: next }));
  };
  const applyFilters = () => {
    setPage(1);
    setApplied({ q: q.trim(), status, locale: localeFilter, page: 1, pageSize });
  };

  useEffect(() => {
    if (isFetching || !data || page <= totalPages) return;
    goToPage(totalPages);
  }, [data, isFetching, page, totalPages]);

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
              <div className="flex items-center gap-1.5 truncate text-body-sm font-medium text-ink">
                <span className="truncate">{r.nickname || "—"}</span>
                {r.vipExpireAt && new Date(r.vipExpireAt).getTime() > Date.now() ? (
                  <span className="shrink-0 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">VIP</span>
                ) : null}
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
            <div className="max-w-[11rem] truncate" title={`${formatted.ip} · ${formatted.place}`}>
              <span className="text-caption text-ink">{formatted.place}</span>
              <span className="mx-1 text-ink-subtle/50">·</span>
              <span className="font-mono text-caption tabular-nums text-ink-muted">{formatted.ip}</span>
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

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-line bg-white/45 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-full sm:w-64"
            placeholder={t("userSearchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
          />
          <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            {["ALL", "ACTIVE", "SUSPENDED", "BANNED"].map((s) => (
              <option key={s} value={s}>
                {statusLabel(t, s)}
              </option>
            ))}
          </Select>
          <Select className="w-32" value={localeFilter} onChange={(e) => setLocaleFilter(e.target.value)}>
            <option value="ALL">{t("localeAll")}</option>
            <option value="zh">{t("localeZh")}</option>
            <option value="en">{t("localeEn")}</option>
            <option value="fr">{t("localeFr")}</option>
          </Select>
          <Button size="sm" onClick={applyFilters}>
            {t("query")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            {t("refresh")}
          </Button>
        </div>
        <div className="flex items-center gap-3 text-caption font-medium text-ink-subtle">
          <span>{t("totalCount", { n: data?.total ?? 0 })}</span>
          <Select className="h-8 w-24 text-caption" value={String(pageSize)} onChange={(e) => {
            const next = Number(e.target.value);
            setPageSize(next);
            setPage(1);
            setApplied((prev) => ({ ...prev, page: 1, pageSize: next }));
          }}>
            {[10, 20, 50].map((n) => <option key={n} value={n}>{n} / {t("page")}</option>)}
          </Select>
        </div>
      </div>

      <DataTable className="users-table" columns={columns} rows={data?.rows || []} loading={isFetching} emptyTitle={t("empty")} />

      {(data?.total ?? 0) > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/45 px-3 py-2 text-caption text-ink-muted">
          <span>{data?.total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, data.total)} / ${data.total}` : "0"}</span>
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
        </div>
      ) : null}

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
