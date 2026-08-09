"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { categoryName, type Drama } from "@/lib/mock-data";
import { pickContentText, pickTitleText, type Locale } from "@/lib/languages";
import { heroObjectPosition } from "@/lib/hero-crop";
import { cn } from "@/lib/utils";
import { SafeImage } from "@/components/safe-image";

function isImg(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

const AUTO_MS = 5500;

/** banner = landscape promo art; poster = vertical drama coverUrl */
export type HeroCoverKind = "banner" | "poster";

export type HeroSlide = {
  id: string;
  titleEn: string;
  titleZh: string;
  titleFr?: string;
  descEn?: string;
  descZh?: string;
  cover: [string, string];
  href: string;
  tags?: string[];
  coverKind?: HeroCoverKind;
  /** PC Hero object-position percent within fixed crop frame */
  focusX?: number;
  focusY?: number;
};

function dramaTags(drama: Drama, locale: Locale, t: (k: string) => string): string[] {
  const cat = categoryName(drama.category ?? drama.categorySlug, locale);
  const tags = [cat];
  if (drama.isVip) tags.push(t("card.vip"));
  if (drama.freeCount > 0) tags.push(t("card.free"));
  tags.push(`${drama.episodesCount} ${t("card.episodes")}`);
  return tags.slice(0, 4);
}

export function dramaToHeroSlide(
  drama: Drama,
  locale: Locale,
  t: (k: string) => string,
): HeroSlide {
  return {
    id: drama.id,
    titleEn: drama.titleEn,
    titleZh: drama.titleZh,
    titleFr: drama.titleFr,
    descEn: drama.descEn,
    descZh: drama.descZh,
    cover: drama.cover,
    href: `/drama/${drama.id}`,
    tags: dramaTags(drama, locale, t),
    coverKind: "poster",
  };
}

export function Hero({ slides }: { slides: HeroSlide[] }) {
  const { locale, t } = useLocale();
  const items = useMemo(() => slides.slice(0, 5), [slides]);
  const slideKey = items.map((s) => s.id).join("|");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);
  const touchX = useRef<number | null>(null);

  const goTo = useCallback(
    (i: number) => {
      if (items.length === 0) return;
      setIndex((prev) => {
        const next = ((i % items.length) + items.length) % items.length;
        if (next !== prev) setFadeKey((k) => k + 1);
        return next;
      });
    },
    [items.length],
  );

  useEffect(() => {
    if (items.length <= 1 || paused) return;
    const id = window.setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % items.length;
        setFadeKey((k) => k + 1);
        return next;
      });
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [paused, items.length]);

  useEffect(() => {
    setIndex(0);
    setFadeKey((k) => k + 1);
  }, [slideKey]);

  if (items.length === 0) return null;

  const current = items[index] ?? items[0];
  const title = pickTitleText(locale, current.titleEn, current.titleZh, current.titleFr);
  const desc = pickContentText(locale, current.descEn || "", current.descZh || "");
  const tags = current.tags ?? [];
  const cover = current.cover[0];
  const objectPos = heroObjectPosition(current.focusX, current.focusY);

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 48) return;
    goTo(index + (dx < 0 ? 1 : -1));
  };

  return (
    <section
      className="relative h-[100dvh] min-h-[560px] w-full overflow-hidden bg-black"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="absolute inset-0 bg-black" key={fadeKey}>
        {isImg(cover) ? (
          <>
            {/* Mobile: full-bleed cover */}
            <SafeImage
              src={cover}
              alt={title}
              className="h-full w-full object-cover opacity-0 md:hidden [animation:hero-fade_0.55s_var(--ease-out)_forwards,hero-ken_16s_ease-out_forwards]"
              style={{ objectPosition: objectPos }}
              fallbackLabel={t("common.imageUnavailable")}
            />
            {/* Desktop ambient — same soft wash for any source ratio */}
            <SafeImage
              src={cover}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 hidden scale-110 object-cover opacity-[0.18] blur-3xl md:block [mask-image:linear-gradient(90deg,transparent_0%,transparent_35%,#000_62%)] [-webkit-mask-image:linear-gradient(90deg,transparent_0%,transparent_35%,#000_62%)]"
              style={{ objectPosition: objectPos }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute right-[12%] top-[16%] hidden h-[58%] w-[46%] rounded-full md:block"
              style={{
                background:
                  "radial-gradient(circle, transparent 42%, rgba(212,160,70,0.22) 52%, rgba(212,160,70,0.08) 62%, transparent 72%)",
                filter: "blur(2px)",
              }}
            />
            {/* Desktop: fixed-ratio soft window; position from banner focusX/Y */}
            <div
              className="absolute bottom-[4%] right-0 top-[2%] hidden w-[min(74%,1200px)] overflow-hidden opacity-0 md:block [animation:hero-fade_0.55s_var(--ease-out)_forwards] [mask-image:radial-gradient(ellipse_68%_78%_at_58%_40%,#000_22%,transparent_72%)] [-webkit-mask-image:radial-gradient(ellipse_68%_78%_at_58%_40%,#000_22%,transparent_72%)]"
            >
              <SafeImage
                src={cover}
                alt={title}
                className="h-full w-full object-cover [animation:hero-ken_16s_ease-out_forwards]"
                style={{ objectPosition: objectPos }}
                fallbackLabel={t("common.imageUnavailable")}
              />
            </div>
          </>
        ) : (
          <div
            className="h-full w-full animate-[hero-fade_0.55s_var(--ease-out)_both]"
            style={{
              background: `radial-gradient(ellipse 70% 60% at 60% 40%, ${current.cover[1]}88, transparent 70%), linear-gradient(150deg, ${current.cover[0]}, ${current.cover[1]})`,
            }}
          />
        )}
        {/* Left text lane + bottom/top vignette */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, #000 0%, #000 22%, rgba(0,0,0,0.72) 36%, rgba(0,0,0,0.28) 52%, rgba(0,0,0,0.06) 68%, transparent 82%), linear-gradient(0deg, #000 0%, rgba(0,0,0,0.7) 12%, transparent 38%), linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 16%)",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto h-full w-full max-w-[1280px] px-6 md:px-10">
        <div className="absolute inset-x-6 bottom-[9.5rem] z-10 md:inset-x-10 md:bottom-[10.5rem]">
          <div
            key={`copy-${fadeKey}`}
            className="max-w-[36rem] animate-[rise-in_0.55s_var(--ease-out)_both]"
          >
            <h1 className="text-[2rem] font-bold leading-[1.15] tracking-tight text-white md:text-[2.75rem] lg:text-[3.25rem]">
              {title}
            </h1>

            <div className="mt-4 flex flex-wrap gap-3">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex h-8 max-w-[10.5rem] items-center truncate rounded-md bg-white/[0.08] px-3 text-[14px] leading-none text-white/80"
                >
                  {tag}
                </span>
              ))}
            </div>

            {desc ? (
              <p className="mt-5 max-w-[35rem] text-[14px] leading-relaxed text-white/50 line-clamp-2 md:text-[15px]">
                {desc}
              </p>
            ) : null}
          </div>
        </div>

        <div className="absolute inset-x-6 bottom-[4.5rem] z-20 flex items-end justify-between gap-6 md:inset-x-10 md:bottom-[4.5rem]">
          <Link
            href={current.href}
            className="group relative z-0 inline-flex h-[52px] w-[192px] shrink-0 items-center justify-center rounded-xl text-white transition-[transform,opacity] duration-150 hover:opacity-95 active:translate-y-px"
            style={{
              background: "linear-gradient(92.27deg, #c81038 0.32%, #e83a58)",
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              style={{
                background: "linear-gradient(92.27deg, #9a0c2a 0.32%, #c01838)",
              }}
            />
            <Play className="relative z-[1] h-5 w-5 fill-white" />
            <span className="relative z-[1] ml-3 text-[20px] font-medium leading-none tracking-normal">
              {t("hero.ctaPrimary")}
            </span>
          </Link>

          {items.length > 1 && (
            <div className="hidden items-end gap-4 sm:flex">
              {items.map((d, i) => {
                const active = i === index;
                const thumb = d.cover[0];
                const tip = pickTitleText(locale, d.titleEn, d.titleZh, d.titleFr);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={tip}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "relative h-[88px] w-[62px] overflow-hidden rounded-xl transition-[transform,box-shadow,opacity] duration-300 ease-[var(--ease-out)] md:h-[104px] md:w-[72px]",
                      active
                        ? "origin-bottom scale-105 opacity-100 shadow-[0_8px_24px_rgba(0,0,0,0.55)] ring-2 ring-white"
                        : "opacity-70 ring-1 ring-white/20 hover:opacity-100 hover:ring-white/50",
                    )}
                  >
                    {isImg(thumb) ? (
                      <SafeImage
                        src={thumb}
                        alt={tip}
                        className="h-full w-full object-cover"
                        fallbackLabel={t("common.imageUnavailable")}
                      />
                    ) : (
                      <div
                        className="h-full w-full"
                        style={{
                          background: `linear-gradient(150deg, ${d.cover[0]}, ${d.cover[1]})`,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {items.length > 1 && (
          <div className="absolute bottom-20 left-1/2 z-20 flex -translate-x-1/2 gap-1.5 sm:hidden">
            {items.map((d, i) => (
              <button
                key={d.id}
                type="button"
                aria-label={`${pickTitleText(locale, d.titleEn, d.titleZh, d.titleFr)} · ${i + 1}`}
                onClick={() => goTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === index ? "w-5 bg-[#d22e49]" : "w-1.5 bg-white/40",
                )}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            window.scrollTo({ top: window.innerHeight - 40, behavior: "smooth" });
          }}
          className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1 text-white/45 transition-colors hover:text-white/75"
        >
          <span className="text-[12px] tracking-wide">{t("hero.scrollMore")}</span>
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </button>
      </div>
    </section>
  );
}
