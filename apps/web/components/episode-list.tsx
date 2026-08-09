"use client";

import { useMemo, useState } from "react";
import { Crown, Play } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import type { Episode } from "@/lib/mock-data";
import { episodeRequiresMembership } from "@/lib/episode-membership";
import { buildEpisodeSlots, filterSlotsByRange } from "@/lib/episode-slots";
import { pickTitleText } from "@/lib/languages";
import { cn } from "@/lib/utils";

const SEG_SIZE = 30;
const SIDEBAR_SEG = 15;

function VipLockBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "absolute left-0 top-0 flex h-4 w-5 items-center justify-center rounded-br-lg rounded-tl-lg bg-gold/15",
        className,
      )}
      aria-hidden
    >
      <Crown className="h-2.5 w-2.5 text-gold" strokeWidth={2.25} />
    </span>
  );
}

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
  /** sidebar = desktop theater right-rail number tiles */
  layout?: "list" | "rail" | "grid" | "sidebar";
}) {
  const { locale, t } = useLocale();
  const epTitle = (ep: Episode) => pickTitleText(locale, ep.titleEn, ep.titleZh);
  const unlocked = (ep: Episode) =>
    isUnlocked?.(ep) ?? !!(ep.isFree || ep.unlocked);
  /** Crown = member pricing; click/play uses `unlocked` (VIP/purchase/free). */
  const showMemberBadge = (ep: Episode) => episodeRequiresMembership(ep);
  const comingSoon = t("detail.episodeComingSoon");

  const total = Math.max(episodesCount ?? 0, episodes.length);
  const slots = useMemo(() => buildEpisodeSlots(episodes, total), [episodes, total]);

  const segments = useMemo(() => {
    const size = layout === "sidebar" ? SIDEBAR_SEG : SEG_SIZE;
    const count = Math.max(1, Math.ceil(total / size));
    return Array.from({ length: count }, (_, i) => {
      const start = i * size + 1;
      const end = Math.min((i + 1) * size, total);
      return { start, end, label: `${start}-${end}` };
    });
  }, [total, layout]);

  const [segIndex, setSegIndex] = useState(0);
  const activeSeg = segments[Math.min(segIndex, segments.length - 1)] ?? segments[0];
  const gridSlots =
    (layout === "grid" || layout === "sidebar") && activeSeg
      ? filterSlotsByRange(slots, activeSeg.start, activeSeg.end)
      : slots;

  if (layout === "sidebar") {
    return (
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-medium text-white/90">{t("detail.episodeList")}</h2>
          <span className="text-[12px] text-white/40">{t("detail.episodeTotal", { n: total })}</span>
        </div>

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
                  "flex h-9 min-w-[3.75rem] shrink-0 items-center justify-center px-2 text-[13px] font-medium",
                  i === segIndex ? "text-white" : "text-white/40",
                )}
              >
                {seg.label}
              </button>
            ))}
          </div>
        )}

        <ul className="grid grid-cols-6 gap-2">
          {gridSlots.map((slot) => {
            const active = slot.kind === "episode" && selectedNo === slot.no;
            return (
              <li key={slot.no}>
                {slot.kind === "placeholder" ? (
                  <button
                    type="button"
                    disabled
                    title={comingSoon}
                    className="relative flex h-11 w-full cursor-default flex-col items-center justify-center gap-0.5 rounded-md bg-white/[0.04] text-white/30"
                  >
                    <span className="text-[14px] tabular-nums">{slot.no}</span>
                    <span className="text-[8px] leading-none">{comingSoon}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const ep = slot.episode;
                      unlocked(ep) ? onSelect?.(ep) : onUnlock(ep);
                    }}
                    className={cn(
                      "relative flex h-11 w-full items-center justify-center rounded-md text-[14px] transition-colors duration-150",
                      active
                        ? "bg-[rgba(250,119,5,0.12)] text-[#ff7e0d]"
                        : "bg-white/[0.08] text-white/90 hover:bg-white/[0.14]",
                    )}
                    title={unlocked(slot.episode) ? undefined : t("vip.open")}
                  >
                    {showMemberBadge(slot.episode) && <VipLockBadge />}
                    {slot.no}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (layout === "grid") {
    return (
      <section>
        <div className="mb-3 flex items-center justify-between md:mb-0">
          <h2 className="text-[16px] font-medium leading-none text-white md:text-[20px] md:text-white/90">
            {t("detail.episodeList")}
          </h2>
          <span className="text-[12px] leading-4 text-white/40">
            {t("detail.episodeTotal", { n: total })}
          </span>
        </div>

        {segments.length > 1 && (
          <div
            className={cn(
              "flex gap-1 overflow-x-auto md:mt-2",
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

        {/* Mobile: Hongguo horizontal episode chips */}
        <ul
          className={cn(
            "mt-1 flex gap-2 overflow-x-auto pl-0 md:hidden",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {gridSlots.map((slot) => {
            const active = slot.kind === "episode" && selectedNo === slot.no;
            return (
              <li key={slot.no} className="shrink-0">
                {slot.kind === "placeholder" ? (
                  <button
                    type="button"
                    disabled
                    title={comingSoon}
                    className="relative flex h-[52px] min-w-[53px] cursor-default flex-col items-center justify-center gap-0.5 rounded-lg bg-white/[0.04] px-3 text-white/30"
                  >
                    <span className="text-[14px] tabular-nums">{slot.no}</span>
                    <span className="text-[9px] leading-none">{comingSoon}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const ep = slot.episode;
                      unlocked(ep) ? onSelect?.(ep) : onUnlock(ep);
                    }}
                    className={cn(
                      "relative flex h-[52px] min-w-[53px] items-center justify-center rounded-lg px-3 text-[14px] transition-colors",
                      active
                        ? "bg-white/20 text-white"
                        : "bg-white/[0.06] text-white hover:bg-white/20",
                    )}
                    title={unlocked(slot.episode) ? undefined : t("vip.open")}
                  >
                    {showMemberBadge(slot.episode) && <VipLockBadge />}
                    {slot.no}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {/* Desktop: Hongguo wrap grid 「第N集」 */}
        <ul
          className={cn(
            "mt-6 hidden max-h-[700px] flex-wrap gap-x-[17px] gap-y-4 overflow-y-auto md:flex",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {gridSlots.map((slot) => {
            const active = slot.kind === "episode" && selectedNo === slot.no;
            return (
              <li key={slot.no}>
                {slot.kind === "placeholder" ? (
                  <button
                    type="button"
                    disabled
                    title={comingSoon}
                    className="relative flex h-12 w-[120px] cursor-default flex-col items-center justify-center gap-0.5 rounded-lg bg-white/[0.04] text-white/30"
                  >
                    <span className="text-[15px] tracking-wide">
                      {t("detail.episodeLabel", { n: slot.no })}
                    </span>
                    <span className="text-[10px] leading-none">{comingSoon}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const ep = slot.episode;
                      unlocked(ep) ? onSelect?.(ep) : onUnlock(ep);
                    }}
                    className={cn(
                      "relative flex h-12 w-[120px] items-center justify-center rounded-lg text-[16px] tracking-wide transition-colors duration-150",
                      active
                        ? "bg-[rgba(250,119,5,0.12)] text-[#ff7e0d]"
                        : "bg-white/[0.06] text-white/90 hover:bg-white/20",
                    )}
                    title={unlocked(slot.episode) ? undefined : t("vip.open")}
                  >
                    {showMemberBadge(slot.episode) && <VipLockBadge />}
                    <span className="opacity-90">{t("detail.episodeLabel", { n: slot.no })}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-[20px] font-medium text-ink/95">{t("detail.episodeList")}</h2>
        <span className="text-caption text-ink-muted">
          {total} {t("card.episodes")}
        </span>
      </div>

      {layout === "rail" ? (
        <ul
          className={cn(
            "flex gap-2.5 overflow-x-auto pb-2",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {slots.map((slot) => {
            if (slot.kind === "placeholder") {
              return (
                <li key={slot.no} className="shrink-0">
                  <button
                    type="button"
                    disabled
                    title={comingSoon}
                    className="flex min-w-[4.5rem] cursor-default flex-col items-center gap-1.5 rounded-md bg-surface-2/60 px-3 py-3 text-ink-subtle/50"
                  >
                    <span className="text-h4 font-semibold tabular-nums">{slot.no}</span>
                    <span className="text-caption">{comingSoon}</span>
                  </button>
                </li>
              );
            }
            const ep = slot.episode;
            const canPlay = unlocked(ep);
            const active = selectedNo === ep.no;
            return (
              <li key={slot.no} className="shrink-0">
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
                    {showMemberBadge(ep) ? (
                      <>
                        <Crown className="h-3 w-3 text-gold" />
                        {!canPlay ? t("vip.open") : null}
                      </>
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="flex flex-col gap-1">
          {slots.map((slot) => {
            if (slot.kind === "placeholder") {
              return (
                <li key={slot.no}>
                  <div className="flex w-full items-center gap-4 rounded-md px-3 py-3 text-left opacity-55">
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-surface-2 text-body-sm font-medium text-ink-subtle/60">
                      {slot.no}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-ink-subtle">
                        {t("detail.episodeLabel", { n: slot.no })}
                      </p>
                      <p className="mt-0.5 text-caption text-ink-subtle/70">{comingSoon}</p>
                    </div>
                  </div>
                </li>
              );
            }
            const ep = slot.episode;
            const canPlay = unlocked(ep);
            const active = selectedNo === ep.no;
            return (
              <li key={slot.no}>
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
                        : t("vip.open")}
                    </p>
                  </div>
                  {showMemberBadge(ep) ? (
                    <Crown className="h-4 w-4 text-gold" />
                  ) : (
                    <Play className="h-4 w-4 text-ink-muted" />
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
