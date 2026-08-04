import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const btnBase =
  "inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-[background-color,transform,box-shadow,color] duration-150 ease-out select-none disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong shadow-brand",
  secondary:
    "border border-white/70 bg-white/70 text-ink backdrop-blur-md hover:bg-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]",
  ghost: "text-ink-muted hover:text-ink hover:bg-white/40",
  danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-body-sm",
  md: "h-10 px-4 text-body-sm",
  lg: "h-11 px-5 text-body-sm font-semibold",
};

export function buttonVariants(opts?: { variant?: Variant; size?: Size; className?: string }) {
  const { variant = "primary", size = "md", className } = opts || {};
  return cn(btnBase, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonVariants({ variant, size, className })} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-xl border border-white/70 bg-white/55 px-3 text-body-sm text-ink shadow-[inset_0_1px_2px_rgba(15,20,25,0.04)] outline-none backdrop-blur-md transition placeholder:text-slate-400 focus:border-[rgba(0,122,255,0.45)] focus:bg-white/70 focus:ring-2 focus:ring-accent-light",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-xl border border-white/70 bg-white/55 px-3 text-body-sm text-ink shadow-[inset_0_1px_2px_rgba(15,20,25,0.04)] outline-none backdrop-blur-md transition focus:border-[rgba(0,122,255,0.45)] focus:bg-white/70 focus:ring-2 focus:ring-accent-light",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const tones = {
    default: "bg-white/40 text-slate-600 border-white/60",
    success: "bg-emerald-400/15 text-emerald-700 border-emerald-300/40",
    warning: "bg-amber-400/15 text-amber-700 border-amber-300/40",
    danger: "bg-rose-400/15 text-rose-700 border-rose-300/40",
    info: "bg-sky-400/15 text-sky-800 border-sky-300/40",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-caption font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink md:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="card glass-card p-4 md:p-5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", warn ? "text-amber-700" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "card glass-card flex flex-col items-center justify-center border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-panel", className)} />;
}

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T extends object>({
  columns,
  rows,
  loading,
  emptyTitle = "暂无数据",
  emptyDescription,
  getRowKey,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  getRowKey?: (row: T, index: number) => string;
  className?: string;
}) {
  const shellClass = cn("card glass-card admin-fill", className);

  if (loading) {
    return (
      <div className={cn(shellClass, "flex flex-col justify-center gap-2 p-4")}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={shellClass} />;
  }
  return (
    <div className={cn(shellClass, "flex min-h-0 flex-col overflow-hidden")}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 border-b border-line bg-white/80 text-xs text-slate-500 backdrop-blur-sm">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn("px-3 py-2.5 font-medium", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const maybeId = (row as { id?: string | number }).id;
              return (
                <tr
                  key={getRowKey?.(row, i) ?? String(maybeId ?? i)}
                  className="border-b border-line hover:bg-panel/80"
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 py-3 align-middle", c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
