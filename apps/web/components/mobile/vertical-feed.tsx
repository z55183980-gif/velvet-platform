"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Flame,
  Heart,
  Play,
  Star,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { VerticalPlayer } from "@/components/mobile/vertical-player";
import { getPlayUrl, loadDramaDetail, type DramaDetailPayload } from "@/lib/api";
import type { Drama, Episode } from "@/lib/mock-data";
import { categories } from "@/lib/mock-data";
import { pickContentText } from "@/lib/languages";
import { cn, formatCredits } from "@/lib/utils";

function isUrl(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

/** Stable pseudo social counts from id (no backend metrics yet). */
function socialCounts(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return {
    favorite: 80_000 + (u % 3_200_000),
    like: 120_000 + ((u >> 3) % 4_800_000),
  };
}

function formatCount(n: number, locale: string) {
  const zhStyle = locale === "zh" || locale === "vi";
  if (zhStyle) {
    if (n >= 10_000) {
      const w = n / 10_000;
      const s = w >= 100 ? String(Math.round(w)) : w.toFixed(1).replace(/\.0$/, "");
      return `${s}万`;
    }
    return String(n);
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function formatRating(rating: number) {
  if (!rating || rating <= 0) return null;
  const score = rating <= 5 ? rating * 2 : rating;
  return score.toFixed(1);
}

type FeedEntry = {
  detail: DramaDetailPayload;
  episode: Episode | null;
};

const detailCache = new Map<string, FeedEntry>();

function pickEpisode(detail: DramaDetailPayload): Episode | null {
  return detail.episodes.find((e) => e.isFree || e.unlocked) ?? detail.episodes[0] ?? null;
}

async function ensureDetail(dramaId: string, signal?: AbortSignal): Promise<FeedEntry | null> {
  const hit = detailCache.get(dramaId);
  if (hit) return hit;
  const detail = await loadDramaDetail(dramaId, { signal });
  if (!detail) return null;
  const entry: FeedEntry = { detail, episode: pickEpisode(detail) };
  detailCache.set(dramaId, entry);
  return entry;
}

export function VerticalFeed({ dramas }: { dramas: Drama[] }) {
  const { locale, t } = useLocale();
  const { user, ready: authReady, openLogin } = useAuth();
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [liked, setLiked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchY = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(dramas.length - 1, i + delta)));
    },
    [dramas.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const drama = dramas[index] ?? null;

  useEffect(() => {
    setLiked(false);
    setFavorited(false);
    setDescOpen(false);
  }, [drama?.id]);

  // Load current + prefetch neighbors
  useEffect(() => {
    if (!drama) return;
    const ac = new AbortController();
    const cached = detailCache.get(drama.id);
    if (cached) {
      setEpisode(cached.episode);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setPlayErr(null);

    void ensureDetail(drama.id, ac.signal)
      .then((entry) => {
        if (ac.signal.aborted || !entry) return;
        setEpisode(entry.episode);
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    const prevId = dramas[index - 1]?.id;
    const nextId = dramas[index + 1]?.id;
    for (const id of [prevId, nextId]) {
      if (id && !detailCache.has(id)) {
        void ensureDetail(id).catch(() => {});
      }
    }

    return () => ac.abort();
  }, [drama?.id, index, dramas]);

  useEffect(() => {
    if (!episode || !(episode.isFree || episode.unlocked)) {
      setPlayUrl(null);
      return;
    }
    if (!authReady || !user) {
      setPlayUrl(null);
      return;
    }
    const ac = new AbortController();
    if (!playUrl) setLoading(true);
    setPlayErr(null);
    getPlayUrl(String(episode.id), { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setPlayUrl(r.playUrl);
        setLoading(false);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setPlayErr(e?.message || t("player.error"));
        setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.id, episode?.isFree, episode?.unlocked, authReady, user]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playUrl) return;

    if (!isHls(playUrl)) {
      video.src = playUrl;
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playUrl;
      return;
    }

    let cancelled = false;
    let hls: { destroy: () => void; loadSource: (u: string) => void; attachMedia: (v: HTMLVideoElement) => void } | null =
      null;
    (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled || !Hls.isSupported()) return;
        hls = new Hls();
        hls.loadSource(playUrl);
        hls.attachMedia(video);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [playUrl]);

  useEffect(() => {
    setPlayUrl(null);
  }, [drama?.id]);

  const meta = useMemo(() => {
    if (!drama) return null;
    const title = pickContentText(locale, drama.titleVi, drama.titleZh);
    const desc = pickContentText(locale, drama.descVi, drama.descZh);
    const cat = categories.find((c) => c.slug === drama.categorySlug);
    const catName = cat ? pickContentText(locale, cat.nameVi, cat.nameZh) : "";
    const counts = socialCounts(drama.id);
    const ratingLabel = formatRating(drama.rating);
    const tags: { key: string; node: ReactNode }[] = [];
    if (ratingLabel) {
      tags.push({
        key: "rating",
        node: (
          <span className="inline-flex items-center gap-0.5">
            <Star className="h-3 w-3 fill-white/90 text-white/90" />
            {t("feed.ratingScore", { n: ratingLabel })}
          </span>
        ),
      });
    }
    tags.push({ key: "season", node: t("feed.season", { n: 1 }) });
    if (catName) tags.push({ key: "cat", node: catName });
    const extraTag = (drama.tags || []).find((x) => x && x !== catName);
    if (extraTag) tags.push({ key: "tag", node: extraTag });
    const creator = drama.creator?.displayName?.trim();
    if (creator) {
      tags.push({ key: "cast", node: t("feed.actors", { names: creator }) });
    }
    return { title, desc, counts, tags: tags.slice(0, 4) };
  }, [drama, locale, t]);

  if (dramas.length === 0) {
    return (
      <div className="flex h-[calc(100dvh-3rem-3rem)] items-center justify-center text-ink-muted">
        {t("theater.empty")}
      </div>
    );
  }

  if (!drama || !meta) return null;

  const unlocked = !!(episode && (episode.isFree || episode.unlocked));
  const needsLogin = authReady && unlocked && !user;
  const locked = !!episode && !unlocked;
  const cover = isUrl(drama.cover[0]) ? drama.cover[0] : undefined;
  const hotText = meta.desc.trim() || meta.title;
  const hotPreview = hotText.length > 22 ? `${hotText.slice(0, 22)}...` : hotText;

  return (
    <div
      className="relative h-[calc(100dvh-3rem-3rem-env(safe-area-inset-bottom))] overflow-hidden bg-black"
      onTouchStart={(e) => {
        touchY.current = e.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchY.current == null) return;
        const dy = (e.changedTouches[0]?.clientY ?? touchY.current) - touchY.current;
        touchY.current = null;
        if (Math.abs(dy) < 56) return;
        go(dy < 0 ? 1 : -1);
      }}
      onWheel={(e) => {
        if (Math.abs(e.deltaY) < 40) return;
        go(e.deltaY > 0 ? 1 : -1);
      }}
    >
      <VerticalPlayer
        key={drama.id}
        videoRef={videoRef}
        active
        chrome="feed"
        src={playUrl && unlocked && user ? playUrl : null}
        poster={cover}
        autoPlay
        muted={muted}
        onMutedChange={setMuted}
        loginRequired={needsLogin}
        onLogin={() => openLogin()}
        locked={locked}
        lockLabel={
          locked && episode
            ? `${t("detail.unlockEpisode")} · ${formatCredits(episode.price, t("card.credits"))}`
            : undefined
        }
        lockActionLabel={t("feed.watch")}
        onUnlock={undefined}
        error={playErr}
        loading={loading}
        onEnded={() => go(1)}
      />

      {/* Right action column */}
      <div className="absolute bottom-[10.5rem] right-2.5 z-30 flex flex-col items-center gap-5">
        <SideAction
          label={t("feed.favorite")}
          count={formatCount(meta.counts.favorite + (favorited ? 1 : 0), locale)}
          active={favorited}
          onClick={() => {
            if (!user) {
              openLogin();
              return;
            }
            setFavorited((v) => !v);
          }}
        >
          <Star
            className={cn(
              "h-[30px] w-[30px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]",
              favorited ? "fill-[#ffb000] text-[#ffb000]" : "fill-none text-white",
            )}
            strokeWidth={1.75}
          />
        </SideAction>
        <SideAction
          label={t("feed.like")}
          count={formatCount(meta.counts.like + (liked ? 1 : 0), locale)}
          active={liked}
          onClick={() => setLiked((v) => !v)}
        >
          <Heart
            className={cn(
              "h-[30px] w-[30px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]",
              liked ? "fill-[#ff4d6d] text-[#ff4d6d]" : "fill-none text-white",
            )}
            strokeWidth={1.75}
          />
        </SideAction>
      </div>

      {/* Bottom info + CTA (above thin progress) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col px-3 pb-1 pt-16">
        <div className="pointer-events-auto max-w-[calc(100%-4.5rem)]">
          <Link
            href={`/drama/${drama.id}`}
            className="inline-flex max-w-full items-center gap-0.5 text-[17px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate">{meta.title}</span>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2.25} />
          </Link>

          {meta.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meta.tags.map((tag) => (
                <span
                  key={tag.key}
                  className="inline-flex max-w-full items-center truncate rounded-full bg-black/40 px-2 py-0.5 text-[11px] leading-4 text-white/95 backdrop-blur-[2px]"
                >
                  {tag.node}
                </span>
              ))}
            </div>
          )}

          <button
            type="button"
            className="mt-2 flex w-full items-start gap-1 text-left text-[13px] leading-5 text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
            onClick={(e) => {
              e.stopPropagation();
              setDescOpen((v) => !v);
            }}
          >
            <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" strokeWidth={2} />
            <span className="min-w-0 flex-1">
              <span>{t("feed.hotComment", { text: descOpen ? hotText : hotPreview })}</span>
              {!descOpen && hotText.length > 22 && (
                <span className="ml-1 font-medium text-white">{t("feed.expand")}</span>
              )}
            </span>
          </button>
        </div>

        <Link
          href={`/drama/${drama.id}`}
          className="pointer-events-auto mt-3 flex h-10 items-center gap-2 rounded-full bg-black/45 px-3 text-white backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-white/15">
            <Play className="ml-0.5 h-3.5 w-3.5 fill-white text-white" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
            {t("feed.watchFull", { n: drama.episodesCount })}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 opacity-80" />
        </Link>
        {/* Reserve space for feed progress thumb */}
        <div className="h-3.5 shrink-0" aria-hidden />
      </div>
    </div>
  );
}

function SideAction({
  children,
  count,
  label,
  onClick,
  active,
}: {
  children: ReactNode;
  count: string;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex w-12 flex-col items-center gap-0.5"
    >
      {children}
      <span className="text-[11px] font-medium tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
        {count}
      </span>
    </button>
  );
}
