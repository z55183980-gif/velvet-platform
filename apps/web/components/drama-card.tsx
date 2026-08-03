"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { Badge } from "./ui/badge";
import { categoryName, type Drama } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { formatCredits, cn } from "@/lib/utils";

function isImg(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

export function DramaCard({ drama, compact }: { drama: Drama; compact?: boolean }) {
  const { locale, t } = useLocale();
  const title = pickContentText(locale, drama.titleVi, drama.titleZh);
  const cat = categoryName(drama.categorySlug, locale);
  const isFree = drama.freeCount > 0;

  return (
    <Link href={`/drama/${drama.id}`} className="group block">
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-md bg-surface-2",
          "transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out)] group-hover:scale-[1.04]",
        )}
      >
        {isImg(drama.cover[0]) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={drama.cover[0]}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(150deg, ${drama.cover[0]}, ${drama.cover[1]})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80" />

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

        <div className="absolute bottom-2.5 left-2.5">
          {isFree ? (
            <Badge variant="free">{t("card.free")}</Badge>
          ) : drama.pricePerEp > 0 ? (
            <span className="text-caption font-medium text-white/90">
              {formatCredits(drama.pricePerEp, t("card.credits"))}
            </span>
          ) : null}
        </div>
      </div>

      <div className={cn(compact ? "pt-3" : "pt-4")}>
        <h3
          className={cn(
            "font-semibold text-ink transition-colors group-hover:text-brand",
            compact ? "line-clamp-2 text-body-sm" : "line-clamp-2 text-h4",
          )}
        >
          {title}
        </h3>
        {!compact && (
          <p className="mt-1.5 text-caption text-ink-muted">
            {cat} · {drama.episodesCount} {t("card.episodes")}
          </p>
        )}
      </div>
    </Link>
  );
}
