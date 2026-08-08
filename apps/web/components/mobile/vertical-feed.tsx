"use client";

import Link from "next/link";
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
  Heart,
  Pause,
  Smartphone,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth, type AuthUser } from "@/components/auth-context";
import { VerticalPlayer } from "@/components/mobile/vertical-player";
import { VerticalPager } from "@/components/mobile/vertical-pager";
import { UnlockSheet } from "@/components/unlock-sheet";
import { FeedEpisodeBar } from "@/components/mobile/feed-episode-bar";
import { useMobileFeedLock } from "@/components/mobile/mobile-feed-lock";
import { getPlayUrl, loadDramaDetail, loadFeed, checkFavorite, addFavorite, removeFavorite, checkLike, addLike, removeLike, reportProgress, type DramaDetailPayload } from "@/lib/api";
import type { Drama, Episode } from "@/lib/mock-data";
import { categories, episodeIsLandscape } from "@/lib/mock-data";
import { pickContentText, pickTitleText, type Locale } from "@/lib/languages";
import { cn, formatCredits } from "@/lib/utils";
import { useGuestWatchQuota } from "@/lib/use-guest-watch-quota";
import { useDocumentScrollLock } from "@/hooks/use-document-scroll-lock";
import {
  lockPortraitOrientation,
  unlockScreenOrientation,
} from "@/lib/screen-orientation";
import { DataErrorState } from "@/components/data-error-state";

function isUrl(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function formatCount(n: number, locale: string) {
  const zhStyle = locale === "zh";
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

type PlayUrlEntry = {
  playUrl: string;
  expiresAtMs: number;
};

/** Keep only the immediately adjacent metadata warm. */
const PREFETCH_OFFSETS = [-1, 1] as const;
const PLAY_URL_REFRESH_MS = 5 * 60_000;
const PLAY_URL_CACHE_MAX = 24;
const DETAIL_CACHE_MAX = 24;

const detailCache = new Map<string, FeedEntry>();
const playUrlCache = new Map<string, PlayUrlEntry>();
const playUrlInflight = new Map<string, Promise<string | null>>();
/** Guest / user+VIP / in-session unlocks — detail.episodes[].unlocked is auth-scoped. */
let detailCacheScope = "guest";

function feedAuthScope(user: AuthUser | null, unlockedCount: number): string {
  if (!user) return `guest:u${unlockedCount}`;
  const id = user.username || user.email || user.phone || "user";
  return `${id}:vip=${user.isVip ? 1 : 0}:u${unlockedCount}`;
}

function syncDetailCacheScope(scope: string) {
  if (scope === detailCacheScope) return;
  detailCacheScope = scope;
  detailCache.clear();
  playUrlCache.clear();
  playUrlInflight.clear();
}

function pickEpisode(detail: DramaDetailPayload): Episode | null {
  return detail.episodes.find((e) => e.isFree || e.unlocked) ?? detail.episodes[0] ?? null;
}

function isPlayableEpisode(ep: Episode | null | undefined): ep is Episode {
  return !!(ep && (ep.isFree || ep.unlocked));
}

function shouldSkipNeighborPrefetch() {
  if (typeof navigator === "undefined") return false;
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (conn?.saveData) return true;
  const type = conn?.effectiveType;
  return type === "slow-2g" || type === "2g";
}

function trimPlayUrlCache() {
  while (playUrlCache.size > PLAY_URL_CACHE_MAX) {
    const oldest = playUrlCache.keys().next().value;
    if (oldest == null) break;
    playUrlCache.delete(oldest);
  }
}

function trimDetailCache() {
  while (detailCache.size > DETAIL_CACHE_MAX) {
    const oldest = detailCache.keys().next().value;
    if (oldest == null) break;
    detailCache.delete(oldest);
  }
}

function getCachedPlayUrl(episodeId: string): string | null {
  const hit = playUrlCache.get(episodeId);
  if (!hit) return null;
  if (hit.expiresAtMs - Date.now() < PLAY_URL_REFRESH_MS) {
    playUrlCache.delete(episodeId);
    return null;
  }
  return hit.playUrl;
}

async function ensureDetail(dramaId: string, signal?: AbortSignal): Promise<FeedEntry | null> {
  const hit = detailCache.get(dramaId);
  if (hit) return hit;
  const scopeAtStart = detailCacheScope;
  const detail = await loadDramaDetail(dramaId, { signal });
  if (!detail || signal?.aborted) return null;
  // Drop stale guest/locked payload if auth scope changed mid-flight.
  if (scopeAtStart !== detailCacheScope) return null;
  const entry: FeedEntry = { detail, episode: pickEpisode(detail) };
  detailCache.set(dramaId, entry);
  trimDetailCache();
  return entry;
}

async function ensurePlayUrl(episodeId: string, signal?: AbortSignal): Promise<string | null> {
  const cached = getCachedPlayUrl(episodeId);
  if (cached) return cached;
  if (signal?.aborted) return null;

  const existing = playUrlInflight.get(episodeId);
  if (existing) {
    const url = await existing;
    if (signal?.aborted) return null;
    return url;
  }

  // No AbortSignal on the network call: one in-flight fill is shared so a swipe-in
  // can reuse a neighbor prefetch without inheriting its cancellation.
  const task = (async () => {
    try {
      const r = await getPlayUrl(episodeId);
      if (!r?.playUrl) return null;
      const expiresAtMs = Date.parse(r.expiresAt);
      playUrlCache.set(episodeId, {
        playUrl: r.playUrl,
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 60 * 60_000,
      });
      trimPlayUrlCache();
      return r.playUrl;
    } catch {
      return null;
    } finally {
      playUrlInflight.delete(episodeId);
    }
  })();

  playUrlInflight.set(episodeId, task);
  const url = await task;
  if (signal?.aborted) return null;
  return url;
}

async function prefetchNeighborPlayUrl(dramaId: string, signal?: AbortSignal) {
  if (signal?.aborted || shouldSkipNeighborPrefetch()) return;
  const entry = await ensureDetail(dramaId);
  if (signal?.aborted || !entry) return;
  if (!isPlayableEpisode(entry.episode)) return;
  await ensurePlayUrl(String(entry.episode.id), signal);
}

function buildFeedMeta(
  drama: Drama,
  locale: Locale,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  const title = pickTitleText(locale, drama.titleEn, drama.titleZh, drama.titleFr);
  const cat = categories.find((c) => c.slug === drama.categorySlug);
  const catName = cat ? pickContentText(locale, cat.nameEn, cat.nameZh) : "";
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
  return { title, tags: tags.slice(0, 4) };
}

const FEED_PAGE_SIZE = 20;
const FEED_PIN_HOTTEST = 3;
const FEED_LOAD_MORE_THRESHOLD = 4;
const HOME_FEED_MUTED_KEY = "velvet_home_feed_muted";

type HomeFeedSnapshot = {
  dramas: Drama[];
  index: number;
  muted: boolean;
  page: number;
  hasMore: boolean;
};

/** Preserve the home feed while a client-side watch route is open. */
let homeFeedSnapshot: HomeFeedSnapshot | null = null;

export function VerticalFeed({
  dramas: dramasProp,
  source,
}: {
  dramas?: Drama[];
  /** When "home", load GET /dramas/feed with paging (ops pin + 7d heat). */
  source?: "home";
}) {
  const { t } = useLocale();
  const { user, unlocked } = useAuth();
  const authScope = feedAuthScope(user, unlocked.size);
  const { setLocked } = useMobileFeedLock();
  const restoredHomeFeed = source === "home" ? homeFeedSnapshot : null;
  const [index, setIndex] = useState(() =>
    restoredHomeFeed
      ? Math.min(restoredHomeFeed.index, Math.max(0, restoredHomeFeed.dramas.length - 1))
      : 0,
  );
  // Browser autoplay policies require the first feed item to begin muted.
  const [muted, setMuted] = useState(true);
  const [restoreSound, setRestoreSound] = useState(false);
  const [pagerBlocked, setPagerBlocked] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const togglePlayRef = useRef<(() => void) | null>(null);

  const [dramas, setDramas] = useState<Drama[]>(() =>
    restoredHomeFeed?.dramas ?? dramasProp ?? [],
  );
  const [bootLoading, setBootLoading] = useState(
    source === "home" && !restoredHomeFeed && !(dramasProp && dramasProp.length),
  );
  const [page, setPage] = useState(() => restoredHomeFeed?.page ?? 1);
  const [hasMore, setHasMore] = useState(() =>
    restoredHomeFeed?.hasMore ?? source === "home",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const loadMoreLock = useRef(false);
  const shouldRestoreHomeFeed = !!(restoredHomeFeed && restoredHomeFeed.dramas.length > 0);

  useEffect(() => {
    try {
      setRestoreSound(localStorage.getItem(HOME_FEED_MUTED_KEY) === "0");
    } catch {
      setRestoreSound(false);
    }
  }, []);

  const handleMutedChange = useCallback((next: boolean) => {
    setMuted(next);
    setRestoreSound(!next);
    try {
      localStorage.setItem(HOME_FEED_MUTED_KEY, next ? "1" : "0");
    } catch {
      /* Storage can be unavailable in private/restricted contexts. */
    }
  }, []);

  useEffect(() => {
    if (source === "home") return;
    setDramas(dramasProp ?? []);
  }, [dramasProp, source]);

  useEffect(() => {
    if (source !== "home") return;
    if (shouldRestoreHomeFeed) return;
    const ac = new AbortController();
    setBootLoading(true);
    setLoadError(false);
    void loadFeed(1, FEED_PAGE_SIZE, { pinHottest: FEED_PIN_HOTTEST, signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setDramas(r.rows);
        setPage(r.page);
        setHasMore(r.hasMore);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setDramas([]);
        setHasMore(false);
        setLoadError(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setBootLoading(false);
      });
    return () => ac.abort();
  }, [source, shouldRestoreHomeFeed, reloadKey]);

  useEffect(() => {
    if (source !== "home" || dramas.length === 0) return;
    homeFeedSnapshot = { dramas, index, muted, page, hasMore };
  }, [source, dramas, index, muted, page, hasMore]);

  const loadMore = useCallback(async () => {
    if (source !== "home" || !hasMore || loadMoreLock.current) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const r = await loadFeed(nextPage, FEED_PAGE_SIZE, { pinHottest: FEED_PIN_HOTTEST });
      setDramas((prev) => {
        const seen = new Set(prev.map((d) => d.id));
        const appended = r.rows.filter((d) => !seen.has(d.id));
        return appended.length ? [...prev, ...appended] : prev;
      });
      setPage(r.page);
      setHasMore(r.hasMore);
    } catch {
      /* keep current list; user can scroll again later */
    } finally {
      setLoadingMore(false);
      loadMoreLock.current = false;
    }
  }, [source, hasMore, page]);

  useEffect(() => {
    if (source !== "home") return;
    if (dramas.length === 0) return;
    if (index >= dramas.length - FEED_LOAD_MORE_THRESHOLD) {
      void loadMore();
    }
  }, [index, dramas.length, source, loadMore]);

  const onIndexChange = useCallback((next: number) => {
    setIndex(next);
  }, []);

  const onSeekingChange = useCallback((seeking: boolean) => {
    setPagerBlocked(seeking);
  }, []);

  const onFeedTap = useCallback(() => {
    togglePlayRef.current?.();
  }, []);

  const registerTogglePlay = useCallback((fn: (() => void) | null) => {
    togglePlayRef.current = fn;
  }, []);

  // Tell the app shell to use a fixed non-scrolling chrome layout (TikTok-style).
  useLayoutEffect(() => {
    setLocked(true);
    return () => setLocked(false);
  }, [setLocked]);

  // Pin the document so iOS can't rubber-band the visual viewport (chrome would appear to drag).
  useDocumentScrollLock(true);

  // Keep adjacent metadata warm, but never pre-download HLS manifests or media segments.
  useEffect(() => {
    syncDetailCacheScope(authScope);
    const drama = dramas[index];
    if (!drama) return;
    for (const offset of PREFETCH_OFFSETS) {
      const id = dramas[index + offset]?.id;
      if (id && !detailCache.has(id)) void ensureDetail(id).catch(() => {});
    }
  }, [index, dramas, authScope]);

  // Resolve only the next play URL. The inactive player must not attach media until swiped active.
  useEffect(() => {
    syncDetailCacheScope(authScope);
    const ac = new AbortController();

    const run = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const next = dramas[index + 1];
      if (next) await prefetchNeighborPlayUrl(next.id, ac.signal);
    };

    void run();
    const onVis = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ac.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [index, dramas, authScope]);

  if (bootLoading && dramas.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-ink-muted">…</div>
    );
  }

  if (dramas.length === 0) {
    if (loadError) {
      return (
        <div className="flex h-full min-h-0 items-center justify-center px-5">
          <DataErrorState compact onRetry={() => setReloadKey((key) => key + 1)} />
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-ink-muted">
        {t("theater.empty")}
      </div>
    );
  }

  return (
    <div ref={shellRef} className="relative h-full min-h-0">
      <VerticalPager
        index={index}
        count={dramas.length}
        onChange={onIndexChange}
        blocked={pagerBlocked}
        onTap={onFeedTap}
      >
        {({ pageIndex, active }) => {
          const drama = dramas[pageIndex];
          if (!drama) return null;
          return (
            <FeedPage
              drama={drama}
              active={active}
              muted={muted}
              onMutedChange={handleMutedChange}
              restoreSound={restoreSound}
              onSeekingChange={onSeekingChange}
              registerTogglePlay={registerTogglePlay}
            />
          );
        }}
      </VerticalPager>
      {loadingMore ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-40 flex justify-center">
          <span className="rounded-full bg-black/45 px-3 py-1 text-[11px] text-white/90">…</span>
        </div>
      ) : null}
    </div>
  );
}

function FeedPage({
  drama,
  active,
  muted,
  onMutedChange,
  restoreSound,
  onSeekingChange,
  registerTogglePlay,
}: {
  drama: Drama;
  active: boolean;
  muted: boolean;
  onMutedChange: (m: boolean) => void;
  restoreSound: boolean;
  onSeekingChange: (seeking: boolean) => void;
  registerTogglePlay: (fn: (() => void) | null) => void;
}) {
  const { locale, t } = useLocale();
  const { user, unlocked, ready: authReady, openLogin, unlock } = useAuth();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const authScope = feedAuthScope(user, unlocked.size);
  const { ready: guestReady, canWatch: canGuestWatch, markWatched: markGuestWatched } =
    useGuestWatchQuota();
  const [episode, setEpisode] = useState<Episode | null>(
    () => detailCache.get(drama.id)?.episode ?? null,
  );
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!detailCache.has(drama.id));
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(drama.likeCount ?? 0);
  const [favorited, setFavorited] = useState(false);
  const [favCount, setFavCount] = useState(drama.favoriteCount ?? 0);
  const [landscape, setLandscape] = useState(false);
  /** Home feed only: sticky center Pause after user tap-to-pause (not scroll-away auto-pause). */
  const [userPaused, setUserPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !restoreSound || !playUrl || !video) return;
    const restore = () => {
      if (!video.muted) return;
      video.muted = false;
      onMutedChange(false);
    };
    video.addEventListener("playing", restore, { once: true });
    if (!video.paused && video.readyState >= 2) restore();
    return () => video.removeEventListener("playing", restore);
  }, [active, restoreSound, playUrl, onMutedChange]);

  const meta = useMemo(() => buildFeedMeta(drama, locale, t), [drama, locale, t]);

  useEffect(() => {
    setLandscape(false);
    setUserPaused(false);
  }, [drama.id]);

  useEffect(() => {
    if (!active) setUserPaused(false);
  }, [active]);

  const handleVideoAspectChange = useCallback((isLandscape: boolean) => {
    setLandscape(isLandscape);
  }, []);

  const enterLandscapePlayback = useCallback(async () => {
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitDisplayingFullscreen?: boolean;
          webkitRequestFullscreen?: () => Promise<void> | void;
        })
      | null;
    const appleTouchDevice =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!video) return;
    if (appleTouchDevice && video.webkitEnterFullscreen) {
      try {
        video.webkitEnterFullscreen();
        if (video.webkitDisplayingFullscreen !== false) return true;
      } catch {
        /* Continue to the standard fullscreen attempt. */
      }
    }

    try {
      const request =
        video.requestFullscreen?.bind(video) || video.webkitRequestFullscreen?.bind(video);
      await request?.();
      const fullscreen = !!(
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element | null })
          .webkitFullscreenElement
      );
      if (fullscreen) return true;
    } catch {
      /* Stay in portrait-locked feed; the explicit button remains available. */
    }
    void lockPortraitOrientation();
    return false;
  }, []);

  useEffect(() => {
    if (!active) return;
    if (landscape) unlockScreenOrientation();
    else void lockPortraitOrientation();
  }, [active, landscape]);

  useEffect(() => {
    if (!active || !landscape) return;
    const orientation = window.matchMedia("(orientation: landscape)");
    let entering = false;
    const openFullscreenPlayer = () => {
      if (!orientation.matches || entering) return;
      entering = true;
      void enterLandscapePlayback().finally(() => {
        entering = false;
      });
    };
    void openFullscreenPlayer();
    const onChange = () => {
      if (orientation.matches) void openFullscreenPlayer();
      else unlockScreenOrientation();
    };
    orientation.addEventListener("change", onChange);
    return () => orientation.removeEventListener("change", onChange);
  }, [active, landscape, enterLandscapePlayback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video || !landscape) return;
    const restorePortrait = () => void lockPortraitOrientation();
    video.addEventListener("webkitendfullscreen", restorePortrait);
    return () => video.removeEventListener("webkitendfullscreen", restorePortrait);
  }, [active, landscape]);

  useEffect(() => {
    setLiked(false);
    setLikeCount(drama.likeCount ?? 0);
    setFavorited(false);
    setFavCount(drama.favoriteCount ?? 0);
  }, [drama.id, drama.likeCount, drama.favoriteCount]);

  useEffect(() => {
    if (!authReady) return;
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
  }, [authReady, user, drama.numericId, drama.id]);

  useEffect(() => {
    syncDetailCacheScope(authScope);
    const ac = new AbortController();
    const cached = detailCache.get(drama.id);
    if (cached) {
      setEpisode(cached.episode);
      const knownLandscape = episodeIsLandscape(cached.episode);
      if (knownLandscape != null) setLandscape(knownLandscape);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setPlayErr(null);

    void ensureDetail(drama.id, ac.signal)
      .then((entry) => {
        if (ac.signal.aborted || !entry) return;
        setEpisode(entry.episode);
        const knownLandscape = episodeIsLandscape(entry.episode);
        if (knownLandscape != null) setLandscape(knownLandscape);
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [drama.id, authScope]);

  useEffect(() => {
    if (!isPlayableEpisode(episode)) {
      setPlayUrl(null);
      return;
    }
    if (!authReady || !guestReady) {
      setPlayUrl(null);
      return;
    }
    const episodeId = String(episode.id);
    const allowed = !!(user || canGuestWatch(episodeId));
    if (!allowed) {
      setPlayUrl(null);
      setLoading(false);
      setPlayErr(null);
      return;
    }

    // Guests only resolve URL on the active page so peeking won't burn quota.
    if (!user && !active) {
      const cachedOnly = getCachedPlayUrl(episodeId);
      setPlayUrl(cachedOnly);
      return;
    }

    const cached = getCachedPlayUrl(episodeId);
    if (cached) {
      setPlayUrl(cached);
      setLoading(false);
      setPlayErr(null);
      if (active && !user) markGuestWatched(episodeId);
      return;
    }

    const ac = new AbortController();
    if (active) setLoading(true);
    setPlayErr(null);
    void ensurePlayUrl(episodeId, ac.signal)
      .then((url) => {
        if (ac.signal.aborted) return;
        if (!url) {
          if (active) setPlayErr(t("player.error"));
          setLoading(false);
          return;
        }
        setPlayUrl(url);
        setLoading(false);
        if (active && !user) markGuestWatched(episodeId);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (active) setPlayErr(e?.message || t("player.error"));
        setLoading(false);
      });
    return () => ac.abort();
  }, [
    episode,
    authReady,
    guestReady,
    user,
    active,
    canGuestWatch,
    markGuestWatched,
    t,
  ]);

  useEffect(() => {
    if (!active || !user || !episode?.id || !playUrl) return;
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
  }, [active, user, episode?.id, playUrl]);

  const episodeUnlocked = !!(episode && (episode.isFree || episode.unlocked));
  const episodeId = episode?.id ? String(episode.id) : "";
  const guestAllowed =
    !!episodeUnlocked && !user && guestReady && !!episodeId && canGuestWatch(episodeId);
  const canPlay = episodeUnlocked && !!(user || guestAllowed);
  const needsLogin = authReady && guestReady && episodeUnlocked && !user && !guestAllowed;
  const locked = !!episode && !episodeUnlocked;
  const cover = isUrl(drama.cover[0]) ? drama.cover[0] : undefined;

  function openUnlockGate() {
    if (!authReady) return;
    if (!user) {
      openLogin();
      return;
    }
    setUnlockOpen(true);
  }

  async function handleUnlockConfirm(ep: Episode) {
    if (ep.id == null) return { ok: false, alreadyUnlocked: false, error: "missing_id" };
    const r = await unlock(ep.id);
    if (r.ok) {
      setEpisode((prev) => (prev ? { ...prev, unlocked: true } : prev));
    }
    return r;
  }

  useEffect(() => {
    if (!active) return;
    registerTogglePlay(() => {
      const v = videoRef.current;
      if (!v || !playUrl || !canPlay || locked || needsLogin) return;
      if (v.paused) {
        setUserPaused(false);
        void v.play().catch(() => {});
      } else {
        v.pause();
        setUserPaused(true);
      }
    });
    return () => registerTogglePlay(null);
  }, [active, playUrl, canPlay, locked, needsLogin, registerTogglePlay]);

  const toggleFavorite = async () => {
    if (!user) {
      openLogin();
      return;
    }
    const dramaId = drama.numericId;
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
    const dramaId = drama.numericId;
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

  const toggleMuted = () => {
    const next = !muted;
    const video = videoRef.current;
    if (video) {
      // Apply this inside the click gesture so mobile browsers allow audio immediately.
      video.muted = next;
      if (!next && video.volume === 0) video.volume = 1;
      if (!next && video.paused && playUrl && canPlay && !locked && !needsLogin) {
        void video.play().catch(() => undefined);
      }
    }
    onMutedChange(next);
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-base">
      <VerticalPlayer
          videoRef={videoRef}
          active={active}
          chrome="feed"
          objectFit={landscape ? "contain" : "cover"}
          src={playUrl && canPlay ? playUrl : null}
          poster={cover}
          autoPlay={active}
          muted={muted}
          onMutedChange={onMutedChange}
          onVideoAspectChange={handleVideoAspectChange}
          loginRequired={active && needsLogin}
          onLogin={() => openLogin("login")}
          onRegister={() => openLogin("register")}
          locked={locked}
          lockLabel={
            locked && episode
              ? `${t("detail.unlockEpisode")} · ${formatCredits(episode.price, t("card.credits"))}`
              : undefined
          }
          lockActionLabel={t("feed.watch")}
          onUnlock={locked ? openUnlockGate : undefined}
          error={active ? playErr : null}
          loading={active && loading}
          showSeek={false}
          tapToToggle={false}
      />

      {landscape && active ? (
        <button
          type="button"
          onClick={() => void enterLandscapePlayback()}
          className="absolute left-1/2 top-[calc(50%+min(30vw,8rem))] z-35 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#2a2c2c]/88 px-4 py-2 text-[13px] font-medium text-white/95 backdrop-blur-sm"
        >
          <Smartphone className="h-4 w-4 rotate-90" strokeWidth={1.75} />
          {t("player.watchFullscreen")}
        </button>
      ) : null}

      {/* Tap-to-pause affordance on home feed only (sticky until tap-to-play). */}
      {userPaused && active ? (
        <div
          className="pointer-events-none absolute inset-0 z-[15] flex items-center justify-center"
          aria-hidden
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Pause className="h-7 w-7 fill-white text-white" strokeWidth={1.5} />
          </div>
        </div>
      ) : null}

      {/* Bottom chrome sits on the video; tab is a flex sibling below the stage (decoupled). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col">
        <div className="relative flex flex-col">
          <div className="pointer-events-auto absolute bottom-full right-2.5 mb-2 flex flex-col items-center gap-5">
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
            <SideAction
              label={muted ? t("player.unmute") : t("player.mute")}
              count={muted ? t("player.unmute") : t("player.mute")}
              active={muted}
              onClick={toggleMuted}
            >
              {muted ? (
                <VolumeX
                  className="h-[30px] w-[30px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
                  strokeWidth={1.75}
                />
              ) : (
                <Volume2
                  className="h-[30px] w-[30px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
                  strokeWidth={1.75}
                />
              )}
            </SideAction>
          </div>

          <div className="pointer-events-auto max-w-[calc(100%-4.75rem)] px-3">
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
          </div>

          <FeedEpisodeBar
            className="pointer-events-auto mt-1.5"
            href={`/drama/${drama.id}/play`}
            label={t("feed.watchFull", { n: drama.episodesCount })}
            videoRef={videoRef}
            mediaKey={playUrl}
            seekEnabled={active && !!playUrl && canPlay && !locked && !needsLogin && !playErr}
            onSeekingChange={active ? onSeekingChange : undefined}
          />
        </div>
      </div>

      <UnlockSheet
        open={unlockOpen}
        episode={episode}
        onClose={() => setUnlockOpen(false)}
        onConfirmed={handleUnlockConfirm}
        vipActive={!!user?.isVip}
      />
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
