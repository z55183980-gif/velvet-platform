"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { categoryName, type Drama } from "@/lib/mock-data";
import { pickContentText, type Locale } from "@/lib/languages";
import { cn } from "@/lib/utils";

function isImg(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

const AUTO_MS = 5500;

function dramaTags(drama: Drama, locale: Locale, t: (k: string) => string): string[] {
  const cat = categoryName(drama.categorySlug, locale);
  const tags = [cat];
  if (drama.isVip) tags.push(t("card.vip"));
  if (drama.freeCount > 0) tags.push(t("card.free"));
  tags.push(`${drama.episodesCount} ${t("card.episodes")}`);
  return tags.slice(0, 4);
}

export function Hero({ featured }: { featured: Drama[] }) {
  const { locale, t } = useLocale();
  const slides = useMemo(() => featured.slice(0, 5), [featured]);
  const slideKey = slides.map((s) => s.id).join("|");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);
  const touchX = useRef<number | null>(null);

  const goTo = useCallback(
    (i: number) => {
      if (slides.length === 0) return;
      setIndex((prev) => {
        const next = ((i % slides.length) + slides.length) % slides.length;
        if (next !== prev) setFadeKey((k) => k + 1);
        return next;
      });
    },
    [slides.length],
  );

  useEffect(() => {
    if (slides.length <= 1 || paused) return;
    const id = window.setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % slides.length;
        setFadeKey((k) => k + 1);
        return next;
      });
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [paused, slides.length]);

  useEffect(() => {
    setIndex(0);
    setFadeKey((k) => k + 1);
  }, [slideKey]);

  if (slides.length === 0) return null;

  const current = slides[index] ?? slides[0];
  const title = pickContentText(locale, current.titleVi, current.titleZh);
  const desc = pickContentText(locale, current.descVi, current.descZh);
  const tags = dramaTags(current, locale, t);
  const cover = current.cover[0];

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
      <div className="absolute inset-0" key={fadeKey}>
        {isImg(cover) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            className="h-full w-full object-cover object-[center_20%] opacity-0 [animation:hero-fade_0.55s_var(--ease-out)_forwards,hero-ken_16s_ease-out_forwards]"
          />
        ) : (
          <div
            className="h-full w-full animate-[hero-fade_0.55s_var(--ease-out)_both]"
            style={{
              background: `radial-gradient(ellipse 70% 60% at 60% 40%, ${current.cover[1]}88, transparent 70%), linear-gradient(150deg, ${current.cover[0]}, ${current.cover[1]})`,
            }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 38%, rgba(0,0,0,0.2) 62%, transparent 82%), linear-gradient(0deg, #000 0%, rgba(0,0,0,0.55) 18%, transparent 48%), linear-gradient(180deg, rgba(0,0,0,0.45) 0%, transparent 18%)",
          }}
        />
        <div
          className="pointer-events-none absolute right-[8%] top-[18%] h-[55%] w-[42%] rounded-full opacity-40 blur-3xl"
          style={{
            background: isImg(cover)
              ? "radial-gradient(circle, rgba(255,180,60,0.35), transparent 70%)"
              : `radial-gradient(circle, ${current.cover[1]}66, transparent 70%)`,
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1280px] flex-col px-6 pb-10 pt-24 md:px-10 md:pb-14 md:pt-28">
        <div className="flex flex-1 flex-col justify-center pb-28 md:pb-36">
          <div
            key={`copy-${fadeKey}`}
            className="max-w-[36rem] animate-[rise-in_0.55s_var(--ease-out)_both]"
          >
            <h1 className="text-[2rem] font-bold leading-[1.15] tracking-tight text-white md:text-[2.75rem] lg:text-[3.25rem]">
              {title}
            </h1>

            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-white/12 px-2.5 py-1 text-[12px] leading-none text-white/90 backdrop-blur-sm"
                >
                  {tag}
                </span>
              ))}
            </div>

            {desc ? (
              <p className="mt-4 max-w-[28rem] text-[14px] leading-relaxed text-white/72 line-clamp-2 md:text-[15px]">
                {desc}
              </p>
            ) : null}

            <div className="mt-8">
              <Link
                href={`/drama/${current.id}`}
                className="inline-flex h-12 items-center gap-2.5 rounded-full bg-brand px-8 text-[15px] font-semibold text-white shadow-[0_8px_28px_oklch(0.68_0.19_18_/_0.45)] transition-[transform,opacity,box-shadow] duration-200 hover:opacity-95 hover:shadow-[0_10px_32px_oklch(0.68_0.19_18_/_0.55)] active:translate-y-px md:h-[52px] md:px-10 md:text-base"
              >
                <Play className="h-5 w-5 fill-white" />
                {t("hero.ctaPrimary")}
              </Link>
            </div>
          </div>
        </div>

        {slides.length > 1 && (
          <div className="absolute bottom-20 right-6 z-20 hidden gap-3 sm:flex md:bottom-24 md:right-10">
            {slides.map((d, i) => {
              const active = i === index;
              const thumb = d.cover[0];
              const tip = pickContentText(locale, d.titleVi, d.titleZh);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={tip}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "relative h-[88px] w-[62px] overflow-hidden rounded-lg transition-[transform,box-shadow,opacity] duration-300 ease-[var(--ease-out)] md:h-[104px] md:w-[72px]",
                    active
                      ? "scale-110 opacity-100 shadow-[0_8px_24px_rgba(0,0,0,0.55)] ring-2 ring-white"
                      : "opacity-70 ring-1 ring-white/20 hover:opacity-100 hover:ring-white/50",
                  )}
                >
                  {isImg(thumb) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
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

        {slides.length > 1 && (
          <div className="absolute bottom-20 left-1/2 z-20 flex -translate-x-1/2 gap-1.5 sm:hidden">
            {slides.map((d, i) => (
              <button
                key={d.id}
                type="button"
                aria-label={`slide ${i + 1}`}
                onClick={() => goTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === index ? "w-5 bg-brand" : "w-1.5 bg-white/40",
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
