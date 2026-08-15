"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Flame,
  Heart,
  Maximize,
  Minimize2,
  MoreVertical,
  Share2,
  Smartphone,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { EpisodeList } from "@/components/episode-list";
import { UnlockSheet } from "@/components/unlock-sheet";
import { VideoPlayer } from "@/components/video-player";
import {
  PLAYER_RATES,
  VerticalPlayer,
  preloadHlsJs,
} from "@/components/mobile/vertical-player";
import { VerticalPager } from "@/components/mobile/vertical-pager";
import { EpisodeDrawer } from "@/components/mobile/episode-drawer";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
  loadDramaDetail,
  loadHome,
  getPlayUrl,
  getWatchHistory,
  reportProgress,
  checkFavorite,
  addFavorite,
  removeFavorite,
  checkLike,
  addLike,
  removeLike,
  unlockDrama,
} from "@/lib/api";
import { guestNeedsLoginForEpisode } from "@/lib/episode-membership";
import { episodeIsLandscape, type Drama, type Episode } from "@/lib/mock-data";
import { pickTagText, toPublicDramaTagObjects, toPublicDramaTags } from "@/lib/drama-tags";
import { useGuestWatchQuota } from "@/lib/use-guest-watch-quota";
import { canGoBackInApp } from "@/lib/nav-history";
import { pickContentText, pickTitleText } from "@/lib/languages";
import { WatchSeekBar } from "@/components/mobile/watch-seek-bar";
import { mediaUrl, cn } from "@/lib/utils";
import { DramaCard } from "@/components/drama-card";
import {
  lockPortraitOrientation,
  unlockScreenOrientation,
} from "@/lib/screen-orientation";
import { SafeImage } from "@/components/safe-image";
import { DataErrorState } from "@/components/data-error-state";

function isUrl(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

function releaseVideoSource(video: HTMLVideoElement) {
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    /* ignore media teardown failures */
  }
}

const PLAY_URL_REFRESH_MS = 5 * 60_000;
/** Start next-episode media warm once current playback crosses this ratio. */
const NEXT_WARM_PROGRESS = 0.2;

type PlayUrlCacheEntry = {
  playUrl: string;
  expiresAtMs: number;
  previewOnly: boolean;
  previewSeconds: number;
};

type BoundPlaySource = {
  authCacheKey: string;
  episodeId: string;
  entry: PlayUrlCacheEntry;
};

function shouldSkipWatchWarmNetwork() {
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

function findNextUnlockedEpisode(
  episodes: Episode[],
  selected: Episode,
  unlocked: (ep: Episode) => boolean,
): Episode | null {
  const idx = episodes.findIndex((e) => e.no === selected.no);
  if (idx < 0) return null;
  for (let i = idx + 1; i < episodes.length; i++) {
    const ep = episodes[i];
    if (ep && unlocked(ep)) return ep;
  }
  return null;
}

function formatCount(n: number, locale: string) {
  const value = Math.max(0, Math.floor(Number(n) || 0));
  if (locale === "zh") {
    if (value >= 10_000) {
      const w = value / 10_000;
      const s = w >= 100 ? String(Math.round(w)) : w.toFixed(1).replace(/\.0$/, "");
      return `${s}万`;
    }
    return String(value);
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    const s = k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "");
    return `${s}K`;
  }
  return String(value);
}

/** Approximate “heat” from available engagement signals (no dedicated heat field). */
function dramaHeat(d: Drama) {
  const likes = d.likeCount ?? 0;
  const favs = d.favoriteCount ?? 0;
  const base = Math.round((d.rating || 0) * 12_000) + (d.episodesCount || 0) * 800;
  return Math.max(base, likes * 1_200 + favs * 3_500 + base);
}

function fmtLandTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function LandVideoTime({
  videoRef,
  kind,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  kind: "current" | "duration";
}) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tick = () => {
      setValue(
        kind === "duration"
          ? Number.isFinite(v.duration) && v.duration > 0
            ? v.duration
            : 0
          : v.currentTime || 0,
      );
    };
    tick();
    v.addEventListener("timeupdate", tick);
    v.addEventListener("durationchange", tick);
    v.addEventListener("loadedmetadata", tick);
    return () => {
      v.removeEventListener("timeupdate", tick);
      v.removeEventListener("durationchange", tick);
      v.removeEventListener("loadedmetadata", tick);
    };
  }, [videoRef, kind]);
  return <span className="shrink-0 text-[12px] tabular-nums text-white/90">{fmtLandTime(value)}</span>;
}

const PLAY_GRAD =
  "linear-gradient(92.27deg, #ff7e0d 0.32%, #ff9233)";
const PLAY_GRAD_HOVER =
  "linear-gradient(92.27deg, #ed6f00 0.32%, #eb862f)";

export function DramaDetail({
  id,
  autoLandscapeFs = false,
  autoStartWatch = false,
  initialEpisodeNo,
}: {
  id: string;
  /** Feed「全屏观看」入口：进播放后自动触发 CSS 横屏沉浸 */
  autoLandscapeFs?: boolean;
  /** `/drama/[id]/play` — open watch immediately (Hongguo direct-play entry) */
  autoStartWatch?: boolean;
  /** Optional episode from `/play?ep=` */
  initialEpisodeNo?: number;
}) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const { user, openLogin, unlock, refreshWallet, ready: authReady, sessionEpoch } = useAuth();
  const { ready: guestReady, canWatch: canGuestWatch, markWatched: markGuestWatched } = useGuestWatchQuota();
  const { mobile: isMobile, ready: mobileReady } = useIsMobile();
  /** Bound signed play URLs to account + session epoch — guest/B must not reuse A's paid URL. */
  const authCacheKey = `${
    user?.id || user?.email || user?.phone || user?.username || user?.label || (authReady ? "guest" : "pending")
  }:e${sessionEpoch}`;
  const [pendingLandscapeFs, setPendingLandscapeFs] = useState(autoLandscapeFs);
  const pendingLandscapeFsRef = useRef(autoLandscapeFs);
  pendingLandscapeFsRef.current = pendingLandscapeFs;
  const [data, setData] = useState<{
    drama: Drama;
    episodes: Episode[];
    buyoutCredits?: string | null;
    vipActive?: boolean;
    dramaUnlocked?: boolean;
  } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unlockedNos, setUnlockedNos] = useState<Set<number>>(new Set());
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<Episode | null>(null);
  const [selected, setSelected] = useState<Episode | null>(null);
  const [playSource, setPlaySource] = useState<BoundPlaySource | null>(null);
  const selectedEpisodeId = selected?.id != null ? String(selected.id) : "";
  // Never expose a signed URL to a player rendered for another episode. This
  // closes the selected->effect gap that otherwise attaches the previous media.
  const activePlaySource =
    playSource?.authCacheKey === authCacheKey &&
    playSource.episodeId === selectedEpisodeId
      ? playSource
      : null;
  const playUrl = activePlaySource?.entry.playUrl ?? null;
  const previewLimit = activePlaySource?.entry.previewOnly
    ? activePlaySource.entry.previewSeconds
    : 0;
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [resumeHint, setResumeHint] = useState<{ epNo: number; progressSec: number } | null>(null);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [watching, setWatching] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [related, setRelated] = useState<Drama[]>([]);
  const [favorited, setFavorited] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [rate, setRate] = useState(1);
  const [showRate, setShowRate] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [epLineExpanded, setEpLineExpanded] = useState(false);
  /**
   * 移动端：横片源自动 16:9 信箱；竖片源竖屏铺满。
   * Feed「全屏观看」带 ?lfs=1 时先按横片布局，避免元数据检出前误走竖屏 cover。
   */
  const [landscapeMode, setLandscapeMode] = useState(!!autoLandscapeFs);
  const [followVideoAspect, setFollowVideoAspect] = useState(true);
  const [browserFs, setBrowserFs] = useState(false);
  /** CSS 沉浸层：不依赖 iOS 原生 video fullscreen，切集时保持外层 UI。 */
  const [uiImmersive, setUiImmersive] = useState(false);
  /** 设备仍为竖屏时，将 CSS 沉浸层顺时针旋转为横屏。 */
  const [rotateFs, setRotateFs] = useState(false);
  /** 红果横屏全屏：操作条显隐（点击画面切换，不暂停） */
  const [landChromeVisible, setLandChromeVisible] = useState(true);
  const [screenIsLandscape, setScreenIsLandscape] = useState(false);
  const [screenOrientationReady, setScreenOrientationReady] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [qualities, setQualities] = useState<Array<{ index: number; height: number; label: string }>>([]);
  const [qualityIndex, setQualityIndex] = useState(-1); // -1 = auto
  const [showQuality, setShowQuality] = useState(false);
  const [resumeToast, setResumeToast] = useState(false);
  const [pagerBlocked, setPagerBlocked] = useState(false);
  const [visualViewportRect, setVisualViewportRect] = useState<{
    width: number;
    height: number;
    offsetLeft: number;
    offsetTop: number;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const watchShellRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<any>(null);
  const playbackSelectionChangedRef = useRef(false);
  const resumeApplied = useRef(false);
  /** Avoid putting seekTo in the HLS setup effect deps (rebuilds player). */
  const seekToRef = useRef(seekTo);
  seekToRef.current = seekTo;
  const landscapeModeRef = useRef(landscapeMode);
  landscapeModeRef.current = landscapeMode;
  const previousLandscapeModeRef = useRef(landscapeMode);
  /** CSS landscape immersion is independent from transient WebKit fullscreen events. */
  const landscapeImmersiveIntentRef = useRef(false);
  const browserFsRef = useRef(browserFs);
  /** Do not immediately re-enter while the user exits with the phone still landscape. */
  const suppressLandscapeAutoEnterRef = useRef(false);
  /** Avoid putting t in the HLS setup effect deps (locale switch would rebuild player). */
  const tRef = useRef(t);
  tRef.current = t;

  const playUrlCacheRef = useRef(new Map<string, PlayUrlCacheEntry>());
  const playUrlInflightRef = useRef(new Map<string, Promise<PlayUrlCacheEntry>>());
  const warmNextRef = useRef<{ episodeId: string; destroy: () => void } | null>(null);
  const nextWarmArmedRef = useRef(false);
  const playCacheKey = useCallback(
    (episodeId: string) => `${authCacheKey}:${episodeId}`,
    [authCacheKey],
  );

  const readCachedPlayUrl = useCallback(
    (episodeId: string): PlayUrlCacheEntry | null => {
      const key = playCacheKey(episodeId);
      const hit = playUrlCacheRef.current.get(key);
      if (!hit) return null;
      if (hit.expiresAtMs - Date.now() < PLAY_URL_REFRESH_MS) {
        playUrlCacheRef.current.delete(key);
        return null;
      }
      return hit;
    },
    [playCacheKey],
  );

  const writeCachedPlayUrl = useCallback(
    (episodeId: string, r: {
      playUrl: string;
      expiresAt: string;
      previewOnly?: boolean;
      previewSeconds?: number;
    }): PlayUrlCacheEntry => {
      const expiresAtMs = Date.parse(r.expiresAt);
      const entry: PlayUrlCacheEntry = {
        playUrl: r.playUrl,
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 60 * 60_000,
        previewOnly: !!r.previewOnly,
        previewSeconds: r.previewSeconds || 0,
      };
      playUrlCacheRef.current.set(playCacheKey(episodeId), entry);
      return entry;
    },
    [playCacheKey],
  );

  const ensureCachedPlayUrl = useCallback(
    async (episodeId: string, signal?: AbortSignal): Promise<PlayUrlCacheEntry | null> => {
      const cached = readCachedPlayUrl(episodeId);
      if (cached) return cached;
      if (signal?.aborted) return null;

      const inflightKey = playCacheKey(episodeId);
      const existing = playUrlInflightRef.current.get(inflightKey);
      if (existing) {
        const entry = await existing;
        if (signal?.aborted) return null;
        return entry;
      }

      const task = (async () => {
        try {
          const r = await getPlayUrl(episodeId);
          if (!r?.playUrl) throw new Error("Missing play URL");
          return writeCachedPlayUrl(episodeId, r);
        } finally {
          playUrlInflightRef.current.delete(inflightKey);
        }
      })();

      playUrlInflightRef.current.set(inflightKey, task);
      const entry = await task;
      if (signal?.aborted) return null;
      return entry;
    },
    [playCacheKey, readCachedPlayUrl, writeCachedPlayUrl],
  );

  /**
   * Switch the logical episode and its already-cached source in one render so
   * the stable watch media element never observes a new episode with an old URL.
   */
  const switchPlaybackEpisode = useCallback(
    (episode: Episode) => {
      const episodeId = episode.id != null ? String(episode.id) : "";
      if (!episodeId || episodeId === selectedEpisodeId) return;

      const cached = readCachedPlayUrl(episodeId);
      setPlaySource(
        cached ? { authCacheKey, episodeId, entry: cached } : null,
      );
      setPlayErr(null);
      setSeekTo(null);
      setResumeHint(null);
      setResumeToast(false);
      resumeApplied.current = true;
      playbackSelectionChangedRef.current = true;
      setSelected(episode);
    },
    [authCacheKey, readCachedPlayUrl, selectedEpisodeId],
  );

  // Account switch: drop signed URLs + warm player + playback state bound to prior principal.
  useEffect(() => {
    playUrlCacheRef.current.clear();
    playUrlInflightRef.current.clear();
    warmNextRef.current?.destroy();
    warmNextRef.current = null;
    setPlaySource(null);
    setPlayErr(null);
    setWatching(false);
  }, [authCacheKey]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setWatching(false);
    setDescExpanded(false);
    setRelated([]);
    setNotFound(false);
    setLoadError(false);
    setData(null);
    setFavorited(false);
    setFavCount(0);
    setLiked(false);
    setLikeCount(0);
    setUnlockedNos(new Set());
    setSelected(null);
    setPlaySource(null);
    setSeekTo(null);
    setResumeHint(null);
    resumeApplied.current = false;
    playbackSelectionChangedRef.current = false;
    loadDramaDetail(id, { signal: ac.signal })
      .then((d) => {
        if (ac.signal.aborted) return;
        if (d) {
          setData(d);
          setFavCount(d.drama.favoriteCount ?? 0);
          setLikeCount(d.drama.likeCount ?? 0);
          const nos = new Set(d.episodes.filter((e) => e.isFree || e.unlocked).map((e) => e.no));
          setUnlockedNos(nos);
          setSelected(null);
        } else setNotFound(true);
      })
      .catch((error: unknown) => {
        if (ac.signal.aborted) return;
        const status = typeof error === "object" && error && "status" in error
          ? Number((error as { status?: number }).status)
          : 0;
        if (status === 404) setNotFound(true);
        else setLoadError(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [id, reloadKey, authCacheKey]);

  useEffect(() => {
    if (!data || selected) return;
    const unlocked = (e: Episode) =>
      e.isFree ||
      !!e.unlocked ||
      unlockedNos.has(e.no) ||
      !!data.vipActive ||
      !!data.dramaUnlocked ||
      !!user?.isVip;
    if (initialEpisodeNo != null) {
      const fromQuery = data.episodes.find((e) => e.no === initialEpisodeNo);
      if (fromQuery && unlocked(fromQuery)) {
        setSelected(fromQuery);
        return;
      }
    }
    const pick = data.episodes.find((e) => unlocked(e)) ?? null;
    setSelected(pick);
  }, [data, selected, unlockedNos, user?.isVip, initialEpisodeNo]);

  useEffect(() => {
    setEpLineExpanded(false);
    setShowRate(false);
    setShowMore(false);
    setShowQuality(false);
    setFollowVideoAspect(true);
    // Prefer persisted media metadata; runtime video dimensions remain the fallback.
    const knownLandscape = episodeIsLandscape(selected);
    // Keep the surrounding immersive shell alive while the previous episode
    // was already in landscape mode.
    const keepLandscapePlayback = landscapeModeRef.current;
    const nextLandscape = knownLandscape ?? (keepLandscapePlayback || pendingLandscapeFsRef.current);
    setLandscapeMode(nextLandscape);
    if (!nextLandscape || !keepLandscapePlayback) {
      if (!nextLandscape) landscapeImmersiveIntentRef.current = false;
      setUiImmersive(false);
      setRotateFs(false);
    }
    setQualityIndex(-1);
    setQualities([]);
  }, [selected]);

  useEffect(() => {
    if (!watching) {
      landscapeImmersiveIntentRef.current = false;
      browserFsRef.current = false;
      if (!pendingLandscapeFsRef.current) {
        setLandscapeMode(false);
        setRotateFs(false);
      }
      setBrowserFs(false);
      setUiImmersive(false);
      setShowQuality(false);
      setResumeToast(false);
    }
  }, [watching]);

  /** Kill iOS Safari / theme grey peeking below the fixed watch shell. */
  useEffect(() => {
    if (!watching || !isMobile) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.backgroundColor;
    const prevBody = body.style.backgroundColor;
    html.style.backgroundColor = "#000";
    body.style.backgroundColor = "#000";
    return () => {
      html.style.backgroundColor = prevHtml;
      body.style.backgroundColor = prevBody;
    };
  }, [watching, isMobile]);

  useEffect(() => {
    if (!watching) return;
    if (resumeHint && resumeHint.progressSec > 5 && selected?.no === resumeHint.epNo) {
      setResumeToast(true);
      const timer = window.setTimeout(() => setResumeToast(false), 5200);
      return () => window.clearTimeout(timer);
    }
    setResumeToast(false);
  }, [watching, resumeHint, selected?.no]);

  useEffect(() => {
    const onFs = () => {
      const wasBrowserFs = browserFsRef.current;
      const fs = !!(
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element | null })
          .webkitFullscreenElement
      );
      browserFsRef.current = fs;
      setBrowserFs(fs);
      // iOS can emit WebKit fullscreen state changes while the device rotates.
      // Only tear down UI that actually came from a browser-fullscreen session;
      // a CSS landscape session must survive these transient events.
      if (!fs && wasBrowserFs && !landscapeImmersiveIntentRef.current) {
        setRotateFs(false);
        setUiImmersive(false);
      }
    };
    onFs();
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  useEffect(() => {
    if (!user || !data || playbackSelectionChangedRef.current) return;
    let alive = true;
    resumeApplied.current = false;
    getWatchHistory(1, data.drama.numericId || data.drama.id)
      .then((r) => {
        if (!alive || playbackSelectionChangedRef.current) return;
        const row = r?.rows?.[0];
        if (!row?.episode?.episodeNumber) return;
        const epNo = row.episode.episodeNumber as number;
        const progressSec = Number(row.progressSec || 0);
        setResumeHint({ epNo, progressSec });
        const ep = data.episodes.find((e) => e.no === epNo);
        if (ep && (ep.isFree || ep.unlocked || unlockedNos.has(ep.no))) {
          setSelected(ep);
          if (progressSec > 5) setSeekTo(progressSec);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, data, unlockedNos]);

  useEffect(() => {
    if (!authReady) return;
    const dramaId = data?.drama.numericId;
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
  }, [authReady, user, data?.drama.numericId]);

  const isUnlocked = useCallback(
    (ep: Episode) =>
      ep.isFree ||
      !!ep.unlocked ||
      unlockedNos.has(ep.no) ||
      !!data?.vipActive ||
      !!data?.dramaUnlocked ||
      !!user?.isVip,
    [data?.dramaUnlocked, data?.vipActive, unlockedNos, user?.isVip],
  );
  const selectedTrialAvailable = !!(selected && !isUnlocked(selected) && (selected.previewSeconds || 0) > 0);
  const playerReady = !!(selected && (isUnlocked(selected) || selectedTrialAvailable));
  const playbackAllowed = !!(
    user ||
    selectedTrialAvailable ||
    (selectedEpisodeId && canGuestWatch(selectedEpisodeId))
  );
  const lockActionLabel =
    selected && !selected.isFree && !isUnlocked(selected) ? t("vip.open") : undefined;

  /** Desktop: open theater on /drama/[id]. Mobile: only via /play (autoStartWatch). */
  useEffect(() => {
    if (!mobileReady || loading || !data) return;
    if (autoStartWatch || !isMobile) setWatching(true);
  }, [mobileReady, loading, data, autoStartWatch, isMobile]);

  useEffect(() => {
    // Start downloading the HLS runtime during detail hydration so playback
    // does not serialize script loading after the signed URL arrives.
    void preloadHlsJs();
  }, []);

  useEffect(() => {
    if (!playerReady || !selected?.id) {
      setPlaySource(null);
      setPlayErr(null);
      return;
    }
    if (!authReady || !guestReady) {
      setPlaySource(null);
      setPlayErr(null);
      return;
    }
    const episodeId = String(selected.id);
    const allowed = !!(user || selectedTrialAvailable || canGuestWatch(episodeId));
    if (!allowed) {
      setPlaySource(null);
      setPlayErr(null);
      return;
    }

    const cached = readCachedPlayUrl(episodeId);
    if (cached) {
      setPlaySource({ authCacheKey, episodeId, entry: cached });
      setPlayErr(null);
      if (!user) markGuestWatched(episodeId);
      return;
    }

    const ac = new AbortController();
    setPlaySource(null);
    setPlayErr(null);
    ensureCachedPlayUrl(episodeId, ac.signal)
      .then((entry) => {
        if (ac.signal.aborted) return;
        if (!entry) {
          setPlayErr(t("player.error"));
          return;
        }
        setPlaySource({ authCacheKey, episodeId, entry });
        if (!user) markGuestWatched(episodeId);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        // Never paint raw API/ops messages (e.g. yt-dlp) on the player.
        if (e?.status === 401) setPlayErr(t("errors.loginRequired"));
        else setPlayErr(t("player.error"));
      });
    return () => ac.abort();
  }, [
    playerReady,
    selected?.id,
    selectedTrialAvailable,
    user,
    authReady,
    guestReady,
    canGuestWatch,
    markGuestWatched,
    t,
    authCacheKey,
    readCachedPlayUrl,
    ensureCachedPlayUrl,
  ]);
  // Prefetch next unlocked episode's signed URL (no guest quota burn).
  useEffect(() => {
    if (!watching || !selected || !data || !authReady || !guestReady) return;
    if (shouldSkipWatchWarmNetwork()) return;
    const next = findNextUnlockedEpisode(data.episodes, selected, isUnlocked);
    if (!next?.id) return;
    const episodeId = String(next.id);
    if (!user && !canGuestWatch(episodeId)) return;
    if (readCachedPlayUrl(episodeId)) return;
    const ac = new AbortController();
    void ensureCachedPlayUrl(episodeId, ac.signal).catch(() => {});
    return () => ac.abort();
  }, [
    watching,
    selected,
    data,
    authReady,
    guestReady,
    user,
    canGuestWatch,
    isUnlocked,
    readCachedPlayUrl,
    ensureCachedPlayUrl,
  ]);

  // Tear down / hand off next-episode media warm when the current selection changes.
  useEffect(() => {
    nextWarmArmedRef.current = false;
    const warm = warmNextRef.current;
    if (!warm) return;
    const selectedId = selected?.id != null ? String(selected.id) : null;
    if (selectedId && warm.episodeId === selectedId) {
      // Keep warm briefly so fragment HTTP cache can overlap with main attach.
      const timer = window.setTimeout(() => {
        if (warmNextRef.current?.episodeId === selectedId) {
          warmNextRef.current.destroy();
        }
      }, 8_000);
      return () => window.clearTimeout(timer);
    }
    warm.destroy();
    return undefined;
  }, [selected?.id]);

  useEffect(() => {
    return () => {
      warmNextRef.current?.destroy();
      warmNextRef.current = null;
    };
  }, []);

  // At 20% progress, warm the next episode's first few seconds (paused / short buffer).
  useEffect(() => {
    if (!watching || !playUrl || !selected || !data) return;
    const video = videoRef.current;
    if (!video) return;

    const warmPrincipal = authCacheKey;
    const warmNext = async () => {
      if (shouldSkipWatchWarmNetwork()) return;
      const next = findNextUnlockedEpisode(data.episodes, selected, isUnlocked);
      if (!next?.id) return;
      const episodeId = String(next.id);
      if (!user && !canGuestWatch(episodeId)) return;
      if (warmNextRef.current?.episodeId === episodeId) return;

      warmNextRef.current?.destroy();
      warmNextRef.current = null;

      const entry = await ensureCachedPlayUrl(episodeId);
      // Account switch while awaiting: never attach prior principal's signed URL.
      if (warmPrincipal !== authCacheKey) return;
      if (!entry?.playUrl || entry.previewOnly) return;
      // Ref.current is mutated across await; avoid TS control-flow narrowing to null.
      const alreadyWarm = warmNextRef.current as {
        episodeId: string;
        destroy: () => void;
      } | null;
      if (alreadyWarm?.episodeId === episodeId) return;

      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0";
      document.body.appendChild(el);

      let hls: { destroy: () => void } | null = null;
      let destroyed = false;
      const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        try {
          hls?.destroy();
        } catch {
          /* ignore */
        }
        try {
          el.removeAttribute("src");
          el.load();
          el.remove();
        } catch {
          /* ignore */
        }
        if (warmNextRef.current?.episodeId === episodeId) {
          warmNextRef.current = null;
        }
      };

      warmNextRef.current = { episodeId, destroy };

      const url = entry.playUrl;
      if (!isHls(url)) {
        el.src = url;
        return;
      }
      if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = url;
        return;
      }

      try {
        const mod = await preloadHlsJs();
        if (destroyed || warmPrincipal !== authCacheKey || !mod) {
          destroy();
          return;
        }
        const Hls = mod.default;
        if (!Hls.isSupported()) {
          destroy();
          return;
        }
        const instance = new Hls({
          enableWorker: true,
          maxBufferLength: 3,
          maxMaxBufferLength: 4,
          backBufferLength: 0,
          startFragPrefetch: true,
          capLevelToPlayerSize: true,
        });
        if (destroyed || warmPrincipal !== authCacheKey) {
          instance.destroy();
          return;
        }
        hls = instance;
        instance.loadSource(url);
        instance.attachMedia(el);
      } catch {
        destroy();
      }
    };

    const onTime = () => {
      if (nextWarmArmedRef.current) return;
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (video.currentTime / duration < NEXT_WARM_PROGRESS) return;
      nextWarmArmedRef.current = true;
      void warmNext().catch(() => {});
    };

    video.addEventListener("timeupdate", onTime);
    onTime();
    return () => video.removeEventListener("timeupdate", onTime);
  }, [
    watching,
    playUrl,
    selected,
    data,
    user,
    canGuestWatch,
    isUnlocked,
    ensureCachedPlayUrl,
    authCacheKey,
  ]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || previewLimit <= 0 || !selected || isUnlocked(selected)) return;
    const onTimeUpdate = () => {
      if (video.currentTime < previewLimit) return;
      video.pause();
      video.currentTime = previewLimit;
      if (!authReady) return;
      // Guests → login; logged-in non-VIP → unlock sheet.
      if (!user) {
        openLogin();
        return;
      }
      setUnlockTarget(selected);
      setUnlockOpen(true);
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [playUrl, previewLimit, selected, isUnlocked, authReady, user, openLogin]);

  useEffect(() => {
    if (!data?.drama.id) return;
    const ac = new AbortController();
    const primaryTag = toPublicDramaTags(data.drama.tags)[0];
    loadHome(1, 12, {
      tag: primaryTag || undefined,
      sort: "hot",
      signal: ac.signal,
    })
      .then((r) => {
        if (ac.signal.aborted) return;
        setRelated((r.rows || []).filter((d) => d.id !== data.drama.id).slice(0, 8));
      })
      .catch(() => {
        if (!ac.signal.aborted) setRelated([]);
      });
    return () => ac.abort();
  }, [data?.drama.id, data?.drama.tags]);

  // Report watch progress so Me history + resume keep working
  useEffect(() => {
    if (!user || !selected?.id || !playUrl || !watching) return;
    const episodeId = String(selected.id);
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
  }, [user, selected?.id, playUrl, watching]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(orientation: landscape)");
    const apply = () => {
      if (!mq.matches) suppressLandscapeAutoEnterRef.current = false;
      setScreenIsLandscape(mq.matches);
      setScreenOrientationReady(true);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isMobile || !watching || (!uiImmersive && !rotateFs)) return;
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      bodyTouchAction: body.style.touchAction,
    };
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    body.style.touchAction = "none";
    return () => {
      root.style.overflow = previous.rootOverflow;
      root.style.overscrollBehavior = previous.rootOverscroll;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      body.style.touchAction = previous.bodyTouchAction;
    };
  }, [isMobile, watching, uiImmersive, rotateFs]);

  useEffect(() => {
    if (!mobileReady || !isMobile) return;
    if (watching && landscapeMode) unlockScreenOrientation();
    else void lockPortraitOrientation();
  }, [mobileReady, isMobile, watching, landscapeMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    const apply = () => {
      setVisualViewportRect({
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
        offsetLeft: viewport?.offsetLeft ?? 0,
        offsetTop: viewport?.offsetTop ?? 0,
      });
    };
    apply();
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !watching) return;
    const sync = () => setVideoPlaying(!v.paused);
    sync();
    v.addEventListener("play", sync);
    v.addEventListener("pause", sync);
    return () => {
      v.removeEventListener("play", sync);
      v.removeEventListener("pause", sync);
    };
  }, [watching, playUrl, landscapeMode, rotateFs]);

  useEffect(() => {
    const landscapeImmersive = landscapeMode && (rotateFs || browserFs || uiImmersive);
    const controlsInUse = pagerBlocked || showRate || showMore || showQuality || drawerOpen;
    if (!landscapeImmersive || !landChromeVisible || controlsInUse) return;
    const timer = window.setTimeout(() => setLandChromeVisible(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [
    landscapeMode,
    rotateFs,
    browserFs,
    uiImmersive,
    landChromeVisible,
    pagerBlocked,
    showRate,
    showMore,
    showQuality,
    drawerOpen,
  ]);

  const enterLandscapeImmersive = useCallback(() => {
    landscapeImmersiveIntentRef.current = true;
    suppressLandscapeAutoEnterRef.current = false;
    setShowRate(false);
    setShowMore(false);
    setShowQuality(false);
    setLandChromeVisible(true);
    // Keep playback inline and make the stable outer shell fill the visual viewport.
    // This avoids iOS replacing our UI with the native video player and allows the
    // same immersive shell to survive src/episode changes.
    unlockScreenOrientation();
    const nowLand = window.matchMedia("(orientation: landscape)").matches;
    setScreenIsLandscape(nowLand);
    setRotateFs(!nowLand);
    setUiImmersive(true);
  }, []);

  const exitImmersiveFs = useCallback(async () => {
    landscapeImmersiveIntentRef.current = false;
    suppressLandscapeAutoEnterRef.current = window.matchMedia("(orientation: landscape)").matches;
    setUiImmersive(false);
    setRotateFs(false);
    setLandChromeVisible(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
    try {
      const video = videoRef.current as
        | (HTMLVideoElement & {
            webkitDisplayingFullscreen?: boolean;
            webkitExitFullscreen?: () => void;
          })
        | null;
      if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen?.();
    } catch {
      /* ignore */
    }
    try {
      const orient = screen.orientation as ScreenOrientation & { unlock?: () => void };
      orient.unlock?.();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const wasLandscape = previousLandscapeModeRef.current;
    previousLandscapeModeRef.current = landscapeMode;
    if (!watching || !isMobile || !wasLandscape || landscapeMode) return;
    void exitImmersiveFs().finally(() => {
      void lockPortraitOrientation();
    });
  }, [watching, isMobile, landscapeMode, exitImmersiveFs]);

  // The routed entry may run without user activation; CSS immersion does not need it.
  useEffect(() => {
    if (!pendingLandscapeFs || !watching || !isMobile) return;
    if (!landscapeMode || !playUrl) return;
    const episodeId = selected?.id ? String(selected.id) : "";
    const allowed = !!(
      user ||
      selectedTrialAvailable ||
      (episodeId && canGuestWatch(episodeId))
    );
    if (!playerReady || !allowed) return;
    setPendingLandscapeFs(false);
    void enterLandscapeImmersive();
  }, [
    pendingLandscapeFs,
    watching,
    isMobile,
    landscapeMode,
    playUrl,
    playerReady,
    selected?.id,
    selectedTrialAvailable,
    user,
    canGuestWatch,
    enterLandscapeImmersive,
  ]);

  useEffect(() => {
    if (!screenOrientationReady || !watching || !isMobile || !landscapeMode) return;
    if (uiImmersive || rotateFs) {
      setUiImmersive(true);
      setRotateFs(!screenIsLandscape);
      return;
    }
    if (screenIsLandscape && !suppressLandscapeAutoEnterRef.current) {
      void enterLandscapeImmersive();
    }
  }, [
    screenOrientationReady,
    screenIsLandscape,
    watching,
    isMobile,
    landscapeMode,
    uiImmersive,
    rotateFs,
    enterLandscapeImmersive,
  ]);

  const applyResumeSeek = (video: HTMLVideoElement) => {
    const target = seekToRef.current;
    if (target == null || target <= 5 || resumeApplied.current) return;
    try {
      video.currentTime = target;
      resumeApplied.current = true;
    } catch {
      /* ignore */
    }
  };

  const handleVideoAspectChange = useCallback(
    (isLand: boolean) => {
      // Intrinsic media dimensions do not change when the phone rotates. Ignore
      // transient false reports while a CSS landscape session is active.
      if (landscapeImmersiveIntentRef.current && !isLand) return;
      if (!followVideoAspect || isLand === landscapeModeRef.current) return;
      setLandscapeMode(isLand);
    },
    [followVideoAspect],
  );

  // Resume seek without tearing down HLS/native media.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playUrl || !playerReady || !watching) return;
    if (seekTo == null || seekTo <= 5 || resumeApplied.current) return;
    const onMeta = () => applyResumeSeek(video);
    video.addEventListener("loadedmetadata", onMeta);
    if (video.readyState >= 1) applyResumeSeek(video);
    return () => video.removeEventListener("loadedmetadata", onMeta);
  }, [seekTo, playUrl, playerReady, watching, landscapeMode]);

  // HLS attach + quality levels. VerticalPlayer observes the currently mounted
  // media element so aspect detection survives async HLS attach.
  // Do not depend on landscapeMode/seekTo/t — those would destroy+recreate and restart playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playUrl || !playerReady || !watching || !playbackAllowed) return;

    const onMeta = () => {
      applyResumeSeek(video);
    };
    video.addEventListener("loadedmetadata", onMeta);

    const dropMediaListeners = () => {
      video.removeEventListener("loadedmetadata", onMeta);
    };

    const teardownDirectMedia = () => {
      dropMediaListeners();
      releaseVideoSource(video);
    };

    if (!isHls(playUrl)) {
      video.src = playUrl;
      setQualities([]);
      hlsRef.current = null;
      return teardownDirectMedia;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playUrl;
      setQualities([]);
      hlsRef.current = null;
      return teardownDirectMedia;
    }
    let hls: any;
    let cancelled = false;
    let attachedMedia: HTMLVideoElement | null = null;
    (async () => {
      try {
        const mod = await preloadHlsJs();
        if (!mod) return;
        const Hls = mod.default;
        if (cancelled || !Hls.isSupported()) {
          if (!cancelled) setPlayErr(tRef.current("player.hlsUnsupported"));
          return;
        }
        // Bind this HLS instance to the exact media captured by this effect so
        // a late callback can never attach to a newer episode's element.
        const media = video;
        attachedMedia = media;
        hls = new Hls({
          enableWorker: true,
          capLevelToPlayerSize: true,
          startFragPrefetch: true,
          maxBufferLength: 12,
          maxMaxBufferLength: 24,
          backBufferLength: 12,
        });
        hlsRef.current = hls;
        hls.loadSource(playUrl);
        hls.attachMedia(media);
        let networkRecoveries = 0;
        let mediaRecoveries = 0;
        hls.on(Hls.Events.ERROR, (_event: unknown, detail: { fatal?: boolean; type?: string }) => {
          if (cancelled || !detail?.fatal) return;
          if (detail.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) {
            networkRecoveries += 1;
            window.setTimeout(() => {
              if (!cancelled) hls.startLoad(-1);
            }, 250 * networkRecoveries);
            return;
          }
          if (detail.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            mediaRecoveries += 1;
            hls.recoverMediaError();
            return;
          }
          setPlayErr(tRef.current("player.hlsLoadFailed"));
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          const levels = (hls.levels || []) as Array<{ height?: number }>;
          const mapped = levels
            .map((lv, index) => {
              const height = Number(lv.height || 0);
              return { index, height, label: height > 0 ? `${height}P` : `L${index + 1}` };
            })
            .filter((x) => x.height > 0)
            .sort((a, b) => b.height - a.height);
          setQualities(mapped);
          setQualityIndex(-1);
          hls.currentLevel = -1;
          void media.play().catch(() => {});
        });
      } catch {
        if (!cancelled) setPlayErr(tRef.current("player.hlsLoadFailed"));
      }
    })();
    return () => {
      cancelled = true;
      dropMediaListeners();
      if (hls) hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
      releaseVideoSource(attachedMedia ?? video);
    };
  }, [
    playUrl,
    selectedEpisodeId,
    playerReady,
    watching,
    playbackAllowed,
  ]);

  const selectEpisodeByIndex = useCallback(
    (i: number) => {
      const ep = data?.episodes[i];
      if (ep) switchPlaybackEpisode(ep);
    },
    [data?.episodes, switchPlaybackEpisode],
  );

  const onSeekingChange = useCallback((seeking: boolean) => {
    setPagerBlocked(seeking);
  }, []);

  if (!mobileReady) {
    return <div className="min-h-[40vh]" aria-busy="true" />;
  }

  if (loading) {
    if (isMobile) {
      return (
        <div
          className="fixed inset-0 z-[70]"
          style={{ background: autoStartWatch ? "#000" : "#1c1c1c" }}
          aria-busy="true"
        />
      );
    }
    return (
      <div className="fixed inset-0 z-[70] bg-[#181a1a]" aria-busy="true">
        <div className="flex h-14 items-center border-b border-white/[0.06] px-5">
          <div className="h-5 w-40 animate-pulse rounded bg-white/[0.06]" />
        </div>
        <div className="flex h-[calc(100%-3.5rem)]">
          <div className="flex flex-1 items-center justify-center bg-black">
            <div className="aspect-[9/16] h-[min(100%,calc(100vh-3.5rem))] max-h-full animate-pulse rounded-sm bg-white/[0.04]" />
          </div>
          <div className="hidden w-[420px] shrink-0 border-l border-white/[0.06] bg-[#121212] p-5 lg:block">
            <div className="mb-4 h-3 w-48 animate-pulse rounded bg-white/[0.06]" />
            <div className="mb-3 h-6 w-3/4 animate-pulse rounded bg-white/[0.06]" />
            <div className="mb-6 h-16 w-full animate-pulse rounded bg-white/[0.06]" />
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-md bg-white/[0.06]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 md:px-6">
        <DataErrorState onRetry={() => setReloadKey((key) => key + 1)} />
      </div>
    );
  }
  if (notFound || !data) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-24 text-center text-h3 text-ink-muted md:px-6">
        {t("errors.notFoundDrama")}
      </div>
    );
  }

  const { drama } = data;
  const title = pickTitleText(locale, drama.titleEn, drama.titleZh, drama.titleFr);
  const desc = pickContentText(locale, drama.descEn, drama.descZh);
  const displayTags = toPublicDramaTagObjects(drama.tags);
  const coverIsImg = isUrl(drama.cover[0]);
  const favoriteDramaId = drama.numericId || drama.id;

  const toggleFavorite = async () => {
    if (!user) {
      openLogin();
      return;
    }
    if (!/^\d+$/.test(String(favoriteDramaId))) return;
    const next = !favorited;
    setFavorited(next);
    setFavCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      if (next) await addFavorite(favoriteDramaId);
      else await removeFavorite(favoriteDramaId);
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
    if (!/^\d+$/.test(String(favoriteDramaId))) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      if (next) await addLike(favoriteDramaId);
      else await removeLike(favoriteDramaId);
    } catch {
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
    }
  };

  /** Locked episode tap → login (guest) or unlock sheet (logged-in non-VIP). */
  function openUnlockGate(ep?: Episode) {
    if (!authReady) return;
    setDrawerOpen(false);
    if (!user) {
      openLogin();
      return;
    }
    setUnlockTarget(ep ?? selected ?? null);
    setUnlockOpen(true);
  }

  async function handleUnlockConfirm(ep: Episode) {
    if (ep.id == null) return { ok: false, alreadyUnlocked: false, error: "missing_id" };
    const r = await unlock(ep.id);
    if (r.ok) {
      setUnlockedNos((prev) => {
        const next = new Set(prev);
        next.add(ep.no);
        return next;
      });
    }
    return r;
  }

  async function handleBuyDrama() {
    const dramaId = data?.drama.numericId || id;
    if (!dramaId) return { ok: false, error: "missing_id" };
    try {
      const r = await unlockDrama(dramaId);
      setData((prev) => (prev ? { ...prev, dramaUnlocked: true } : prev));
      setUnlockedNos(new Set((data?.episodes ?? []).map((ep) => ep.no)));
      await refreshWallet();
      return { ok: true, alreadyUnlocked: !!r?.alreadyUnlocked };
    } catch (e: any) {
      return {
        ok: false,
        error: e?.message || "fail",
        code: typeof e?.status === "number" ? e.status : undefined,
      };
    }
  }

  const buyoutCreditsNum = (() => {
    const raw = data?.buyoutCredits ?? data?.drama.buyoutCredits;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const unlockSheetEl = (
    <UnlockSheet
      open={unlockOpen}
      episode={unlockTarget}
      onClose={() => setUnlockOpen(false)}
      onConfirmed={handleUnlockConfirm}
      buyoutCredits={data?.dramaUnlocked ? null : buyoutCreditsNum}
      onBuyDrama={data?.dramaUnlocked ? undefined : handleBuyDrama}
      vipActive={!!user?.isVip}
    />
  );

  function onWatchFree() {
    const f =
      data!.episodes.find((e) => isUnlocked(e)) ?? data!.episodes[0];
    if (f) {
      if (isUnlocked(f)) switchPlaybackEpisode(f);
      else {
        openUnlockGate(f);
        return;
      }
    }
    if (isMobile) {
      const epQ = f ? `?ep=${f.no}` : "";
      router.push(`/drama/${id}/play${epQ}`);
      return;
    }
    setWatching(true);
  }

  function playNext() {
    if (!selected || !data) return;
    const idx = data.episodes.findIndex((e) => e.no === selected.no);
    const next = idx >= 0 ? data.episodes[idx + 1] : undefined;
    if (!next) return;
    // Immediate next — guests hitting member-priced must open login (not skip / no-op).
    if (guestNeedsLoginForEpisode(next, { user, isUnlocked: isUnlocked(next) })) {
      openUnlockGate(next);
      return;
    }
    if (isUnlocked(next) || (next.previewSeconds || 0) > 0) {
      switchPlaybackEpisode(next);
      return;
    }
    openUnlockGate(next);
  }

  const hasNext = (() => {
    if (!selected || !data) return false;
    const idx = data.episodes.findIndex((e) => e.no === selected.no);
    return idx >= 0 && idx + 1 < data.episodes.length;
  })();

  // session 未就绪时不要误显示「请登录」（V3-01）
  const needsLogin = authReady && guestReady && playerReady && !user && !selectedTrialAvailable && !(selected?.id && canGuestWatch(String(selected.id)));
  const guestAllowed = !user && guestReady && playerReady && (selectedTrialAvailable || (!!selected?.id && canGuestWatch(String(selected.id))));
  const canPlay = playerReady && !!(user || guestAllowed);
  const locked = !playerReady;
  const playLoading = !authReady || !guestReady || (canPlay && !playUrl && !playErr);

  const selectEpisode = (ep: Episode) => {
    if (guestNeedsLoginForEpisode(ep, { user, isUnlocked: isUnlocked(ep) })) {
      openUnlockGate(ep);
      return;
    }
    if (isUnlocked(ep) || (ep.previewSeconds || 0) > 0) {
      switchPlaybackEpisode(ep);
      setDrawerOpen(false);
      if (isMobile && !autoStartWatch && !watching) {
        router.push(`/drama/${id}/play?ep=${ep.no}`);
        return;
      }
      setWatching(true);
    } else openUnlockGate(ep);
  };

  const tags = displayTags.slice(0, 4);
  // The desktop playback sidebar follows ReelShort's denser tag treatment.
  // Keep the browse/detail surfaces at four tags, while allowing the player
  // metadata block to show the first six labels (as in the reference UI).
  const theaterTags = displayTags.slice(0, 6);

  /* ---- Watching: mobile vertical ---- */
  if (watching && isMobile) {
    const epTitle = selected
      ? pickTitleText(locale, selected.titleEn, selected.titleZh, selected.titleFr)
      : "";
    // Prefer drama synopsis for the meta line (Hongguo); skip bare EP01-style titles.
    const epBody =
      epTitle && !/^ep\s*\d+$/i.test(epTitle.trim()) ? epTitle : desc || epTitle || "";
    const epLine = selected
      ? `${t("detail.episodeLabel", { n: selected.no })}${epBody ? ` | ${epBody}` : ""}`
      : desc;
    const epPreview = epLine.length > 32 ? `${epLine.slice(0, 32)}...` : epLine;

    /** 竖屏沉浸：隐藏浏览器栏，不 lock、不 rotate */
    const enterPortraitFullscreen = async () => {
      setShowRate(false);
      setShowMore(false);
      setShowQuality(false);
      setRotateFs(false);
      setUiImmersive(true);
      const el = watchShellRef.current;
      try {
        if (el?.requestFullscreen && !document.fullscreenElement) {
          await el.requestFullscreen();
        }
      } catch {
        /* ignore — uiImmersive 已生效 */
      }
    };

    const applyQuality = (index: number) => {
      setQualityIndex(index);
      const hls = hlsRef.current;
      if (hls) {
        try {
          hls.currentLevel = index;
        } catch {
          /* ignore */
        }
      }
      setShowQuality(false);
      setShowMore(false);
    };

    const landscapeImmersive =
      landscapeMode && (rotateFs || browserFs || uiImmersive);
    // 选集底栏+进度：竖屏路径保留；横屏沉浸改用下方操作条
    const showWatchBottomChrome = !landscapeImmersive;
    // 标题/侧栏：竖屏 Maximize / 清 meta
    const showWatchMetaChrome = showWatchBottomChrome && !uiImmersive;
    const showLandFsChrome = landscapeImmersive && landChromeVisible;
    const landscapeControlWidth = visualViewportRect
      ? rotateFs
        ? visualViewportRect.height
        : visualViewportRect.width
      : Number.POSITIVE_INFINITY;
    const resumeTimeLabel = resumeHint
      ? `${Math.floor(resumeHint.progressSec / 60)}:${String(Math.floor(resumeHint.progressSec % 60)).padStart(2, "0")}`
      : "";
    const episodeIndex = selected
      ? Math.max(
          0,
          data.episodes.findIndex((e) => e.no === selected.no),
        )
      : 0;
    const pagerMenusOpen = showRate || showMore || showQuality || drawerOpen;

    return (
      <div
        ref={watchShellRef}
        className={cn(
          rotateFs || (uiImmersive && !browserFs)
            ? "fixed z-[70] overflow-hidden bg-black"
            : cn("fixed inset-0 z-[70]", landscapeMode ? "bg-[#181a1a]" : "bg-black"),
        )}
        style={
          rotateFs
            ? {
                width: visualViewportRect ? `${visualViewportRect.height}px` : "100dvh",
                height: visualViewportRect ? `${visualViewportRect.width}px` : "100dvw",
                top: visualViewportRect
                  ? `${visualViewportRect.offsetTop + visualViewportRect.height / 2}px`
                  : "50%",
                left: visualViewportRect
                  ? `${visualViewportRect.offsetLeft + visualViewportRect.width / 2}px`
                  : "50%",
                transform: "translate(-50%, -50%) rotate(90deg)",
              }
            : uiImmersive && !browserFs && visualViewportRect
              ? {
                  width: `${visualViewportRect.width}px`,
                  height: `${visualViewportRect.height}px`,
                  top: `${visualViewportRect.offsetTop}px`,
                  left: `${visualViewportRect.offsetLeft}px`,
                }
            : undefined
        }
      >
        {/* Top chrome — 竖屏常态（贴近红果）；横屏 CSS 沉浸见下方操作条 */}
        {!landscapeImmersive ? (
        <div className="absolute left-0 right-0 top-0 z-40 flex items-center justify-between bg-gradient-to-b from-black/55 via-black/20 to-transparent px-3 pb-4 pt-[max(0.35rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => {
              void exitImmersiveFs();
              if (autoStartWatch) {
                if (canGoBackInApp()) router.back();
                else router.push(`/drama/${id}`);
                return;
              }
              setWatching(false);
            }}
            className="inline-flex min-h-11 items-center gap-0.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
            aria-label={t("common.back")}
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
            <span className="text-[15px] font-medium tracking-[0.01em]">
              {selected ? t("detail.episodeLabel", { n: selected.no }) : title}
            </span>
          </button>

          <div className="relative flex items-center gap-0">
            <button
              type="button"
              onClick={() => {
                setShowMore(false);
                setShowQuality(false);
                setShowRate((v) => !v);
              }}
              className="inline-flex min-h-11 items-center gap-1 px-2.5 py-2 text-[13px] text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
            >
              <Clock3 className="h-4 w-4" strokeWidth={1.9} />
              {t("player.speed")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowRate(false);
                setShowQuality(false);
                setShowMore((v) => !v);
              }}
              className="grid h-11 w-11 place-items-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
              aria-label={t("player.more")}
            >
              <MoreVertical className="h-5 w-5" strokeWidth={1.9} />
            </button>

            {showRate && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[92px] overflow-hidden rounded-xl bg-[#2a2c2c]/96 py-1 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
                {PLAYER_RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRate(r);
                      setShowRate(false);
                    }}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-center px-3 py-2.5 text-[13px]",
                      r === rate ? "font-semibold text-[#ff7e0d]" : "text-white/85",
                    )}
                  >
                    {r === 1 ? t("player.speedNormal") : `${r}x`}
                  </button>
                ))}
              </div>
            )}
            {showMore && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[132px] overflow-hidden rounded-xl bg-[#2a2c2c]/96 py-1 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => {
                    setMuted((m) => !m);
                    setShowMore(false);
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-[13px] text-white/85"
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  {muted ? t("player.unmute") : t("player.mute")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMore(false);
                    setShowQuality(true);
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-[13px] text-white/85"
                >
                  {t("player.quality")}
                  <span className="ml-auto text-white/45">
                    {qualityIndex < 0
                      ? t("player.qualityAuto")
                      : qualities.find((q) => q.index === qualityIndex)?.label || t("player.qualityAuto")}
                  </span>
                </button>
              </div>
            )}
            {showQuality && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] overflow-hidden rounded-xl bg-[#2a2c2c]/96 py-1 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => applyQuality(-1)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-center px-3 py-2.5 text-[13px]",
                    qualityIndex < 0 ? "font-semibold text-[#ff7e0d]" : "text-white/85",
                  )}
                >
                  {t("player.qualityAuto")}
                </button>
                {qualities.map((q) => (
                  <button
                    key={q.index}
                    type="button"
                    onClick={() => applyQuality(q.index)}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-center px-3 py-2.5 text-[13px]",
                      qualityIndex === q.index ? "font-semibold text-[#ff7e0d]" : "text-white/85",
                    )}
                  >
                    {q.label}
                  </button>
                ))}
                {qualities.length === 0 ? (
                  <p className="px-3 py-2 text-center text-[11px] text-white/40">{t("player.qualitySingle")}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
        ) : showLandFsChrome ? (
          <div
            className="absolute left-0 right-0 top-0 z-50 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/30 to-transparent pb-4"
            style={{
              paddingTop: rotateFs
                ? "max(0.35rem, env(safe-area-inset-right))"
                : "max(0.35rem, env(safe-area-inset-top))",
              paddingLeft: rotateFs
                ? "max(0.75rem, env(safe-area-inset-top))"
                : "max(0.75rem, env(safe-area-inset-left))",
              paddingRight: rotateFs
                ? "max(0.75rem, env(safe-area-inset-bottom))"
                : "max(0.75rem, env(safe-area-inset-right))",
            }}
          >
            <button
              type="button"
              onClick={() => {
                void exitImmersiveFs();
              }}
              className="inline-flex min-h-11 min-w-0 max-w-[80%] items-center gap-0.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
              aria-label={t("common.back")}
            >
              <ChevronLeft className="h-7 w-7 shrink-0" strokeWidth={2} />
              <span className="truncate text-[15px] font-medium">
                {title}
                {selected ? ` ${t("detail.episodeLabel", { n: selected.no })}` : ""}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowRate(false);
                setShowQuality(false);
                setShowMore((v) => !v);
              }}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white"
              aria-label={t("player.more")}
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {showMore ? (
              <div className="absolute right-3 top-full z-50 mt-1 min-w-[132px] overflow-hidden rounded-xl bg-[#2a2c2c]/96 py-1 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => {
                    setMuted((m) => !m);
                    setShowMore(false);
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-[13px] text-white/85"
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  {muted ? t("player.unmute") : t("player.mute")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Keep one media surface mounted while only the stage geometry changes. */}
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center"
        >
          <div
            className="relative h-full min-h-0 w-full bg-black"
          >
            <VerticalPager
              index={episodeIndex}
              count={data.episodes.length}
              onChange={selectEpisodeByIndex}
              blocked={pagerBlocked || pagerMenusOpen || landscapeImmersive}
              preserveCenterMedia
              onTap={() => {
                if (landscapeImmersive) {
                  setLandChromeVisible((v) => !v);
                  setShowRate(false);
                  setShowMore(false);
                  setShowQuality(false);
                  return;
                }
                const v = videoRef.current;
                if (!v || !canPlay || !playUrl || locked || needsLogin) return;
                if (v.paused) void v.play().catch(() => {});
                else v.pause();
              }}
            >
              {({ pageIndex, offset, active }) => {
                const ep = data.episodes[pageIndex];
                if (!ep) return null;
                // Keep the settled/center player mounted during snap animation.
                // Only neighbor pages use the lightweight peek (avoids HLS remount flicker).
                if (offset !== 0) {
                  return (
                    <WatchEpisodePeek
                      label={t("detail.episodeLabel", { n: ep.no })}
                      title={title}
                    />
                  );
                }
                return (
                  <div className="relative h-full min-h-0">
                    <VerticalPlayer
                      videoRef={videoRef}
                      active={active}
                      chrome="watch"
                      objectFit={landscapeMode ? "contain" : "cover"}
                      bottomInset={0}
                      showSeek={false}
                      playbackRate={rate}
                      onPlaybackRateChange={setRate}
                      attachMedia={false}
                      src={canPlay && playUrl ? playUrl : null}
                      poster={
                        ep.thumbnail
                          ? (mediaUrl(ep.thumbnail) ?? undefined)
                          : coverIsImg
                            ? (drama.cover[0] ?? undefined)
                            : undefined
                      }
                      autoPlay
                      muted={muted}
                      onMutedChange={setMuted}
                      seekTo={resumeApplied.current ? null : seekTo}
                      loginRequired={needsLogin}
                      onLogin={() => openLogin("login")}
                      onRegister={() => openLogin("register")}
                      locked={locked}
                      lockLabel={`${t("detail.episodeList")} ${ep.no}`}
                      lockActionLabel={lockActionLabel}
                      onUnlock={!isUnlocked(ep) ? () => openUnlockGate(ep) : undefined}
                      error={playErr}
                      loading={playLoading}
                      hasNext={hasNext}
                      onNext={playNext}
                      onEnded={playNext}
                      onSeekingChange={onSeekingChange}
                      onVideoAspectChange={handleVideoAspectChange}
                      tapToToggle={false}
                    />
                  </div>
                );
              }}
            </VerticalPager>
          </div>
        </div>

        {landscapeImmersive && canPlay && playUrl && !locked && !needsLogin ? (
          <button
            type="button"
            className="absolute inset-0 z-20 cursor-default"
            aria-label={t("player.toggleControls")}
            onClick={() => {
              setLandChromeVisible((visible) => !visible);
              setShowRate(false);
              setShowMore(false);
              setShowQuality(false);
            }}
          />
        ) : null}

        {landscapeMode && !landscapeImmersive ? (
          <button
            type="button"
            onClick={() => void enterLandscapeImmersive()}
            className="absolute left-1/2 top-[calc(50%+min(30vw,8rem))] z-30 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#2a2c2c]/88 px-4 py-2 text-[13px] font-medium text-white/95 backdrop-blur-sm"
          >
            <Smartphone className="h-4 w-4 rotate-90" strokeWidth={1.75} />
            {t("player.watchFullscreen")}
          </button>
        ) : null}

        {/* 红果横屏全屏操作条：点击画面显隐，不暂停 */}
        {showLandFsChrome ? (
          <div
            className="absolute inset-x-0 bottom-0 z-50 bg-gradient-to-t from-black/75 via-black/35 to-transparent pt-10"
            style={{
              paddingLeft: rotateFs
                ? "max(0.75rem, env(safe-area-inset-top))"
                : "max(0.75rem, env(safe-area-inset-left))",
              paddingRight: rotateFs
                ? "max(0.75rem, env(safe-area-inset-bottom))"
                : "max(0.75rem, env(safe-area-inset-right))",
              paddingBottom: rotateFs
                ? "max(0.5rem, env(safe-area-inset-left))"
                : "max(0.5rem, env(safe-area-inset-bottom))",
            }}
            data-no-tap
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
              <button
                type="button"
                className="grid h-11 w-11 shrink-0 place-items-center text-white"
                aria-label={videoPlaying ? t("player.pause") : t("player.play")}
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  if (v.paused) void v.play().catch(() => {});
                  else v.pause();
                }}
              >
                {videoPlaying ? (
                  <Pause className="h-5 w-5 fill-white" />
                ) : (
                  <Play className="ml-0.5 h-5 w-5 fill-white" />
                )}
              </button>
              <LandVideoTime videoRef={videoRef} kind="current" />
              <div className="min-w-0 flex-1">
                <WatchSeekBar
                  videoRef={videoRef}
                  absolute={false}
                  mediaKey={playUrl}
                  rotated={rotateFs}
                  disabled={!playUrl || needsLogin || locked}
                  onSeekingChange={onSeekingChange}
                  className="px-0"
                />
              </div>
              <LandVideoTime videoRef={videoRef} kind="duration" />
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-4 pb-0.5 text-[12px] text-white/90">
              <div className="flex min-w-0 items-center gap-5">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 px-1"
                  onClick={() => void toggleLike()}
                >
                  <Heart
                    className={cn("h-4 w-4", liked ? "fill-[#ff4d6d] text-[#ff4d6d]" : "text-white")}
                    strokeWidth={1.75}
                  />
                  {formatCount(likeCount, locale)}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 px-1"
                  onClick={() => void toggleFavorite()}
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      favorited ? "fill-[#ffb000] text-[#ffb000]" : "text-white",
                    )}
                    strokeWidth={1.75}
                  />
                  {formatCount(favCount, locale)}
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <div className={cn("relative", landscapeControlWidth < 420 && "hidden")}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuality(false);
                      setShowMore(false);
                      setShowRate((v) => !v);
                    }}
                    className="min-h-11 px-2 text-[13px] font-medium text-white/95"
                  >
                    {t("player.speed")}
                  </button>
                  {showRate ? (
                    <div className="absolute bottom-full right-0 mb-2 min-w-[92px] overflow-hidden rounded-xl bg-[#2a2c2c]/96 py-1 shadow-lg ring-1 ring-white/10">
                      {PLAYER_RATES.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            setRate(r);
                            setShowRate(false);
                          }}
                          className={cn(
                            "flex min-h-11 w-full items-center justify-center px-3 py-2.5 text-[13px]",
                            r === rate ? "font-semibold text-[#ff7e0d]" : "text-white/85",
                          )}
                        >
                          {r === 1 ? t("player.speedNormal") : `${r}x`}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className={cn("relative", landscapeControlWidth < 500 && "hidden")}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRate(false);
                      setShowMore(false);
                      setShowQuality((v) => !v);
                    }}
                    className="min-h-11 px-2 text-[13px] font-medium text-white/95"
                  >
                    {qualityIndex < 0
                      ? t("player.qualityAuto")
                      : qualities.find((q) => q.index === qualityIndex)?.label ||
                        t("player.qualityAuto")}
                  </button>
                  {showQuality ? (
                    <div className="absolute bottom-full right-0 mb-2 min-w-[112px] overflow-hidden rounded-xl bg-[#2a2c2c]/96 py-1 shadow-lg ring-1 ring-white/10">
                      <button
                        type="button"
                        onClick={() => applyQuality(-1)}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-center px-3 py-2.5 text-[13px]",
                          qualityIndex < 0 ? "font-semibold text-[#ff7e0d]" : "text-white/85",
                        )}
                      >
                        {t("player.qualityAuto")}
                      </button>
                      {qualities.map((q) => (
                        <button
                          key={q.index}
                          type="button"
                          onClick={() => applyQuality(q.index)}
                          className={cn(
                            "flex min-h-11 w-full items-center justify-center px-3 py-2.5 text-[13px]",
                            qualityIndex === q.index
                              ? "font-semibold text-[#ff7e0d]"
                              : "text-white/85",
                          )}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Resume toast */}
        {resumeToast && showWatchBottomChrome ? (
          <div className="absolute inset-x-0 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex justify-center px-4">
            <div className="flex max-w-[92%] items-center gap-2 rounded-full bg-black/70 px-3.5 py-2 text-[12px] text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md">
              <span className="truncate">
                {t("player.resumeToast", { time: resumeTimeLabel })}
              </span>
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center font-medium text-[#ff9a3d]"
                onClick={() => {
                  const v = videoRef.current;
                  if (v) {
                    try {
                      v.currentTime = 0;
                    } catch {
                      /* ignore */
                    }
                  }
                  setSeekTo(null);
                  setResumeToast(false);
                }}
              >
                {t("player.fromBeginning")}
              </button>
              <button
                type="button"
                className="grid h-11 w-11 shrink-0 place-items-center text-white/55"
                onClick={() => setResumeToast(false)}
                aria-label={t("common.close")}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        {/*
          Keep the portrait chrome anchored to the physical bottom. The black
          action row owns the safe-area padding so the seek bar stays over video
          while the episode and fullscreen controls clear the home indicator.
        */}
        {showWatchBottomChrome ? (
          <div className="absolute inset-x-0 bottom-0 z-40">
            <div className="flex flex-col">
              {showWatchMetaChrome ? (
                <div className="relative px-3.5 pb-1">
                  <div className="pointer-events-none max-w-[calc(100%-4.75rem)]">
                    <Link
                      href={`/drama/${id}`}
                      className="pointer-events-auto inline-flex min-h-11 max-w-full items-center gap-0.5 text-[15px] font-semibold leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="truncate">{title}</span>
                      <ChevronRight className="h-[18px] w-[18px] shrink-0 opacity-90" strokeWidth={2.4} />
                    </Link>
                    <button
                      type="button"
                      className="pointer-events-auto flex min-h-11 w-full items-center text-left text-[12px] leading-[17px] text-white/88 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
                      onClick={() => setEpLineExpanded((v) => !v)}
                    >
                      <span className="min-w-0 flex-1">
                        {epLineExpanded ? epLine : epPreview}
                        {!epLineExpanded && epLine.length > 32 && (
                          <span className="ml-1 font-medium text-white">{t("detail.expand")}</span>
                        )}
                      </span>
                    </button>
                  </div>
                  <div className="absolute bottom-2 right-2.5 flex flex-col items-center gap-5">
                    <WatchSideAction
                      label={favorited ? t("detail.favorited") : t("detail.favorite")}
                      count={formatCount(favCount, locale)}
                      onClick={() => void toggleFavorite()}
                    >
                      <Star
                        className={cn(
                          "h-[30px] w-[30px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]",
                          favorited ? "fill-[#ffb000] text-[#ffb000]" : "text-white",
                        )}
                        strokeWidth={1.75}
                      />
                    </WatchSideAction>
                    <WatchSideAction
                      label={t("feed.like")}
                      count={formatCount(likeCount, locale)}
                      onClick={() => void toggleLike()}
                    >
                      <Heart
                        className={cn(
                          "h-[30px] w-[30px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]",
                          liked ? "fill-[#ff4d6d] text-[#ff4d6d]" : "text-white",
                        )}
                        strokeWidth={1.75}
                      />
                    </WatchSideAction>
                  </div>
                </div>
              ) : null}

              <div className="relative z-10 w-full">
                <WatchSeekBar
                  videoRef={videoRef}
                  absolute={false}
                  compact
                  className="!px-3.5"
                  mediaKey={playUrl}
                  disabled={!playUrl || needsLogin || locked}
                  onSeekingChange={onSeekingChange}
                />
                <div className="flex items-center gap-6 bg-[#000000] px-[18px] pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-1">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] bg-[#19191b] px-3.5 text-white"
                  >
                    <span className="min-w-0 truncate text-left text-[13px] font-medium leading-none">
                      {t("detail.pickEpisodesBar", { n: drama.episodesCount })}
                    </span>
                    <ChevronUp className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2.25} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (uiImmersive) {
                        void exitImmersiveFs();
                      } else if (landscapeMode) {
                        void enterLandscapeImmersive();
                      } else {
                        void enterPortraitFullscreen();
                      }
                    }}
                    className="grid h-11 w-11 shrink-0 place-items-center text-white"
                    aria-label={
                      uiImmersive
                        ? t("player.exitFullscreen")
                        : t("player.fullscreen")
                    }
                  >
                    {uiImmersive ? (
                      <Minimize2 className="h-5 w-5" strokeWidth={1.85} />
                    ) : (
                      <Maximize className="h-5 w-5" strokeWidth={1.85} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void exitImmersiveFs()}
            className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-50 grid h-11 w-11 place-items-center rounded-[10px] bg-black/40 text-white backdrop-blur-sm"
            aria-label={t("player.exitFullscreen")}
          >
            <Minimize2 className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}

        <EpisodeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={title}
          coverUrl={coverIsImg ? drama.cover[0] : undefined}
          desc={desc}
          episodes={data.episodes}
          episodesCount={drama.episodesCount}
          selectedNo={selected?.no}
          isUnlocked={isUnlocked}
          onUnlock={openUnlockGate}
          onSelect={selectEpisode}
          favorited={favorited}
          onToggleFavorite={() => void toggleFavorite()}
        />
        {unlockSheetEl}
      </div>
    );
  }

  /* ---- Watching: desktop theater (ReelShort-style: vertical player + sidebar) ---- */
  if (watching && !isMobile) {
    const epTitleText = selected
      ? pickTitleText(locale, selected.titleEn, selected.titleZh, selected.titleFr)
      : "";
    const theaterHeadline = selected
      ? `${t("detail.episodeLabel", { n: selected.no })}${epTitleText && epTitleText !== title ? ` - ${epTitleText}` : ` - ${title}`}`
      : title;
    const shareTheater = async () => {
      const url = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
          return;
        }
      } catch {
        /* ignore cancel */
      }
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* ignore */
      }
    };
    const exitTheater = () => {
      if (canGoBackInApp()) router.back();
      else router.push("/");
    };

    return (
      <div className="fixed inset-0 z-[70] flex flex-col bg-[#181a1a]">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-4 md:px-5">
          <button
            type="button"
            onClick={exitTheater}
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 py-2 text-[14px] text-white/85 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t("common.back")}
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="max-w-[42vw] truncate">{title}</span>
          </button>
          <span className="text-[13px] text-white/45">
            {selected ? t("detail.episodeLabel", { n: selected.no }) : null}
          </span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-black px-3 py-3">
            <div className="relative h-full max-h-full w-full max-w-[min(100%,calc((100vh-3.5rem-1.5rem)*9/16))] aspect-[9/16]">
              <VideoPlayer
                fill
                videoRef={videoRef}
                src={canPlay && playUrl ? playUrl : null}
                poster={coverIsImg ? drama.cover[0] : undefined}
                autoPlay
                seekTo={resumeApplied.current ? null : seekTo}
                loginRequired={needsLogin}
                onLogin={() => openLogin("login")}
                onRegister={() => openLogin("register")}
                locked={locked}
                lockLabel={
                  selected
                    ? t("detail.episodeLabel", { n: selected.no })
                    : t("player.empty")
                }
                lockActionLabel={lockActionLabel}
                onUnlock={selected && !isUnlocked(selected) ? () => openUnlockGate(selected) : undefined}
                error={playErr}
                loading={playLoading}
                hasNext={hasNext}
                onNext={playNext}
                onEnded={playNext}
                title={selected ? `${title} · ${t("detail.episodeLabel", { n: selected.no })}` : title}
                onOpenEpisodes={() => setDrawerOpen(true)}
              />
            </div>
          </div>

          <aside className="hidden w-[420px] shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-[#121212] lg:flex">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <nav className="mb-3 flex flex-wrap items-center gap-x-1.5 text-[12px] text-white/40">
                <Link href="/" className="transition-colors hover:text-white/70">
                  {t("nav.home")}
                </Link>
                <span aria-hidden>/</span>
                <span className="max-w-[10rem] truncate text-white/55">{title}</span>
                {selected ? (
                  <>
                    <span aria-hidden>/</span>
                    <span className="text-white/70">
                      {t("detail.episodeLabel", { n: selected.no })}
                    </span>
                  </>
                ) : null}
              </nav>

              <h1 className="mb-3 text-[20px] font-semibold leading-7 text-white">
                {theaterHeadline}
              </h1>

              {desc ? (
                <p className="mb-4 line-clamp-4 text-[13px] leading-6 text-white/45">{desc}</p>
              ) : null}

              {theaterTags.length > 0 && (
                <div className="mb-5 flex flex-wrap gap-1.5">
                  {theaterTags.map((tag) => (
                    <span
                      key={tag.key}
                      className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[12px] text-white/70"
                    >
                      {pickTagText(locale, tag)}
                    </span>
                  ))}
                </div>
              )}

              <div className="mb-6 flex items-center gap-5 text-[13px] text-white/75">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
                  onClick={() => void toggleLike()}
                  aria-label={t("feed.like")}
                >
                  <Heart
                    className={cn(
                      "h-4 w-4",
                      liked ? "fill-[#ff4d6d] text-[#ff4d6d]" : "text-white/80",
                    )}
                    strokeWidth={1.75}
                  />
                  {formatCount(likeCount, locale)}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
                  onClick={() => void toggleFavorite()}
                  aria-label={favorited ? t("detail.favorited") : t("detail.favorite")}
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      favorited ? "fill-[#ffb000] text-[#ffb000]" : "text-white/80",
                    )}
                    strokeWidth={1.75}
                  />
                  {formatCount(favCount, locale)}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
                  onClick={() => void shareTheater()}
                  aria-label={t("player.share")}
                >
                  <Share2 className="h-4 w-4 text-white/80" strokeWidth={1.75} />
                </button>
              </div>

              <EpisodeList
                episodes={data.episodes}
                episodesCount={drama.episodesCount}
                selectedNo={selected?.no}
                layout="sidebar"
                isUnlocked={isUnlocked}
                onUnlock={openUnlockGate}
                onSelect={selectEpisode}
              />
            </div>
          </aside>
        </div>

        {/* Narrow desktop: episode drawer fallback */}
        <EpisodeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={title}
          coverUrl={coverIsImg ? drama.cover[0] : undefined}
          desc={desc}
          episodes={data.episodes}
          episodesCount={drama.episodesCount}
          selectedNo={selected?.no}
          isUnlocked={isUnlocked}
          onUnlock={openUnlockGate}
          onSelect={selectEpisode}
          favorited={favorited}
          onToggleFavorite={() => void toggleFavorite()}
        />
        {unlockSheetEl}
      </div>
    );
  }

  /* ---- Browse: Hongguo mobile detail (/drama/[id]) ---- */
  if (isMobile) {
    const heatLabel = formatCount(dramaHeat(drama), locale);
    const goBackBrowse = () => {
      if (canGoBackInApp()) router.back();
      else router.push("/");
    };
    const onShareMore = async () => {
      const url = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
          return;
        }
      } catch {
        /* ignore cancel */
      }
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* ignore */
      }
    };

    return (
      <div
        className="fixed inset-0 z-[70] flex flex-col overflow-hidden text-white"
        style={{ background: "#1c1c1c" }}
      >
        <div className="flex shrink-0 items-center justify-between px-2 pb-1 pt-[max(0.35rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={goBackBrowse}
            className="grid h-11 w-11 place-items-center text-white"
            aria-label={t("common.back")}
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => void onShareMore()}
            className="grid h-11 w-11 place-items-center text-white"
            aria-label={t("player.more")}
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(5.25rem+env(safe-area-inset-bottom))]">
          <div className="flex gap-3.5">
            <div className="relative h-[138px] w-[98px] shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
              {coverIsImg ? (
                <SafeImage
                  src={drama.cover[0]}
                  alt={title}
                  className="h-full w-full object-cover"
                  fallbackLabel={t("common.imageUnavailable")}
                />
              ) : (
                <div
                  className="h-full w-full"
                  style={{
                    background: `linear-gradient(150deg, ${drama.cover[0]}, ${drama.cover[1]})`,
                  }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <h1 className="text-[20px] font-semibold leading-7 text-white">{title}</h1>
              <p className="mt-2 text-[13px] leading-5 text-white/45">
                {t("card.episodesAll", { n: drama.episodesCount })}
                {" · "}
                {t("detail.heatValue", { n: heatLabel })}
              </p>
              {tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag.key}
                      className="inline-flex max-w-full items-center gap-0.5 rounded-md bg-white/[0.06] px-2 py-1 text-[12px] leading-none text-white/65"
                    >
                      <span className="truncate">{pickTagText(locale, tag)}</span>
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2.25} />
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {desc ? (
            <section className="mt-7">
              <h2 className="text-[16px] font-medium text-white">{t("detail.synopsis")}</h2>
              <p
                className={cn(
                  "mt-2 text-[14px] leading-[22px] text-white/55",
                  !descExpanded && "line-clamp-3",
                )}
              >
                {desc}
                {!descExpanded && desc.length > 72 ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => setDescExpanded(true)}
                      className="inline text-[14px] text-[#8aa8c8]"
                    >
                      {t("detail.expand")}
                    </button>
                  </>
                ) : null}
              </p>
              {descExpanded && desc.length > 72 ? (
                <button
                  type="button"
                  onClick={() => setDescExpanded(false)}
                  className="mt-1 text-[14px] text-[#8aa8c8]"
                >
                  {t("detail.collapse")}
                </button>
              ) : null}
            </section>
          ) : null}

          <section className="mt-8">
            <EpisodeList
              episodes={data.episodes}
              episodesCount={drama.episodesCount}
              selectedNo={selected?.no}
              layout="grid"
              isUnlocked={isUnlocked}
              onUnlock={openUnlockGate}
              onSelect={selectEpisode}
            />
          </section>

          {related.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-3.5 text-[16px] font-medium text-white">{t("detail.guessYouLike")}</h2>
              <div className="grid grid-cols-2 gap-x-3 gap-y-5">
                {related.map((d) => {
                  const rTitle = pickTitleText(locale, d.titleEn, d.titleZh, d.titleFr);
                  const rCover = isUrl(d.cover[0]);
                  const rTags = toPublicDramaTagObjects(d.tags).slice(0, 3);
                  const chipTags = rTags.map((tag) => pickTagText(locale, tag));
                  return (
                    <Link key={d.id} href={`/drama/${d.id}`} className="min-w-0">
                      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-white/[0.06]">
                        {rCover ? (
                          <SafeImage
                            src={d.cover[0]}
                            alt={rTitle}
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
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-8">
                          <span className="inline-flex items-center gap-0.5 rounded bg-black/45 px-1.5 py-0.5 text-[11px] text-white/95 backdrop-blur-sm">
                            <Flame className="h-3 w-3 text-[#ff8a3d]" fill="currentColor" />
                            {t("detail.heatBadge", {
                              n: formatCount(dramaHeat(d), locale),
                            })}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-1 text-[14px] font-medium leading-5 text-white">
                        {rTitle}
                      </p>
                      {chipTags.length > 0 ? (
                        <p className="mt-1 truncate text-[12px] text-white/40">
                          {chipTags.join(" · ")}
                        </p>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <div
          className="absolute inset-x-0 bottom-0 z-40 flex gap-2.5 px-4 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-3"
          style={{
            background:
              "linear-gradient(180deg, rgba(28,28,28,0) 0%, rgba(28,28,28,0.92) 35%, #1c1c1c 70%)",
          }}
        >
          <button
            type="button"
            onClick={onWatchFree}
            className="flex h-11 flex-[1.65] items-center justify-center gap-1.5 rounded-xl bg-white text-[15px] font-semibold text-black"
          >
            <Play className="h-4 w-4 fill-black text-black" />
            {t("detail.continuePlay")}
          </button>
          <button
            type="button"
            onClick={() => void toggleFavorite()}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/[0.1] text-[15px] font-medium text-white"
          >
            <Star
              className={cn(
                "h-4 w-4",
                favorited ? "fill-[#ffb000] text-[#ffb000]" : "fill-none text-white",
              )}
              strokeWidth={1.75}
            />
            {favorited ? t("detail.favorited") : t("detail.favorite")}
          </button>
        </div>
        {unlockSheetEl}
      </div>
    );
  }

  /* ---- Browse: Hongguo detail (desktop) ---- */
  return (
    <div className="relative overflow-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-24">
      {/* Desktop backdrop — warm orange glow like hongguo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[min(920px,100%)] overflow-hidden md:block">
        {coverIsImg ? (
          <SafeImage
            src={drama.cover[0]}
            alt=""
            className="absolute left-1/2 top-0 h-full w-[1920px] max-w-none -translate-x-1/2 scale-110 object-cover opacity-40 blur-2xl"
          />
        ) : null}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 64% at 51% -3%, rgba(250,119,5,0.10) 0%, transparent 100%), radial-gradient(ellipse 38% 89% at 111% -1%, rgba(58,227,221,0.08) 0%, transparent 100%), linear-gradient(180deg, rgba(19,20,20,0.55) 0%, #131414 78%)",
          }}
        />
      </div>

      {/* Mobile soft wash */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[280px] md:hidden"
        style={{
          background:
            "radial-gradient(ellipse 90% 80% at 70% -10%, rgba(250,119,5,0.14) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-[1280px] md:px-10 md:pt-10">
        {/* Hero */}
        <div className="flex w-full gap-4 px-4 pt-[1.7rem] md:gap-9 md:px-0 md:pt-0">
          <div className="relative h-[138px] w-[98px] shrink-0 overflow-hidden rounded-xl bg-white/[0.06] md:h-[238px] md:w-[168px] md:rounded-2xl">
            {coverIsImg ? (
              <SafeImage
                src={drama.cover[0]}
                alt={title}
                className="h-full w-full object-cover"
                fallbackLabel={t("common.imageUnavailable")}
              />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  background: `linear-gradient(150deg, ${drama.cover[0]}, ${drama.cover[1]})`,
                }}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col md:h-[238px] md:max-w-[800px]">
            <h1 className="text-[20px] font-medium leading-7 text-white md:mb-4 md:text-[28px] md:leading-[44px] md:text-white/95">
              {title}
            </h1>

            {tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-x-3 gap-y-3 overflow-hidden md:mt-0 md:h-8">
                {tags.map((tag) => (
                  <span
                    key={tag.key}
                    className="inline-flex max-w-[6.5rem] items-center truncate rounded bg-[hsla(0,0%,88%,0.06)] px-2 py-1.5 text-[12px] leading-none text-white/70 md:h-8 md:max-w-[150px] md:rounded-md md:bg-[hsla(0,0%,88%,0.08)] md:px-2.5 md:py-0 md:text-[16px] md:text-white/80"
                  >
                    {pickTagText(locale, tag)}
                  </span>
                ))}
              </div>
            )}

            {resumeHint && resumeHint.progressSec > 5 && (
              <p className="mt-2 text-caption text-white/40 md:mt-3 md:text-white/45">
                {t("detail.resumeHint", {
                  n: resumeHint.epNo,
                  time: `${Math.floor(resumeHint.progressSec / 60)}:${String(resumeHint.progressSec % 60).padStart(2, "0")}`,
                })}
              </p>
            )}

            {/* Desktop play CTA — Hongguo orange */}
            <div className="mt-auto hidden pt-6 md:flex">
              <button
                type="button"
                onClick={onWatchFree}
                className="group relative z-0 inline-flex h-[45px] w-[162px] items-center justify-center rounded-xl text-white/95 transition-opacity duration-150"
                style={{ background: PLAY_GRAD }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  style={{ background: PLAY_GRAD_HOVER }}
                />
                <Play className="relative z-[1] h-[18px] w-[18px] fill-white" />
                <span className="relative z-[1] ml-2 text-[18px] font-medium leading-none">
                  {t("detail.playPrimary")}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* 基本信息 */}
        <section className="mt-2 px-4 md:mt-[72px] md:px-0">
          <h2 className="h-10 text-[16px] font-medium leading-10 text-white md:h-auto md:text-[20px] md:leading-none md:text-white/90">
            {t("detail.basicInfo")}
          </h2>

          {desc ? (
            <div className="md:mt-4">
              <p
                className={cn(
                  "text-[14px] leading-[22px] text-white/70 md:max-w-[1080px] md:text-[16px] md:leading-8 md:text-white/40",
                  !descExpanded && "line-clamp-3 md:line-clamp-none",
                )}
              >
                {desc}
              </p>
              {desc.length > 80 && (
                <button
                  type="button"
                  onClick={() => setDescExpanded((v) => !v)}
                  className="mt-0.5 text-[14px] leading-[22px] text-[#82a5cd] md:hidden"
                >
                  {descExpanded ? t("detail.collapse") : t("detail.expand")}
                </button>
              )}
            </div>
          ) : null}

          {drama.creator?.displayName && (
            <div
              className={cn(
                "mt-4 flex gap-3 overflow-x-auto pb-1 md:mt-7 md:flex-wrap md:gap-x-7 md:gap-y-5 md:overflow-visible",
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
            >
              <div className="flex min-w-[72px] flex-col items-center md:items-center">
                <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-white/10 text-body-sm font-medium text-white/80">
                  {mediaUrl(drama.creator.avatarUrl) ? (
                    <SafeImage
                      src={mediaUrl(drama.creator.avatarUrl)!}
                      alt={drama.creator.displayName}
                      className="h-full w-full object-cover"
                      fallback={drama.creator.displayName.slice(0, 1).toUpperCase()}
                    />
                  ) : (
                    drama.creator.displayName.slice(0, 1).toUpperCase()
                  )}
                </div>
                <p className="mt-2 max-w-[98px] truncate text-center text-[14px] font-medium leading-5 text-white/95">
                  {drama.creator.displayName}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* 剧集 */}
        <div className="mt-8 px-4 md:mt-[60px] md:px-0">
          <EpisodeList
            episodes={data.episodes}
            episodesCount={drama.episodesCount}
            selectedNo={selected?.no}
            layout="grid"
            isUnlocked={isUnlocked}
            onUnlock={openUnlockGate}
            onSelect={selectEpisode}
          />
        </div>

        {/* 相关短剧 */}
        {related.length > 0 && (
          <section className="mt-10 px-4 md:mt-[60px] md:px-0">
            <h2 className="mb-4 text-[16px] font-medium text-white md:mb-6 md:text-[20px] md:text-white/90">
              {t("detail.related")}
            </h2>
            <div
              className={cn(
                "flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-6 md:gap-8 md:overflow-visible",
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
            >
              {related.map((d) => (
                <div key={d.id} className="w-[108px] shrink-0 md:w-auto">
                  <DramaCard drama={d} compact variant="grid" />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Mobile sticky play — Hongguo orange CTA */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex flex-col items-center justify-center px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
        style={{
          background:
            "linear-gradient(180deg, rgba(24,26,26,0) 0%, rgba(24,26,26,0.8) 37.5%, #181a1a 60%)",
        }}
      >
        <button
          type="button"
          onClick={onWatchFree}
          className="flex h-11 w-full max-w-[300px] items-center justify-center gap-1.5 rounded-xl text-[15px] font-medium text-white"
          style={{ background: PLAY_GRAD }}
        >
          <Play className="h-4 w-4 fill-white" />
          {t("detail.playPrimary")}
        </button>
      </div>

      {unlockSheetEl}
    </div>
  );
}

function WatchEpisodePeek({
  label,
  title,
}: {
  label: string;
  title: string;
}) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-black">
      <div className="absolute inset-x-0 bottom-24 px-3">
        <p className="truncate text-[17px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]">
          {title}
        </p>
        <p className="mt-1 text-[13px] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
          {label}
        </p>
      </div>
    </div>
  );
}

function WatchSideAction({
  children,
  count,
  label,
  onClick,
}: {
  children: ReactNode;
  count: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
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
