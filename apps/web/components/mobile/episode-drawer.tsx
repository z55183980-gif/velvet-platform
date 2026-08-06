"use client";

import { useMemo, useState } from "react";
import { AudioLines, ChevronRight, Lock, Star } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useTheme } from "@/components/theme-provider";
import type { Episode } from "@/lib/mock-data";
import { buildEpisodeSlots, filterSlotsByRange } from "@/lib/episode-slots";
import { cn, mediaUrl } from "@/lib/utils";

const SEG_SIZE = 30;
const ACCENT = "#ff7e0d";

export function EpisodeDrawer({
  open,
  onClose,
  title,
  coverUrl,
  desc,
  episodes,
  episodesCount,
  selectedNo,
  isUnlocked,
  onUnlock,
  onSelect,
  favorited,
  onToggleFavorite,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  coverUrl?: string;
  desc?: string;
  episodes: Episode[];
  episodesCount: number;
  selectedNo?: number;
  isUnlocked: (ep: Episode) => boolean;
  onUnlock: (ep: Episode) => void;
  onSelect: (ep: Episode) => void;
  favorited?: boolean;
  onToggleFavorite?: () => void;
}) {
  const { t } = useLocale();
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  const [tab, setTab] = useState<"about" | "episodes">("episodes");
  const comingSoon = t("detail.episodeComingSoon");
  const total = Math.max(episodesCount || 0, episodes.length);
  const slots = useMemo(() => buildEpisodeSlots(episodes, total), [episodes, total]);

  const segments = useMemo(() => {
    const count = Math.max(1, Math.ceil(total / SEG_SIZE));
    return Array.from({ length: count }, (_, i) => {
      const start = i * SEG_SIZE + 1;
      const end = Math.min((i + 1) * SEG_SIZE, total);
      return { start, end, label: `${start}\u2013${end}` };
    });
  }, [total]);

  const [segIndex, setSegIndex] = useState(0);
  const activeSeg = segments[Math.min(segIndex, segments.length - 1)] ?? segments[0];
  const gridSlots = activeSeg
    ? filterSlotsByRange(slots, activeSeg.start, activeSeg.end)
    : slots;

  const cover = coverUrl ? mediaUrl(coverUrl) : "";

  return (
    <div
      className={cn(
        "fixed inset-0 z-[80] md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 transition-opacity",
          dark ? "bg-black/55" : "bg-black/45",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-label="close"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[72dvh] flex-col rounded-t-[18px] shadow-xl transition-transform duration-300",
          dark ? "bg-[#262626] text-white" : "bg-white text-[#1a1a1a]",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-2.5">
          <span
            className={cn(
              "h-1 w-9 rounded-full",
              dark ? "bg-white/25" : "bg-black/15",
            )}
          />
        </div>

        <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-1">
          <div
            className={cn(
              "relative h-[58px] w-[42px] shrink-0 overflow-hidden rounded-md",
              dark ? "bg-white/[0.08]" : "bg-[#f2f2f2]",
            )}
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "flex items-center gap-0.5 truncate text-[16px] font-semibold",
                dark ? "text-white" : "text-[#1a1a1a]",
              )}
            >
              <span className="truncate">{title}</span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 shrink-0",
                  dark ? "text-white/90" : "text-[#1a1a1a]/90",
                )}
              />
            </p>
            <p className={cn("mt-1 text-[12px]", dark ? "text-white/45" : "text-[#999]")}>
              {t("card.episodesAll", { n: total })}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-end gap-5 px-4">
          {(
            [
              ["about", t("detail.about")],
              ["episodes", t("detail.pickEpisodes")],
            ] as const
          ).map(([id, label]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "pb-2 text-[17px] transition-colors",
                  active
                    ? cn("font-bold", dark ? "text-white" : "text-[#1a1a1a]")
                    : cn("font-medium", dark ? "text-white/40" : "text-[#999]"),
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
          {tab === "about" ? (
            <p
              className={cn(
                "whitespace-pre-wrap text-[14px] leading-6",
                dark ? "text-white/55" : "text-[#555]",
              )}
            >
              {desc?.trim() || t("detail.about")}
            </p>
          ) : (
            <>
              {segments.length > 1 && (
                <div
                  className={cn(
                    "mb-3 flex gap-4 overflow-x-auto",
                    "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  )}
                >
                  {segments.map((seg, i) => (
                    <button
                      key={seg.label}
                      type="button"
                      onClick={() => setSegIndex(i)}
                      className={cn(
                        "shrink-0 text-[14px]",
                        i === segIndex
                          ? cn("font-semibold", dark ? "text-white" : "text-[#1a1a1a]")
                          : cn("font-normal", dark ? "text-white/40" : "text-[#999]"),
                      )}
                    >
                      {seg.label}
                    </button>
                  ))}
                </div>
              )}

              <ul className="grid grid-cols-6 gap-2.5">
                {gridSlots.map((slot) => {
                  if (slot.kind === "placeholder") {
                    return (
                      <li key={slot.no}>
                        <button
                          type="button"
                          disabled
                          title={comingSoon}
                          className={cn(
                            "relative flex aspect-square w-full cursor-default flex-col items-center justify-center gap-0.5 rounded-lg text-[12px] font-medium tabular-nums",
                            dark
                              ? "bg-white/[0.04] text-white/30"
                              : "bg-[#ececec] text-[#aaa]",
                          )}
                        >
                          <span className="text-[15px]">{slot.no}</span>
                          <span className="px-0.5 text-center text-[8px] leading-tight">
                            {comingSoon}
                          </span>
                        </button>
                      </li>
                    );
                  }
                  const ep = slot.episode;
                  const canPlay = isUnlocked(ep);
                  const active = selectedNo === ep.no;
                  return (
                    <li key={slot.no}>
                      <button
                        type="button"
                        onClick={() => (canPlay ? onSelect(ep) : onUnlock(ep))}
                        className={cn(
                          "relative flex aspect-square w-full items-center justify-center rounded-lg text-[15px] font-medium tabular-nums transition-colors",
                          active
                            ? "bg-[rgba(255,126,13,0.18)] text-[#ff7e0d]"
                            : dark
                              ? "bg-white/[0.08] text-white/85"
                              : "bg-[#f3f3f3] text-[#333]",
                        )}
                        title={canPlay ? undefined : t("vip.open")}
                      >
                        {!canPlay && (
                          <Lock
                            className={cn(
                              "absolute left-1 top-1 h-3 w-3",
                              dark ? "text-white/35" : "text-[#bbb]",
                            )}
                          />
                        )}
                        {active && (
                          <AudioLines
                            className="absolute right-0.5 top-0.5 h-3.5 w-3.5 text-[#ff7e0d]"
                            strokeWidth={2.25}
                          />
                        )}
                        {ep.no}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {onToggleFavorite && (
          <div
            className={cn(
              "shrink-0 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3",
              dark ? "border-t border-white/[0.06]" : "border-t border-black/[0.04]",
            )}
          >
            <button
              type="button"
              onClick={onToggleFavorite}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold text-white"
              style={{ background: ACCENT }}
            >
              <Star
                className={cn("h-5 w-5", favorited ? "fill-white text-white" : "text-white")}
                strokeWidth={1.75}
              />
              {favorited ? t("detail.favorited") : t("detail.favorite")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
