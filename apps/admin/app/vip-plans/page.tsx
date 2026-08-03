"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminCreateVipPlan, adminListVipPlans, adminUpdateVipPlan, asRows } from "@velvet/api-client";
import { vipPlanSchema, type VipPlanInput } from "@velvet/validators";
import { Button, DataTable, Input, StatCard, type Column } from "@velvet/ui";
import { AdminShell } from "@/components/admin-shell";
import { t } from "@/lib/i18n";

type Plan = VipPlanInput & { id: string; active?: boolean };
const empty: VipPlanInput = { name: "", durationDays: 30, basePrice: 28, sortOrder: 0, badge: "", active: true };

export default function AdminVipPlansPage() {
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
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "表单数据无效");
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
  const columns: Column<Plan>[] = [
    { key: "id", header: "ID", cell: (row) => row.id },
    { key: "name", header: "名称", cell: (row) => row.name || "—" },
    { key: "days", header: "天数", cell: (row) => String(row.durationDays) },
    { key: "price", header: "人民币价格", cell: (row) => String(row.basePrice) },
    { key: "badge", header: "徽标", cell: (row) => row.badge || "—" },
    { key: "sort", header: "排序", cell: (row) => String(row.sortOrder ?? 0) },
    { key: "status", header: t("status"), cell: (row) => (row.active ? "上架" : "下架") },
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
            {row.active ? "下架" : "上架"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminShell title={t("vipPlans")}>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="套餐数" value={rows.length} />
        <StatCard label="上架中" value={rows.filter((row) => row.active).length} />
        <StatCard label="定价币种" value="CNY" />
      </div>
      <p className="mb-4 text-body-sm text-ink-muted">
        VIP 套餐以人民币定价；支付成功后按天数延长会员，可叠加。
      </p>
      {error || listQ.error ? (
        <p className="mb-3 text-body-sm text-danger">{error || (listQ.error as Error).message}</p>
      ) : null}
      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-4">
        {([
          ["name", "名称", "text"],
          ["durationDays", "天数", "number"],
          ["basePrice", "人民币价格", "number"],
          ["badge", "徽标", "text"],
          ["sortOrder", "排序", "number"],
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
