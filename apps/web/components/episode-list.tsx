"use client";

import { useMemo, useState } from "react";
import { Lock, Crown, Play } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import type { Episode } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { cn } from "@/lib/utils";

const SEG_SIZE = 30;
const SIDEBAR_SEG = 15;

function VipLockBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "absolute left-0 top-0 flex h-4 w-5 items-center justify-center rounded-br-lg rounded-tl-lg bg-white/[0.07]",
        className,
      )}
    >
      <Lock className="h-2.5 w-2.5 text-white/70" />
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
  /** sidebar = Hongguo player right-rail number tiles */
  layout?: "list" | "rail" | "grid" | "sidebar";
}) {
  const { locale, t } = useLocale();
  const epTitle = (ep: Episode) => pickContentText(locale, ep.titleVi, ep.titleZh);
  const unlocked = (ep: Episode) =>
    isUnlocked?.(ep) ?? !!(ep.isFree || ep.unlocked);

  const total = episodesCount ?? episodes.length;

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
  const gridEpisodes =
    (layout === "grid" || layout === "sidebar") && activeSeg
      ? episodes.filter((ep) => ep.no >= activeSeg.start && ep.no <= activeSeg.end)
      : episodes;

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

        <ul className="grid grid-cols-4 gap-2.5">
          {gridEpisodes.map((ep) => {
            const canPlay = unlocked(ep);
            const active = selectedNo === ep.no;
            return (
              <li key={ep.no}>
                <button
                  type="button"
                  onClick={() => (canPlay ? onSelect?.(ep) : onUnlock(ep))}
                  className={cn(
                    "relative flex h-[54px] w-full items-center justify-center rounded-lg text-[15px] transition-colors duration-150",
                    active
                      ? "bg-[rgba(250,119,5,0.12)] text-[#ff7e0d]"
                      : "bg-white/[0.08] text-white/90 hover:bg-white/[0.14]",
                  )}
                  title={canPlay ? undefined : t("vip.open")}
                >
                  {!canPlay && <VipLockBadge />}
                  {ep.no}
                </button>
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
          {gridEpisodes.map((ep) => {
            const canPlay = unlocked(ep);
            const active = selectedNo === ep.no;
            return (
              <li key={ep.no} className="shrink-0">
                <button
                  type="button"
                  onClick={() => (canPlay ? onSelect?.(ep) : onUnlock(ep))}
                  className={cn(
                    "relative flex h-[52px] min-w-[53px] items-center justify-center rounded-lg px-3 text-[14px] transition-colors",
                    active
                      ? "bg-white/20 text-white"
                      : "bg-white/[0.06] text-white hover:bg-white/20",
                  )}
                  title={canPlay ? undefined : t("vip.open")}
                >
                  {!canPlay && <VipLockBadge />}
                  {ep.no}
                </button>
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
          {gridEpisodes.map((ep) => {
            const canPlay = unlocked(ep);
            const active = selectedNo === ep.no;
            return (
              <li key={ep.no}>
                <button
                  type="button"
                  onClick={() => (canPlay ? onSelect?.(ep) : onUnlock(ep))}
                  className={cn(
                    "relative flex h-12 w-[120px] items-center justify-center rounded-lg text-[16px] tracking-wide transition-colors duration-150",
                    active
                      ? "bg-[rgba(250,119,5,0.12)] text-[#ff7e0d]"
                      : "bg-white/[0.06] text-white/90 hover:bg-white/20",
                  )}
                  title={canPlay ? undefined : t("vip.open")}
                >
                  {!canPlay && <VipLockBadge />}
                  <span className="opacity-90">{t("detail.episodeLabel", { n: ep.no })}</span>
                </button>
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
                        <Crown className="h-3 w-3 text-gold" />
                        {t("vip.open")}
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
                        : t("vip.open")}
                    </p>
                  </div>
                  {canPlay ? (
                    <Play className="h-4 w-4 text-ink-muted" />
                  ) : (
                    <Crown className="h-4 w-4 text-gold" />
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
