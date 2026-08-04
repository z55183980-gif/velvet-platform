"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminForceLogout, adminGetUser, adminSetUserStatus, adminSetUserVip, adminWalletAdjust } from "@velvet/api-client";
import { Button, DataTable, Input, StatCard, fmtDate, fmtNum, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n, statusLabel, type LabelKey } from "@/lib/i18n";

type RecordRow = { id?: string | number; [key: string]: unknown };
type User = {
  id: string | number; nickname?: string; email?: string; phone?: string; locale?: string; status?: string;
  createdAt?: string; vipExpireAt?: string | null;
  wallet?: { balanceCredits?: number; totalRechargedCredits?: number; totalSpentCredits?: number };
  sessions?: RecordRow[];
};
type Detail = { user?: User; transactions?: RecordRow[]; orders?: RecordRow[] };

const FIELD_LABEL_KEYS: Record<string, LabelKey> = {
  id: "colId",
  type: "colType",
  amountCredits: "colCredits",
  balanceAfter: "colAfter",
  remark: "colRemark",
  createdAt: "colCreated",
  orderNo: "colOrderNo",
  orderType: "colType",
  paymentStatus: "status",
  amountVnd: "colAmount",
  ipAddress: "ipAddress",
  country: "colCountry",
  city: "colCity",
  expiresAt: "colExpires",
};

function Section({
  title,
  rows,
  fields,
  t,
  locale,
}: {
  title: string;
  rows?: RecordRow[];
  fields: string[];
  t: ReturnType<typeof useI18n>["t"];
  locale: string;
}) {
  const columns: Column<RecordRow>[] = fields.map((field) => ({
    key: field,
    header: FIELD_LABEL_KEYS[field] ? t(FIELD_LABEL_KEYS[field]) : field,
    cell: (row) => {
      const value = row[field];
      if (field === "paymentStatus" && typeof value === "string") return statusLabel(t, value);
      if (field.includes("At") || field === "expiresAt") return fmtDate(value as string, locale === "en" ? "en-US" : "zh-CN");
      if (/amount|balance|Credits|Vnd/i.test(field)) return fmtNum(value as number);
      return String(value ?? "—");
    },
  }));
  if (!rows?.length) return null;
  return <div className="mb-6"><h2 className="mb-2 text-h4">{title}</h2><DataTable columns={columns} rows={rows.slice(0, 15)} /></div>;
}

export default function AdminUserDetailPage() {
  const { t, locale } = useI18n();
  const id = String(useParams().id);
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [delta, setDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const [extendDays, setExtendDays] = useState(30);
  const [vipDate, setVipDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const detailQ = useQuery({ queryKey: ["admin", "user", id], queryFn: () => adminGetUser(id) as Promise<Detail> });
  const actionMut = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "user", id] });
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const act = (action: () => Promise<unknown>) => actionMut.mutate(action);
  const user = detailQ.data?.user;
  const dateLocale = locale === "en" ? "en-US" : "zh-CN";

  const sectionsProps = useMemo(() => ({ t, locale }), [t, locale]);

  return (
    <AdminShell title={user?.nickname || user?.email || t("userDetail")}>
      <Link href="/users" className="mb-4 inline-block text-body-sm text-ink-muted hover:text-ink">← {t("backToUsers")}</Link>
      {error || detailQ.error ? <p className="mb-3 text-body-sm text-danger">{error || (detailQ.error as Error).message}</p> : null}
      {detailQ.isLoading ? <p className="text-ink-muted">{t("loading")}</p> : null}
      {user ? (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard label={t("creditBalance")} value={fmtNum(user.wallet?.balanceCredits)} />
            <StatCard label={t("totalRecharged")} value={fmtNum(user.wallet?.totalRechargedCredits)} />
            <StatCard label={t("totalSpent")} value={fmtNum(user.wallet?.totalSpentCredits)} />
          </div>
          <div className="mb-6 space-y-3 card glass-card p-4 text-body-sm">
            <p>ID {String(user.id)} · {user.email || "—"} · {user.phone || "—"} · {user.locale || "—"} · <strong>{statusLabel(t, user.status)}</strong></p>
            <p className="text-caption text-ink-muted">{t("registeredAt")} {fmtDate(user.createdAt, dateLocale)}</p>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Input className="w-56" placeholder={t("statusChangeReason")} value={reason} onChange={(e) => setReason(e.target.value)} />
              {(["ACTIVE", "SUSPENDED", "BANNED"] as const).map((status) => (
                <Button key={status} size="sm" variant={status === "ACTIVE" ? "primary" : "danger"} disabled={actionMut.isPending} onClick={() => act(() => adminSetUserStatus(id, status, reason || (status === "ACTIVE" ? "restore" : "")))}>{statusLabel(t, status)}</Button>
              ))}
              <Button size="sm" variant="secondary" disabled={actionMut.isPending} onClick={() => act(() => adminForceLogout(id))}>{t("forceLogout")}</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span>{t("vipExpiry")}：{user.vipExpireAt ? fmtDate(user.vipExpireAt, dateLocale) : t("notActivated")}</span>
              <Input type="number" className="w-28" value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value))} />
              <Button size="sm" disabled={actionMut.isPending} onClick={() => act(() => adminSetUserVip(id, { extendDays }))}>{t("extendVip")}</Button>
              <Input type="datetime-local" className="w-52" value={vipDate} onChange={(e) => setVipDate(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={actionMut.isPending} onClick={() => act(() => adminSetUserVip(id, { vipExpireAt: vipDate ? new Date(vipDate).toISOString() : null }))}>{t("setExpire")}</Button>
              <Button size="sm" variant="ghost" disabled={actionMut.isPending} onClick={() => act(() => adminSetUserVip(id, { vipExpireAt: null }))}>{t("clearVip")}</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Input type="number" className="w-28" value={delta} onChange={(e) => setDelta(Number(e.target.value))} placeholder={t("adjustCreditsPlaceholder")} />
              <Input className="w-48" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={t("adjustReasonPlaceholder")} />
              <Button size="sm" disabled={actionMut.isPending} onClick={() => act(() => adminWalletAdjust(id, delta, adjustReason))}>{t("adjustBalance")}</Button>
            </div>
          </div>
          <Section title={t("recentTransactions")} rows={detailQ.data?.transactions} fields={["type", "amountCredits", "balanceAfter", "remark", "createdAt"]} {...sectionsProps} />
          <Section title={t("ordersSection")} rows={detailQ.data?.orders} fields={["orderNo", "orderType", "paymentStatus", "amountVnd", "createdAt"]} {...sectionsProps} />
          <Section title={t("sessions")} rows={user.sessions} fields={["id", "ipAddress", "country", "city", "createdAt", "expiresAt"]} {...sectionsProps} />
        </>
      ) : null}
    </AdminShell>
  );
}
