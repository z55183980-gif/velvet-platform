"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type SwitchSize = "sm" | "md";

const trackSize: Record<SwitchSize, string> = {
  sm: "h-[22px] w-[40px]",
  md: "h-6 w-11",
};

const thumbSize: Record<SwitchSize, string> = {
  sm: "size-[18px] data-[checked=true]:translate-x-[18px]",
  md: "size-5 data-[checked=true]:translate-x-5",
};

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  size = "sm",
  className,
  title,
  "aria-label": ariaLabel,
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "type"> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: SwitchSize;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      data-checked={checked ? "true" : "false"}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,#14b8a6_35%,transparent)] focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-45",
        trackSize[size],
        checked ? "bg-[#14b8a6]" : "bg-slate-300/90",
        className,
      )}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) return;
        onCheckedChange?.(!checked);
      }}
    >
      <span
        aria-hidden
        data-checked={checked ? "true" : "false"}
        className={cn(
          "pointer-events-none absolute left-[2px] rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
          thumbSize[size],
        )}
      />
    </button>
  );
}
