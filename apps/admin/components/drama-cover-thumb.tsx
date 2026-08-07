"use client";

import { useEffect, useState } from "react";
import { cn } from "@velvet/ui";
import { coverInitials, mediaUrl } from "@/lib/media-url";

type DramaCoverThumbProps = {
  url?: string | null;
  title?: string | null;
  className?: string;
  imgClassName?: string;
};

/**
 * List/detail cover with graceful fallback (no browser broken-image icon).
 */
export function DramaCoverThumb({ url, title, className, imgClassName }: DramaCoverThumbProps) {
  const src = mediaUrl(url);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImg = !!src && !failed;

  return (
    <div
      className={cn(
        "flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-panel text-[10px] font-semibold text-ink-subtle ring-1 ring-line",
        className,
      )}
      aria-hidden={!showImg}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className={cn("h-full w-full object-cover", imgClassName)}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="px-0.5 text-center leading-tight">{coverInitials(title)}</span>
      )}
    </div>
  );
}
