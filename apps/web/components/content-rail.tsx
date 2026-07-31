"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DramaCard } from "./drama-card";
import type { Drama } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function ContentRail({
  title,
  subtitle,
  dramas,
  loading,
}: {
  title: string;
  subtitle?: string;
  dramas: Drama[];
  loading?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  const scrollBy = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    const amount = Math.min(el.clientWidth * 0.75, 520);
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  return (
    <section className="group/rail relative">
      <div className="mb-5 flex items-end justify-between gap-4 px-4 md:px-6">
        <div>
          <h2 className="text-h3 font-bold text-ink md:text-h2">{title}</h2>
          {subtitle ? <p className="mt-1 text-body-sm text-ink-subtle">{subtitle}</p> : null}
        </div>
        <div className="hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
            aria-label="Previous"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
            aria-label="Next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className={cn(
          "flex gap-4 overflow-x-auto px-4 pb-2 scroll-smooth md:px-6",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[2/3] w-[142px] shrink-0 animate-pulse rounded-md bg-surface-2 sm:w-[168px]"
              />
            ))
          : dramas.map((d) => (
              <div key={d.id} className="w-[142px] shrink-0 sm:w-[168px]">
                <DramaCard drama={d} compact />
              </div>
            ))}
      </div>
    </section>
  );
}
