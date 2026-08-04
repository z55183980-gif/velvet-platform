"use client";

import { useMemo, useState } from "react";
import { Lock, Play } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import type { Episode } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { formatCredits } from "@/lib/utils";
import { cn } from "@/lib/utils";

const SEG_SIZE = 30;

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
  layout?: "list" | "rail" | "grid";
}) {
  const { locale, t } = useLocale();
  const epTitle = (ep: Episode) => pickContentText(locale, ep.titleVi, ep.titleZh);
  const unlocked = (ep: Episode) =>
    isUnlocked?.(ep) ?? !!(ep.isFree || ep.unlocked);

  const segments = useMemo(() => {
    const total = episodesCount ?? episodes.length;
    const count = Math.max(1, Math.ceil(total / SEG_SIZE));
    return Array.from({ length: count }, (_, i) => {
      const start = i * SEG_SIZE + 1;
      const end = Math.min((i + 1) * SEG_SIZE, total);
      return { start, end, label: `${start}-${end}` };
    });
  }, [episodes.length, episodesCount]);

  const [segIndex, setSegIndex] = useState(0);
  const activeSeg = segments[Math.min(segIndex, segments.length - 1)] ?? segments[0];
  const gridEpisodes =
    layout === "grid" && activeSeg
      ? episodes.filter((ep) => ep.no >= activeSeg.start && ep.no <= activeSeg.end)
      : episodes;

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-[20px] font-medium text-ink/95">{t("detail.episodeList")}</h2>
        <span className="text-caption text-ink-muted">
          {episodesCount ?? episodes.length} {t("card.episodes")}
        </span>
      </div>

      {layout === "grid" ? (
        <>
          {segments.length > 1 && (
            <div
              className={cn(
                "mb-3 flex gap-1 overflow-x-auto",
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
            >
              {segments.map((seg, i) => (
                <button
                  key={seg.label}
                  type="button"
                  onClick={() => setSegIndex(i)}
                  className={cn(
                    "flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center px-3 text-[14px] font-medium transition-colors",
                    i === segIndex ? "text-white" : "text-white/40",
                  )}
                >
                  {seg.label}
                </button>
              ))}
            </div>
          )}
          <ul
            className={cn(
              "grid max-h-[420px] grid-cols-5 gap-2 overflow-y-auto sm:grid-cols-6 md:flex md:max-h-[700px] md:flex-wrap md:gap-x-[17px] md:gap-y-4",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            )}
          >
            {gridEpisodes.map((ep) => {
              const canPlay = unlocked(ep);
              const active = selectedNo === ep.no;
              return (
                <li key={ep.no} className="md:w-auto">
                  <button
                    type="button"
                    onClick={() => (canPlay ? onSelect?.(ep) : onUnlock(ep))}
                    className={cn(
                      "relative flex aspect-square w-full items-center justify-center rounded-lg text-[14px] transition-colors duration-150 md:aspect-auto md:h-12 md:w-[120px] md:text-[16px] md:tracking-wide",
                      active
                        ? "bg-white/20 text-white"
                        : "bg-white/[0.06] text-white/90 hover:bg-white/20",
                    )}
                    title={canPlay ? undefined : formatCredits(ep.price, t("card.credits"))}
                  >
                    {!canPlay && (
                      <span className="absolute right-0 top-0 flex h-4 w-5 items-center justify-center rounded-bl-lg rounded-tr-lg bg-white/[0.07] md:left-0 md:right-auto md:rounded-br-lg md:rounded-tl-lg md:rounded-tr-none">
                        <Lock className="h-2.5 w-2.5 text-white/70" />
                      </span>
                    )}
                    <span className="opacity-90 md:hidden">{ep.no}</span>
                    <span className="hidden opacity-90 md:inline">
                      {t("detail.episodeLabel", { n: ep.no })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : layout === "rail" ? (
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
