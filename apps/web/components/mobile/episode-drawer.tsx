"use client";

import { X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { EpisodeList } from "@/components/episode-list";
import type { Episode } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function EpisodeDrawer({
  open,
  onClose,
  episodes,
  episodesCount,
  selectedNo,
  isUnlocked,
  onUnlock,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  episodes: Episode[];
  episodesCount: number;
  selectedNo?: number;
  isUnlocked: (ep: Episode) => boolean;
  onUnlock: (ep: Episode) => void;
  onSelect: (ep: Episode) => void;
}) {
  const { t } = useLocale();

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/55 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-label="close"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-base px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-xl transition-transform duration-300",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-h4 font-semibold text-ink">{t("detail.episodeList")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-surface-2"
            aria-label="close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <EpisodeList
          episodes={episodes}
          episodesCount={episodesCount}
          selectedNo={selectedNo}
          layout="list"
          isUnlocked={isUnlocked}
          onUnlock={onUnlock}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}
