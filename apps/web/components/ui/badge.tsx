import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "vip" | "free" | "hot";

const variants: Record<Variant, string> = {
  default: "bg-surface-2 text-ink-muted border-line",
  vip: "bg-gold-soft text-gold border-gold/40",
  free: "bg-success/15 text-success border-success/30",
  hot: "bg-brand-soft text-brand border-brand/40",
};

export function Badge({
  variant = "default",
  className,
  children,
}: {
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption uppercase",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
