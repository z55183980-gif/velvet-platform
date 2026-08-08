"use client";
/* eslint-disable @next/next/no-img-element -- central fallback wrapper for remote runtime media */

import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  fallback?: ReactNode;
  fallbackClassName?: string;
  fallbackLabel?: string;
};

export function SafeImage({
  src,
  alt = "",
  fallback,
  fallbackClassName,
  fallbackLabel = "Image unavailable",
  className,
  onError,
  ...props
}: SafeImageProps) {
  const [failed, setFailed] = useState(!src);

  useEffect(() => setFailed(!src), [src]);

  if (failed) {
    if (fallback) return <>{fallback}</>;
    return (
      <span
        className={cn(
          "flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-3 via-surface-2 to-base text-ink-subtle",
          className,
          fallbackClassName,
        )}
        role={alt ? "img" : undefined}
        aria-label={alt ? fallbackLabel : undefined}
        aria-hidden={alt ? undefined : true}
      >
        <ImageOff className="h-7 w-7 opacity-55" aria-hidden />
      </span>
    );
  }

  return (
    <img
      {...props}
      src={src || undefined}
      alt={alt}
      className={className}
      onError={(event) => {
        onError?.(event);
        if (!event.defaultPrevented) setFailed(true);
      }}
    />
  );
}
