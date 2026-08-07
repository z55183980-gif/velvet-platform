import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const btnBase =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-medium transition-[background-color,transform,box-shadow,color,filter] duration-150 ease-out select-none hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none disabled:active:scale-100";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-strong shadow-brand disabled:bg-surface-3 disabled:text-ink-muted disabled:shadow-none",
  secondary:
    "border border-white/70 bg-white/70 text-ink backdrop-blur-md hover:bg-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] disabled:border-line disabled:bg-surface-3 disabled:text-ink-muted disabled:shadow-none disabled:backdrop-blur-none",
  ghost:
    "text-ink-muted hover:text-ink hover:bg-white/40 disabled:text-ink-subtle disabled:hover:bg-transparent",
  danger:
    "border border-danger/20 bg-danger-soft text-danger hover:bg-danger/15 disabled:border-transparent disabled:bg-surface-3 disabled:text-ink-muted",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-body-sm",
  md: "h-10 px-4 text-body-sm",
  lg: "h-11 px-5 text-body-sm font-semibold",
};

const fieldBase =
  "w-full rounded-xl border border-white/70 bg-white/55 px-3 text-body-sm text-ink shadow-[inset_0_1px_2px_rgba(15,20,25,0.04)] outline-none backdrop-blur-md transition focus:border-brand/45 focus:bg-white/70 focus:ring-2 focus:ring-brand-soft";

export function buttonVariants(opts?: { variant?: Variant; size?: Size; className?: string }) {
  const { variant = "primary", size = "md", className } = opts || {};
  // Size before variant so text color (`text-white`) isn't clobbered by `text-body-sm`
  // if twMerge theme config is outdated.
  return cn(btnBase, sizes[size], variants[variant], className);
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
      className={cn(fieldBase, "h-10 placeholder:text-ink-subtle", className)}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        fieldBase,
        "velvet-select h-10 cursor-pointer appearance-none pr-9 hover:border-brand/25 hover:bg-white/75 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60",
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
    default: "bg-white/40 text-ink-muted border-white/60",
    success: "bg-success-soft text-success border-success/20",
    warning: "bg-warning-soft text-warning border-warning/20",
    danger: "bg-danger-soft text-danger border-danger/20",
    info: "bg-info-soft text-info border-info/20",
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
        <h1 className="text-h4 font-semibold tracking-tight text-ink md:text-h3">{title}</h1>
        {description ? <p className="mt-1 text-body-sm text-ink-muted">{description}</p> : null}
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
      <p className="text-caption font-medium text-ink-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", warn ? "text-warning" : "text-ink")}>
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
      <p className="text-body-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 text-body-sm text-ink-muted">{description}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-panel", className)} />;
}

export type Column<T> = {
  key: string;
  header: ReactNode;
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
        <table className="w-full min-w-[640px] text-left text-body-sm">
          <thead className="sticky top-0 border-b border-line bg-white/80 text-caption text-ink-subtle backdrop-blur-sm">
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
