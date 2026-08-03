"use client";

import { Lock, Play } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import type { Episode } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { formatCredits } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function EpisodeList({
  episodes,
  episodesCount,
  onUnlock,
  onSelect,
  isUnlocked,
  selectedNo,
  layout = "list",
}: {
  episodes: Episode[];
  episodesCount?: number;
  onUnlock: (ep: Episode) => void;
  onSelect?: (ep: Episode) => void;
  isUnlocked?: (ep: Episode) => boolean;
  selectedNo?: number;
  layout?: "list" | "rail";
}) {
  const { locale, t } = useLocale();
  const epTitle = (ep: Episode) => pickContentText(locale, ep.titleVi, ep.titleZh);
  const unlocked = (ep: Episode) =>
    isUnlocked?.(ep) ?? !!(ep.isFree || ep.unlocked);

  return (
    <section>
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-h3 font-semibold text-ink">{t("detail.episodeList")}</h2>
        <span className="text-caption text-ink-muted">
          {episodesCount ?? episodes.length} {t("card.episodes")}
        </span>
      </div>

      {layout === "rail" ? (
        <ul
          className={cn(
            "flex gap-2.5 overflow-x-auto pb-2",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {episodes.map((ep) => {
            const canPlay = unlocked(ep);
            const active = selectedNo === ep.no;
            return (
              <li key={ep.no} className="shrink-0">
                <button
                  type="button"
                  onClick={() => (canPlay ? onSelect?.(ep) : onUnlock(ep))}
                  className={cn(
                    "flex min-w-[4.5rem] flex-col items-center gap-1.5 rounded-md px-3 py-3 transition-colors",
                    active
                      ? "bg-brand text-white"
                      : "bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink",
                  )}
                >
                  <span className="text-h4 font-semibold tabular-nums">{ep.no}</span>
                  <span className="inline-flex items-center gap-1 text-caption opacity-80">
                    {canPlay ? (
                      <Play className="h-3 w-3" />
                    ) : (
                      <>
                        <Lock className="h-3 w-3" />
                        {formatCredits(ep.price, t("card.credits"))}
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="flex flex-col gap-1">
          {episodes.map((ep) => {
            const canPlay = unlocked(ep);
            const active = selectedNo === ep.no;
            return (
              <li key={ep.no}>
                <button
                  type="button"
                  onClick={() => (canPlay ? onSelect?.(ep) : onUnlock(ep))}
                  className={cn(
                    "flex w-full items-center gap-4 rounded-md px-3 py-3 text-left transition-colors",
                    active ? "bg-brand/15 text-ink" : "hover:bg-surface-2",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-9 w-9 flex-none place-items-center rounded-full text-body-sm font-medium",
                      active ? "bg-brand text-white" : "bg-surface-2 text-ink-muted",
                    )}
                  >
                    {ep.no}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-ink">{epTitle(ep)}</p>
                    <p className="mt-0.5 text-caption text-ink-subtle">
                      {canPlay
                        ? ep.isFree
                          ? t("card.free")
                          : t("card.unlocked")
                        : formatCredits(ep.price, t("card.credits"))}
                    </p>
                  </div>
                  {canPlay ? (
                    <Play className="h-4 w-4 text-ink-muted" />
                  ) : (
                    <Lock className="h-4 w-4 text-ink-subtle" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
