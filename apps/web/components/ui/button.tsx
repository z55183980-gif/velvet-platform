import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "gold";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-medium rounded-md transition-[background-color,transform,box-shadow,color] duration-200 ease-out select-none disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong hover:shadow-brand active:translate-y-px",
  secondary: "bg-surface-2 text-ink border border-line hover:bg-surface-3",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-2",
  gold: "bg-gold text-[#2A1E05] hover:opacity-90 active:translate-y-px",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-body-sm",
  md: "h-11 px-5 text-body",
  lg: "h-12 px-6 text-body",
};

export function buttonVariants(opts?: { variant?: Variant; size?: Size; className?: string }) {
  const { variant = "primary", size = "md", className } = opts || {};
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonVariants({ variant, size, className })} {...props} />;
}
