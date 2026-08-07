"use client";

import { Crown, Pencil, Trash2 } from "lucide-react";
import { Button, Switch, cn } from "@velvet/ui";

export type VipPlanListModel = {
  id: string;
  name?: string | null;
  nameEn?: string | null;
  nameZh?: string | null;
  nameFr?: string | null;
  durationDays: number;
  basePrice: number | string;
  originalPrice?: number | string | null;
  sortOrder?: number;
  active?: boolean;
  badge?: string | null;
  desc?: string | null;
  descEn?: string | null;
  descZh?: string | null;
  descFr?: string | null;
  benefits?: string[] | null;
  updatedAt?: string;
};

type Labels = {
  name: string;
  days: string;
  price: string;
  originalPrice: string;
  sort: string;
  online: string;
  actions: string;
  edit: string;
  delete: string;
  onShelf: string;
  offShelf: string;
  unnamed: string;
};

export function VipPlanAdminList({
  plans,
  editingId,
  busy,
  labels,
  onEdit,
  onToggleShelf,
  onDelete,
}: {
  plans: VipPlanListModel[];
  editingId?: string | null;
  busy?: boolean;
  labels: Labels;
  onEdit: (plan: VipPlanListModel) => void;
  onToggleShelf: (plan: VipPlanListModel) => void;
  onDelete: (plan: VipPlanListModel) => void;
}) {
  return (
    <div className="min-h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="hidden grid-cols-[minmax(160px,1.5fr)_60px_90px_90px_56px_72px_160px] gap-3 border-b border-slate-200 bg-slate-50/90 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
        <span>{labels.name}</span>
        <span>{labels.days}</span>
        <span>{labels.price}</span>
        <span>{labels.originalPrice}</span>
        <span>{labels.sort}</span>
        <span className="text-center">{labels.online}</span>
        <span className="text-right">{labels.actions}</span>
      </div>

      <div className="divide-y divide-slate-100">
        {plans.map((plan) => {
          const price = Number(plan.basePrice);
          const original = plan.originalPrice != null ? Number(plan.originalPrice) : null;
          const displayName = plan.nameEn?.trim() || plan.name?.trim() || labels.unnamed;
          const live = !!plan.active;

          return (
            <div
              key={plan.id}
              className={cn(
                "grid gap-3 px-4 py-4 transition-colors hover:bg-slate-50/80 lg:grid-cols-[minmax(160px,1.5fr)_60px_90px_90px_56px_72px_160px] lg:items-center lg:px-5",
                editingId === plan.id && "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200",
                !plan.active && "opacity-70",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    plan.active ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-400",
                  )}
                >
                  <Crown className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{displayName}</span>
                    {plan.badge?.trim() ? (
                      <span className="max-w-28 shrink-0 truncate rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                        {plan.badge.trim()}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {plan.descEn || plan.desc || "—"}
                  </p>
                </div>
              </div>

              <ListValue label={labels.days} value={String(Number(plan.durationDays) || 0)} />
              <ListValue
                label={labels.price}
                value={`$${Number.isFinite(price) ? price.toFixed(2) : "0.00"}`}
                strong
              />
              <ListValue
                label={labels.originalPrice}
                value={
                  original != null && Number.isFinite(original)
                    ? `$${original.toFixed(2)}`
                    : "—"
                }
              />
              <ListValue label={labels.sort} value={`#${plan.sortOrder ?? 0}`} />

              <div className="flex items-center justify-between gap-3 lg:justify-center">
                <span className="text-[11px] font-medium text-slate-400 lg:hidden">{labels.online}</span>
                <Switch
                  size="sm"
                  checked={live}
                  disabled={busy}
                  title={live ? labels.offShelf : labels.onShelf}
                  aria-label={live ? labels.offShelf : labels.onShelf}
                  onCheckedChange={() => onToggleShelf(plan)}
                />
              </div>

              <div className="flex gap-2 border-t border-slate-100 pt-3 lg:justify-end lg:border-0 lg:pt-0">
                <Button
                  className="flex-1 cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] lg:flex-none"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onEdit(plan)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.edit}
                </Button>
                <Button
                  className="flex-1 cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed lg:flex-none"
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => onDelete(plan)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.delete}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListValue({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between lg:block">
      <span className="text-[11px] font-medium text-slate-400 lg:hidden">{label}</span>
      <span className={cn("text-sm text-slate-600", strong && "font-semibold text-slate-900")}>{value}</span>
    </div>
  );
}
