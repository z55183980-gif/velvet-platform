"use client";

import Link from "next/link";
import { Flame, Star } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { Badge } from "./ui/badge";
import { type Drama } from "@/lib/mock-data";
import { pickTagText, toPublicDramaTagObjects } from "@/lib/drama-tags";
import { pickTitleText } from "@/lib/languages";
import { formatCount, formatCredits, cn } from "@/lib/utils";
import { SafeImage } from "@/components/safe-image";

function isImg(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function dramaCardHeat(d: Drama) {
  return Math.max(0, (d.likeCount ?? 0) + (d.favoriteCount ?? 0));
}

export function DramaCard({
  drama,
  compact,
  variant = "default",
  reserveTitleLines,
}: {
  drama: Drama;
  compact?: boolean;
  /** Hongguo-style home grid: episode badge on poster, tags under title */
  variant?: "default" | "grid";
  /** Keep title block height for N lines so grid rows align (single-line titles included). */
  reserveTitleLines?: 1 | 2;
}) {
  const { locale, t } = useLocale();
  const title = pickTitleText(locale, drama.titleEn, drama.titleZh, drama.titleFr);
  const tags = toPublicDramaTagObjects(drama.tags)
    .slice(0, 2)
    .map((tag) => pickTagText(locale, tag));
  const heatLabel = formatCount(dramaCardHeat(drama), locale);
  const isFree = drama.freeCount > 0;
  const isGrid = variant === "grid";
  const metaClass = isGrid
    ? "mt-1.5 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden whitespace-nowrap text-[12px] text-ink-subtle"
    : compact
      ? "mt-1 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden whitespace-nowrap text-caption text-ink-subtle"
      : "mt-1.5 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden whitespace-nowrap text-caption text-ink-muted";

  return (
    <Link href={`/drama/${drama.id}`} className="group block min-w-0 max-w-full">
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden bg-surface-2",
          isGrid ? "rounded-lg" : "rounded-md",
          "transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out)] group-hover:scale-[1.03]",
        )}
      >
        {isImg(drama.cover[0]) ? (
          <SafeImage
            src={drama.cover[0]}
            alt={title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            fallbackLabel={t("common.imageUnavailable")}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(150deg, ${drama.cover[0]}, ${drama.cover[1]})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-90" />

        {isGrid ? (
          <div className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white/95 backdrop-blur-sm">
            {t("card.episodesAll", { n: drama.episodesCount })}
          </div>
        ) : (
          <>
            {drama.isVip && (
              <div className="absolute left-2.5 top-2.5">
                <Badge variant="vip">{t("card.vip")}</Badge>
              </div>
            )}
            {!compact && drama.rating > 0 && (
              <div className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-caption text-white backdrop-blur-sm">
                <Star className="h-3 w-3 fill-gold text-gold" />
                {drama.rating.toFixed(1)}
              </div>
            )}
            {drama.pricePerEp > 0 && !isFree ? (
              <div className="absolute bottom-2.5 left-2.5">
                <span className="text-caption font-medium text-white/90">
                  {formatCredits(drama.pricePerEp, t("card.credits"))}
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className={cn(compact || isGrid ? "pt-2.5" : "pt-4")}>
        <h3
          className={cn(
            "font-semibold text-ink transition-colors group-hover:text-brand",
            isGrid
              ? "line-clamp-1 text-[14px] leading-snug"
              : compact
                ? "line-clamp-2 text-body-sm"
                : "line-clamp-2 text-h4",
            reserveTitleLines === 2 &&
              "min-h-[calc(var(--text-body-sm)*var(--text-body-sm--line-height)*2)]",
            reserveTitleLines === 1 &&
              "min-h-[calc(var(--text-body-sm)*var(--text-body-sm--line-height))]",
          )}
        >
          {title}
        </h3>
        <p className={metaClass}>
          <Flame className="h-3 w-3 shrink-0 text-[#ff8a3d]" fill="currentColor" aria-hidden />
          <span className="shrink-0 tabular-nums">{heatLabel}</span>
          {tags.length > 0 ? (
            <>
              <span className="shrink-0 text-ink-subtle/80" aria-hidden>
                ·
              </span>
              <span className="min-w-0 truncate">{tags.join(" · ")}</span>
            </>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
