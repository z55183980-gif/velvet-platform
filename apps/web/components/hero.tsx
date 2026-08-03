"use client";

import Link from "next/link";
import { Play, Star } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "./ui/button";
import { categoryName, type Drama } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { cn } from "@/lib/utils";

function isImg(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

export function Hero({ featured }: { featured: Drama }) {
  const { locale, t } = useLocale();
  const title = pickContentText(locale, featured.titleVi, featured.titleZh);
  const cat = categoryName(featured.categorySlug, locale);
  const cover = featured.cover[0];

  return (
    <section className="relative min-h-[78vh] w-full overflow-hidden md:min-h-[88vh]">
      {/* Full-bleed poster plane */}
      <div className="absolute inset-0">
        {isImg(cover) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            className="h-full w-full object-cover object-center animate-[hero-ken_18s_ease-out_forwards]"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ background: `linear-gradient(150deg, ${featured.cover[0]}, ${featured.cover[1]})` }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, oklch(0.12 0.01 250 / 0.92) 0%, oklch(0.12 0.01 250 / 0.55) 42%, oklch(0.12 0.01 250 / 0.25) 70%, transparent 100%), linear-gradient(0deg, var(--color-base) 0%, oklch(0.12 0.01 250 / 0.55) 28%, transparent 58%)",
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-[78vh] w-full max-w-[1200px] flex-col justify-end px-4 pb-16 pt-28 md:min-h-[88vh] md:px-6 md:pb-24 md:pt-32">
        <div className="w-full max-w-[36rem] animate-[rise-in_0.7s_var(--ease-out)_both]">
          <p className="text-display font-bold tracking-tight text-ink md:text-[4.5rem]">Velvet</p>
          <p className="mt-3 text-overline uppercase text-brand">{t("hero.overline")}</p>
          <h1 className="mt-4 text-h2 font-bold text-ink md:text-h1">{title}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-body-sm text-ink-muted">
            <span>{cat}</span>
            {featured.rating > 0 && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                {featured.rating.toFixed(1)}
              </span>
            )}
            <span>
              {featured.episodesCount} {t("card.episodes")}
            </span>
          </p>
          <p className="mt-4 max-w-[28rem] text-body text-ink-muted line-clamp-2">{t("hero.subtitle")}</p>
          <div className="mt-8">
            <Link
              href={`/drama/${featured.id}`}
              className={cn(
                buttonVariants({ variant: "primary", size: "lg" }),
                "inline-flex w-auto shrink-0 whitespace-nowrap shadow-brand",
              )}
            >
              <Play className="h-4 w-4 shrink-0" />
              {t("hero.ctaPrimary")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
