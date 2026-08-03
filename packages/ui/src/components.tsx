import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const btnBase =
  "inline-flex items-center justify-center gap-2 font-medium rounded-md transition-[background-color,transform,box-shadow,color] duration-200 ease-out select-none disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong hover:shadow-brand active:translate-y-px",
  secondary: "bg-surface-2 text-ink border border-line hover:bg-surface-3",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-body-sm",
  md: "h-11 px-5 text-body",
  lg: "h-12 px-6 text-body",
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
        "w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-line-strong",
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
        "w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink focus:outline-none focus:border-line-strong",
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
    default: "bg-surface-2 text-ink-muted border-line",
    success: "bg-success/15 text-success border-success/30",
    warning: "bg-warning/15 text-warning border-warning/30",
    danger: "bg-danger/15 text-danger border-danger/30",
    info: "bg-info/15 text-info border-info/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium",
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-h3 font-semibold">{title}</h1>
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
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-caption text-ink-muted">{label}</p>
      <p className={cn("mt-1 text-h3 tabular-nums", warn ? "text-warning" : "")}>{value}</p>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <p className="text-body font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 text-body-sm text-ink-muted">{description}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
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
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  getRowKey?: (row: T, index: number) => string;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[640px] text-left text-body-sm">
        <thead className="bg-surface-2 text-caption text-ink-muted">
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
                className="border-t border-line hover:bg-surface-2/40"
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2.5 align-middle", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
