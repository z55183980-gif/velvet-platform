"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Flame,
  Heart,
  MessageCircle,
  Star,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { VerticalPlayer } from "@/components/mobile/vertical-player";
import { useMobileFeedLock } from "@/components/mobile/mobile-feed-lock";
import { getPlayUrl, loadDramaDetail, checkFavorite, addFavorite, removeFavorite, checkLike, addLike, removeLike, reportProgress, type DramaDetailPayload } from "@/lib/api";
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

/** Fake comment counts until comments ship; favorite/like use real API counts. */
function socialCounts(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return {
    comment: 1_200 + ((u >> 5) % 48_000),
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
  const router = useRouter();
  const { user, ready: authReady, openLogin } = useAuth();
  const { setLocked } = useMobileFeedLock();
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [favorited, setFavorited] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [descOpen, setDescOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const seekingRef = useRef(false);
  /** Blocks the current gesture after scrubbing (pointerup can fire before touchend). */
  const blockSwipeGestureRef = useRef(false);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(dramas.length - 1, i + delta)));
    },
    [dramas.length],
  );

  const onSeekingChange = useCallback((seeking: boolean) => {
    seekingRef.current = seeking;
    if (seeking) {
      blockSwipeGestureRef.current = true;
      touchStart.current = null;
    }
  }, []);

  // Tell the app shell to use a fixed non-scrolling chrome layout (TikTok-style).
  useLayoutEffect(() => {
    setLocked(true);
    return () => setLocked(false);
  }, [setLocked]);

  // Pin the document so iOS can't rubber-band the visual viewport (chrome would appear to drag).
  // App shell is also a fixed non-scrolling flex column on mobile home; this is belt-and-suspenders.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
    };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.right = prev.bodyRight;
      body.style.width = prev.bodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // iOS still rubber-bands unless touchmove is canceled (passive:false).
  // Keep nested modal/drawer scroll working by skipping overflow scrollers.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const canScrollTouchTarget = (target: EventTarget | null) => {
      let node = target instanceof Element ? target : null;
      while (node && node !== document.documentElement) {
        if (node instanceof HTMLElement) {
          const style = window.getComputedStyle(node);
          const oy = style.overflowY;
          const ox = style.overflowX;
          const yScrollable =
            (oy === "auto" || oy === "scroll" || oy === "overlay") &&
            node.scrollHeight > node.clientHeight + 1;
          const xScrollable =
            (ox === "auto" || ox === "scroll" || ox === "overlay") &&
            node.scrollWidth > node.clientWidth + 1;
          if (yScrollable || xScrollable) return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (canScrollTouchTarget(e.target)) return;
      e.preventDefault();
    };

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    // Header / tab chrome sit outside the feed; block their document bounce too.
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

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
    setLikeCount(drama?.likeCount ?? 0);
    setFavorited(false);
    setFavCount(drama?.favoriteCount ?? 0);
    setDescOpen(false);
  }, [drama?.id]);

  useEffect(() => {
    if (!authReady || !drama) return;
    const dramaId = drama.numericId;
    if (!user || !dramaId || !/^\d+$/.test(dramaId)) {
      setFavorited(false);
      setLiked(false);
      return;
    }
    let alive = true;
    checkFavorite(dramaId)
      .then((r) => {
        if (alive) setFavorited(!!r?.favorited);
      })
      .catch(() => {
        if (alive) setFavorited(false);
      });
    checkLike(dramaId)
      .then((r) => {
        if (alive) setLiked(!!r?.liked);
      })
      .catch(() => {
        if (alive) setLiked(false);
      });
    return () => {
      alive = false;
    };
  }, [authReady, user, drama?.numericId, drama?.id]);

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
    if (!user || !episode?.id || !playUrl) return;
    const episodeId = String(episode.id);
    if (!/^\d+$/.test(episodeId)) return;

    let lastSent = -1;
    const flush = (force = false) => {
      const video = videoRef.current;
      if (!video) return;
      const sec = Math.floor(video.currentTime || 0);
      if (sec < 0) return;
      if (!force && lastSent >= 0 && Math.abs(sec - lastSent) < 8) return;
      lastSent = sec;
      void reportProgress(episodeId, sec).catch(() => {});
    };

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) flush();
    }, 10_000);
    const onVis = () => {
      if (document.hidden) flush(true);
    };
    document.addEventListener("visibilitychange", onVis);
    const seed = window.setTimeout(() => flush(true), 1500);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(seed);
      flush(true);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user, episode?.id, playUrl]);

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

  const toggleFavorite = async () => {
    if (!user) {
      openLogin();
      return;
    }
    const dramaId = drama?.numericId;
    if (!dramaId || !/^\d+$/.test(dramaId)) return;
    const next = !favorited;
    setFavorited(next);
    setFavCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      if (next) await addFavorite(dramaId);
      else await removeFavorite(dramaId);
    } catch {
      setFavorited(!next);
      setFavCount((c) => Math.max(0, c + (next ? -1 : 1)));
    }
  };

  const toggleLike = async () => {
    if (!user) {
      openLogin();
      return;
    }
    const dramaId = drama?.numericId;
    if (!dramaId || !/^\d+$/.test(dramaId)) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      if (next) await addLike(dramaId);
      else await removeLike(dramaId);
    } catch {
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
    }
  };

  if (dramas.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-ink-muted">
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
      ref={rootRef}
      className="relative h-full min-h-0 touch-none overflow-hidden overscroll-none bg-black"
      onTouchStart={(e) => {
        if (seekingRef.current) {
          blockSwipeGestureRef.current = true;
          touchStart.current = null;
          return;
        }
        blockSwipeGestureRef.current = false;
        const t0 = e.touches[0];
        touchStart.current =
          t0 != null ? { x: t0.clientX, y: t0.clientY } : null;
      }}
      onTouchEnd={(e) => {
        if (blockSwipeGestureRef.current || seekingRef.current) {
          blockSwipeGestureRef.current = false;
          touchStart.current = null;
          return;
        }
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const touch = e.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        // Require a clearly vertical swipe so horizontal scrub wobble won't switch videos.
        if (absY < 56 || absY < absX * 1.5) return;
        go(dy < 0 ? 1 : -1);
      }}
      onWheel={(e) => {
        e.preventDefault();
        if (seekingRef.current) return;
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
        onSeekingChange={onSeekingChange}
      />

      {/* Right action column: favorite / comment / like */}
      <div className="absolute bottom-[9.75rem] right-2.5 z-30 flex flex-col items-center gap-5">
        <SideAction
          label={t("feed.favorite")}
          count={formatCount(favCount, locale)}
          active={favorited}
          onClick={() => void toggleFavorite()}
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
          label={t("feed.comment")}
          count={formatCount(meta.counts.comment, locale)}
          onClick={() => router.push(`/drama/${drama.id}`)}
        >
          <MessageCircle
            className="h-[30px] w-[30px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
            strokeWidth={1.75}
          />
        </SideAction>
        <SideAction
          label={t("feed.like")}
          count={formatCount(likeCount, locale)}
          active={liked}
          onClick={() => void toggleLike()}
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

      {/* Bottom info stack: title → tags → hot → watch-full → seek reserve */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col px-3 pb-0">
        <div className="pointer-events-auto max-w-[calc(100%-4.75rem)]">
          <Link
            href={`/drama/${drama.id}`}
            className="inline-flex max-w-full items-center gap-0.5 text-[17px] font-semibold leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate">{meta.title}</span>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2.25} />
          </Link>

          {meta.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
              {meta.tags.map((tag, i) => (
                <span key={tag.key} className="inline-flex max-w-full items-center">
                  {i > 0 ? <span className="mr-1.5 text-white/35">·</span> : null}
                  <span className="truncate">{tag.node}</span>
                </span>
              ))}
            </div>
          )}

          <button
            type="button"
            className="mt-1.5 flex w-full items-start gap-1 text-left text-[13px] leading-5 text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
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
          className="pointer-events-auto mt-2.5 flex h-9 items-center gap-1 rounded-lg bg-black/45 px-3 text-white backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {t("feed.watchFull", { n: drama.episodesCount })}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 opacity-80" />
        </Link>
        {/* Reserve full seek hit strip so CTA never covers the scrubber */}
        <div className="h-11 shrink-0" aria-hidden />
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
