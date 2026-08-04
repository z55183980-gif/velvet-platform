"use client";

import { ArrowUpCircle, CircleCheck, CircleOff, Crown, Pencil, Power } from "lucide-react";
import { Badge, Button, cn } from "@velvet/ui";

export type VipPlanListModel = {
  id: string;
  name?: string | null;
  nameEn?: string | null;
  nameZh?: string | null;
  nameFr?: string | null;
  durationDays: number;
  basePrice: number | string;
  sortOrder?: number;
  active?: boolean;
  badge?: string | null;
  updatedAt?: string;
};

type Labels = {
  name: string;
  days: string;
  price: string;
  sort: string;
  status: string;
  actions: string;
  edit: string;
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
}: {
  plans: VipPlanListModel[];
  editingId?: string | null;
  busy?: boolean;
  labels: Labels;
  onEdit: (plan: VipPlanListModel) => void;
  onToggleShelf: (plan: VipPlanListModel) => void;
}) {
  return (
    <div className="min-h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="hidden grid-cols-[minmax(160px,1.6fr)_70px_100px_60px_80px_160px] gap-4 border-b border-slate-200 bg-slate-50/90 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
        <span>{labels.name}</span>
        <span>{labels.days}</span>
        <span>{labels.price}</span>
        <span>{labels.sort}</span>
        <span>{labels.status}</span>
        <span className="text-right">{labels.actions}</span>
      </div>

      <div className="divide-y divide-slate-100">
        {plans.map((plan) => {
          const price = Number(plan.basePrice);
          const displayName = plan.nameEn?.trim() || plan.name?.trim() || labels.unnamed;

          return (
            <div
              key={plan.id}
              className={cn(
                "grid gap-4 px-4 py-4 transition-colors hover:bg-slate-50/80 lg:grid-cols-[minmax(160px,1.6fr)_70px_100px_60px_80px_160px] lg:items-center lg:px-5",
                editingId === plan.id && "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200",
                !plan.active && "opacity-70",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  plan.active ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-400",
                )}>
                  <Crown className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{displayName}</span>
                    {plan.badge?.trim() ? (
                      <span className="max-w-24 shrink-0 truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                        {plan.badge.trim()}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">{plan.id}</p>
                </div>
              </div>

              <ListValue label={labels.days} value={String(Number(plan.durationDays) || 0)} />
              <ListValue
                label={labels.price}
                value={`$${Number.isFinite(price) ? price.toFixed(2) : "0.00"}`}
                strong
              />
              <ListValue label={labels.sort} value={`#${plan.sortOrder ?? 0}`} />

              <div className="flex items-center justify-between lg:block">
                <span className="text-[11px] font-medium text-slate-400 lg:hidden">{labels.status}</span>
                <Badge
                  tone={plan.active ? "success" : "default"}
                  className={cn(
                    "gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
                    plan.active
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-100 text-slate-500",
                  )}
                >
                  {plan.active ? (
                    <CircleCheck className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.25} aria-hidden="true" />
                  ) : (
                    <CircleOff className="h-3.5 w-3.5 text-slate-400" strokeWidth={2.25} aria-hidden="true" />
                  )}
                  {plan.active ? labels.onShelf : labels.offShelf}
                </Badge>
              </div>

              <div className="flex gap-2 border-t border-slate-100 pt-3 lg:justify-end lg:border-0 lg:pt-0">
                <Button
                  className="flex-1 cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] lg:flex-none"
                  size="sm"
                  variant="secondary"
                  onClick={() => onEdit(plan)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.edit}
                </Button>
                <Button
                  className="flex-1 cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed lg:flex-none"
                  size="sm"
                  variant={plan.active ? "danger" : "secondary"}
                  disabled={busy}
                  onClick={() => onToggleShelf(plan)}
                >
                  {plan.active ? <Power className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                  {plan.active ? labels.offShelf : labels.onShelf}
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
