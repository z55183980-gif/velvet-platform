"use client";

import { Coins, Pencil, Trash2 } from "lucide-react";
import { Button, Switch, cn } from "@velvet/ui";

export type TopupPackageListModel = {
  id: string;
  name?: string | null;
  baseCredits?: number | string;
  bonusCredits?: number | string;
  credits: number | string;
  basePrice: number | string;
  sortOrder?: number;
  active?: boolean;
  badge?: string | null;
  updatedAt?: string;
};

type Labels = {
  name: string;
  immediate: string;
  bonus: string;
  total: string;
  price: string;
  sort: string;
  online: string;
  actions: string;
  edit: string;
  delete: string;
  onShelf: string;
  offShelf: string;
  unnamed: string;
};

export function TopupPackageAdminList({
  packages,
  editingId,
  busy,
  labels,
  onEdit,
  onToggleShelf,
  onDelete,
}: {
  packages: TopupPackageListModel[];
  editingId?: string | null;
  busy?: boolean;
  labels: Labels;
  onEdit: (pkg: TopupPackageListModel) => void;
  onToggleShelf: (pkg: TopupPackageListModel) => void;
  onDelete: (pkg: TopupPackageListModel) => void;
}) {
  return (
    <div className="min-h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="hidden grid-cols-[minmax(140px,1.4fr)_72px_72px_72px_90px_56px_72px_160px] gap-3 border-b border-slate-200 bg-slate-50/90 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
        <span>{labels.name}</span>
        <span>{labels.immediate}</span>
        <span>{labels.bonus}</span>
        <span>{labels.total}</span>
        <span>{labels.price}</span>
        <span>{labels.sort}</span>
        <span className="text-center">{labels.online}</span>
        <span className="text-right">{labels.actions}</span>
      </div>

      <div className="divide-y divide-slate-100">
        {packages.map((pkg) => {
          const price = Number(pkg.basePrice);
          const displayName = pkg.name?.trim() || labels.unnamed;
          const base = Number(pkg.baseCredits ?? pkg.credits) || 0;
          const bonus = Number(pkg.bonusCredits ?? 0) || 0;
          const total = Number(pkg.credits) || base + bonus;
          const live = !!pkg.active;

          return (
            <div
              key={pkg.id}
              className={cn(
                "grid gap-3 px-4 py-4 transition-colors hover:bg-slate-50/80 lg:grid-cols-[minmax(140px,1.4fr)_72px_72px_72px_90px_56px_72px_160px] lg:items-center lg:px-5",
                editingId === pkg.id && "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200",
                !pkg.active && "opacity-70",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    pkg.active ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-400",
                  )}
                >
                  <Coins className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{displayName}</span>
                    {pkg.badge?.trim() ? (
                      <span className="max-w-24 shrink-0 truncate rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                        {pkg.badge.trim()}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">{pkg.id}</p>
                </div>
              </div>

              <ListValue label={labels.immediate} value={String(base)} />
              <ListValue label={labels.bonus} value={bonus > 0 ? `+${bonus}` : "0"} />
              <ListValue label={labels.total} value={String(total)} strong />
              <ListValue
                label={labels.price}
                value={`$${Number.isFinite(price) ? price.toFixed(2) : "0.00"}`}
                strong
              />
              <ListValue label={labels.sort} value={`#${pkg.sortOrder ?? 0}`} />

              <div className="flex items-center justify-between gap-3 lg:justify-center">
                <span className="text-[11px] font-medium text-slate-400 lg:hidden">{labels.online}</span>
                <Switch
                  size="sm"
                  checked={live}
                  disabled={busy}
                  title={live ? labels.offShelf : labels.onShelf}
                  aria-label={live ? labels.offShelf : labels.onShelf}
                  onCheckedChange={() => onToggleShelf(pkg)}
                />
              </div>

              <div className="flex gap-2 border-t border-slate-100 pt-3 lg:justify-end lg:border-0 lg:pt-0">
                <Button
                  className="flex-1 cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] lg:flex-none"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onEdit(pkg)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.edit}
                </Button>
                <Button
                  className="flex-1 cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed lg:flex-none"
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => onDelete(pkg)}
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
