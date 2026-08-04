"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminCreateVipPlan, adminListVipPlans, adminUpdateVipPlan, asRows } from "@velvet/api-client";
import { vipPlanSchema, type VipPlanInput } from "@velvet/validators";
import { Button, DataTable, Input, StatCard, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { useI18n } from "@/lib/i18n";

type Plan = VipPlanInput & { id: string; active?: boolean };
const empty: VipPlanInput = { name: "", durationDays: 30, basePrice: 28, sortOrder: 0, badge: "", active: true };

export default function AdminVipPlansPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState<VipPlanInput>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listQ = useQuery({
    queryKey: ["admin", "vip-plans"],
    queryFn: async () => asRows<Plan>(await adminListVipPlans()),
  });
  const saveMut = useMutation({
    mutationFn: async () => {
      const parsed = vipPlanSchema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || t("validateFailed"));
      const payload = { ...parsed.data, name: parsed.data.name || undefined, badge: parsed.data.badge || undefined };
      return editing ? adminUpdateVipPlan(editing, payload) : adminCreateVipPlan(payload);
    },
    onSuccess: async () => {
      setEditing(null);
      setForm(empty);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "vip-plans"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: (plan: Plan) => adminUpdateVipPlan(plan.id, { active: !plan.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "vip-plans"] }),
    onError: (e: Error) => setError(e.message),
  });

  const rows = listQ.data ?? [];
  const columns: Column<Plan>[] = useMemo(
    () => [
      { key: "id", header: t("colId"), cell: (row) => row.id },
      { key: "name", header: t("colName"), cell: (row) => row.name || "—" },
      { key: "days", header: t("colDays"), cell: (row) => String(row.durationDays) },
      { key: "price", header: t("colPriceCny"), cell: (row) => String(row.basePrice) },
      { key: "badge", header: t("colBadge"), cell: (row) => row.badge || "—" },
      { key: "sort", header: t("colSort"), cell: (row) => String(row.sortOrder ?? 0) },
      { key: "status", header: t("status"), cell: (row) => (row.active ? t("onShelf") : t("offShelf")) },
      {
        key: "actions",
        header: t("actions"),
        cell: (row) => (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(row.id);
                setForm({
                  name: row.name || "",
                  durationDays: Number(row.durationDays),
                  basePrice: Number(row.basePrice),
                  sortOrder: Number(row.sortOrder) || 0,
                  badge: row.badge || "",
                  active: !!row.active,
                });
              }}
            >
              {t("edit")}
            </Button>
            <Button size="sm" variant="ghost" disabled={toggleMut.isPending} onClick={() => toggleMut.mutate(row)}>
              {row.active ? t("offShelf") : t("onShelf")}
            </Button>
          </div>
        ),
      },
    ],
    [t, toggleMut],
  );

  return (
    <AdminShell title={t("vipPlans")}>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label={t("planCount")} value={rows.length} />
        <StatCard label={t("liveCount")} value={rows.filter((row) => row.active).length} />
        <StatCard label={t("pricingCurrency")} value="CNY" />
      </div>
      <p className="mb-4 text-body-sm text-ink-muted">{t("vipPriceHint")}</p>
      {error || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{error || (listQ.error as Error).message}</p>
      ) : null}
      <div className="mb-6 flex flex-wrap items-end gap-2 card glass-card p-4">
        {([
          ["name", t("colName"), "text"],
          ["durationDays", t("colDays"), "number"],
          ["basePrice", t("colPriceCny"), "number"],
          ["badge", t("colBadge"), "text"],
          ["sortOrder", t("colSort"), "number"],
        ] as const).map(([key, label, type]) => (
          <label key={key} className="text-caption text-ink-muted">
            {label}
            <Input
              className="mt-1 w-32"
              type={type}
              step={key === "basePrice" ? "0.01" : undefined}
              value={form[key] as string | number}
              onChange={(e) =>
                setForm((value) => ({
                  ...value,
                  [key]: type === "number" ? Number(e.target.value) : e.target.value,
                }))
              }
            />
          </label>
        ))}
        <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
          {editing ? t("save") : t("create")}
        </Button>
        {editing ? (
          <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setForm(empty); }}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
      <DataTable columns={columns} rows={rows} loading={listQ.isFetching} emptyTitle={t("empty")} />
    </AdminShell>
  );
}
