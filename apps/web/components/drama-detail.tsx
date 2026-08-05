"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Heart,
  Maximize,
  Minimize2,
  MoreVertical,
  Smartphone,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { EpisodeList } from "@/components/episode-list";
import { VideoPlayer } from "@/components/video-player";
import { PLAYER_RATES, VerticalPlayer } from "@/components/mobile/vertical-player";
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
} from "@/lib/api";
import { categoryName, type Drama, type Episode } from "@/lib/mock-data";
import { useGuestWatchQuota } from "@/lib/use-guest-watch-quota";
import { pickContentText } from "@/lib/languages";
import { WatchSeekBar } from "@/components/mobile/watch-seek-bar";
import { mediaUrl, cn } from "@/lib/utils";
import { DramaCard } from "@/components/drama-card";

function isUrl(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
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

const PLAY_GRAD =
  "linear-gradient(92.27deg, #ff7e0d 0.32%, #ff9233)";
const PLAY_GRAD_HOVER =
  "linear-gradient(92.27deg, #ed6f00 0.32%, #eb862f)";
/** Episode picker row (padding + h-11 pill), approx. */
const WATCH_BAR_H = 52;
/** Thin seek hit row above the episode picker. */
const WATCH_SEEK_H = 26;
/** Space under title / side actions = picker + seek + small gap. */
const WATCH_INFO_BOTTOM = WATCH_BAR_H + WATCH_SEEK_H + 8;

export function DramaDetail({ id }: { id: string }) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const { user, openLogin, openVip, ready: authReady } = useAuth();
  const { ready: guestReady, canWatch: canGuestWatch, markWatched: markGuestWatched } = useGuestWatchQuota();
  const { mobile: isMobile, ready: mobileReady } = useIsMobile();
  const [data, setData] = useState<{
    drama: Drama;
    episodes: Episode[];
    buyoutCredits?: string | null;
    vipActive?: boolean;
    dramaUnlocked?: boolean;
  } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unlockedNos, setUnlockedNos] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Episode | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
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
  /** 移动端：横片源自动 16:9 信箱；竖片源竖屏铺满 */
  const [landscapeMode, setLandscapeMode] = useState(false);
  const [followVideoAspect, setFollowVideoAspect] = useState(true);
  const [browserFs, setBrowserFs] = useState(false);
  /** Fullscreen API 不可用时仍进入竖屏沉浸 UI（如部分 iOS Safari） */
  const [uiImmersive, setUiImmersive] = useState(false);
  /** iOS 等无法 lock 横屏时的 CSS 强制横屏全屏（仅横屏全屏路径） */
  const [rotateFs, setRotateFs] = useState(false);
  const [qualities, setQualities] = useState<Array<{ index: number; height: number; label: string }>>([]);
  const [qualityIndex, setQualityIndex] = useState(-1); // -1 = auto
  const [showQuality, setShowQuality] = useState(false);
  const [resumeToast, setResumeToast] = useState(false);
  const [pagerBlocked, setPagerBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const watchShellRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<any>(null);
  const resumeApplied = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setWatching(false);
    setDescExpanded(false);
    setRelated([]);
    setNotFound(false);
    setFavorited(false);
    setFavCount(0);
    setLiked(false);
    setLikeCount(0);
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
      .catch(() => {
        if (!ac.signal.aborted) setNotFound(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [id]);

  useEffect(() => {
    if (!data || selected) return;
    const pick =
      data.episodes.find(
        (e) =>
          e.isFree ||
          !!e.unlocked ||
          unlockedNos.has(e.no) ||
          !!data.vipActive ||
          !!data.dramaUnlocked ||
          !!user?.isVip,
      ) ?? null;
    setSelected(pick);
  }, [data, selected, unlockedNos, user?.isVip]);

  useEffect(() => {
    setEpLineExpanded(false);
    setShowRate(false);
    setShowMore(false);
    setShowQuality(false);
    setFollowVideoAspect(true);
    setLandscapeMode(false);
    setUiImmersive(false);
    setRotateFs(false);
    setQualityIndex(-1);
    setQualities([]);
  }, [selected?.no]);

  useEffect(() => {
    if (!watching) {
      setLandscapeMode(false);
      setBrowserFs(false);
      setUiImmersive(false);
      setRotateFs(false);
      setShowQuality(false);
      setResumeToast(false);
    }
  }, [watching]);

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
      const fs = !!document.fullscreenElement;
      setBrowserFs(fs);
      if (!fs) {
        setRotateFs(false);
        setUiImmersive(false);
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!user || !data) return;
    let alive = true;
    resumeApplied.current = false;
    getWatchHistory(1, data.drama.numericId || data.drama.id)
      .then((r) => {
        if (!alive) return;
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
  }, [user, data?.drama.numericId, data?.drama.id]);

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

  const isUnlocked = (ep: Episode) =>
    ep.isFree || !!ep.unlocked || unlockedNos.has(ep.no) || !!data?.vipActive || !!data?.dramaUnlocked || !!user?.isVip;
  const playerReady = !!(selected && isUnlocked(selected));
  const lockActionLabel =
    selected && !selected.isFree && !isUnlocked(selected) ? t("vip.open") : undefined;

  /** Mobile: skip poster/info landing — go straight into vertical watch. */
  useEffect(() => {
    if (!mobileReady || !isMobile || loading || !data) return;
    setWatching(true);
  }, [mobileReady, isMobile, loading, data]);

  useEffect(() => {
    if (!playerReady || !selected?.id) {
      setPlayUrl(null);
      setPlayErr(null);
      return;
    }
    if (!authReady || !guestReady) {
      setPlayUrl(null);
      setPlayErr(null);
      return;
    }
    const episodeId = String(selected.id);
    const allowed = !!(user || canGuestWatch(episodeId));
    if (!allowed) {
      setPlayUrl(null);
      setPlayErr(null);
      return;
    }
    const ac = new AbortController();
    // Drop previous episode's URL so HLS never attaches the wrong source.
    setPlayUrl(null);
    setPlayErr(null);
    getPlayUrl(episodeId, { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setPlayUrl(r.playUrl);
        if (!user) markGuestWatched(episodeId);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e?.status === 401) setPlayErr(t("errors.loginRequired"));
        else setPlayErr(e?.message || t("player.error"));
      });
    return () => ac.abort();
  }, [playerReady, selected?.id, user, authReady, guestReady, canGuestWatch, markGuestWatched, t]);

  useEffect(() => {
    if (!data?.drama.categorySlug) return;
    const ac = new AbortController();
    loadHome(1, 12, { category: data.drama.categorySlug, sort: "hot", signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return;
        setRelated((r.rows || []).filter((d) => d.id !== data.drama.id).slice(0, 8));
      })
      .catch(() => {
        if (!ac.signal.aborted) setRelated([]);
      });
    return () => ac.abort();
  }, [data?.drama.categorySlug, data?.drama.id]);

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

  // HLS attach + quality levels + 横竖检测
  useEffect(() => {
    const video = videoRef.current;
    const episodeId = selected?.id ? String(selected.id) : "";
    const allowed = !!(user || (episodeId && canGuestWatch(episodeId)));
    if (!video || !playUrl || !playerReady || !watching || !allowed) return;

    const applyAspect = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const isLand = video.videoWidth >= video.videoHeight;
      if (followVideoAspect) setLandscapeMode(isLand);
    };

    const onMeta = () => {
      applyAspect();
      if (seekTo != null && seekTo > 5 && !resumeApplied.current) {
        try {
          video.currentTime = seekTo;
          resumeApplied.current = true;
        } catch {
          /* ignore */
        }
      }
    };
    video.addEventListener("loadedmetadata", onMeta);

    if (!isHls(playUrl)) {
      video.src = playUrl;
      setQualities([]);
      hlsRef.current = null;
      return () => video.removeEventListener("loadedmetadata", onMeta);
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playUrl;
      setQualities([]);
      hlsRef.current = null;
      return () => video.removeEventListener("loadedmetadata", onMeta);
    }
    let hls: any;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled || !Hls.isSupported()) {
          if (!cancelled) setPlayErr("Trình duyệt không hỗ trợ HLS");
          return;
        }
        hls = new Hls({ capLevelToPlayerSize: true });
        hlsRef.current = hls;
        hls.loadSource(playUrl);
        hls.attachMedia(video);
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
          void video.play().catch(() => {});
        });
      } catch {
        if (!cancelled) setPlayErr("Không tải được trình phát HLS");
      }
    })();
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onMeta);
      if (hls) hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
    // landscapeMode toggles which <video> is mounted — rebind when the surface changes.
  }, [
    playUrl,
    seekTo,
    playerReady,
    user,
    watching,
    followVideoAspect,
    selected?.id,
    landscapeMode,
    canGuestWatch,
  ]);

  const selectEpisodeByIndex = useCallback(
    (i: number) => {
      const ep = data?.episodes[i];
      if (ep) setSelected(ep);
    },
    [data?.episodes],
  );

  const onSeekingChange = useCallback((seeking: boolean) => {
    setPagerBlocked(seeking);
  }, []);

  if (!mobileReady) {
    return <div className="min-h-[40vh]" aria-busy="true" />;
  }

  if (loading) {
    if (isMobile) {
      return <div className="fixed inset-0 z-[70] bg-black" aria-busy="true" />;
    }
    return (
      <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-6 md:px-10 md:pt-10">
        <div className="flex gap-4 md:gap-9">
          <div className="h-[138px] w-[98px] shrink-0 animate-pulse rounded-xl bg-white/[0.06] md:h-[238px] md:w-[168px] md:rounded-2xl" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="h-7 w-2/3 animate-pulse rounded bg-white/[0.06]" />
            <div className="flex gap-2">
              <div className="h-7 w-16 animate-pulse rounded-md bg-white/[0.06]" />
              <div className="h-7 w-20 animate-pulse rounded-md bg-white/[0.06]" />
            </div>
            <div className="mt-6 hidden h-[45px] w-[162px] animate-pulse rounded-xl bg-white/[0.06] md:block" />
          </div>
        </div>
        <div className="mt-8 space-y-3">
          <div className="h-5 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-16 w-full animate-pulse rounded bg-white/[0.06]" />
        </div>
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
  const title = pickContentText(locale, drama.titleEn, drama.titleZh);
  const desc = pickContentText(locale, drama.descEn, drama.descZh);
  const cat = categoryName(drama.categorySlug, locale);
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

  /** Locked episodes → VIP subscription (no per-episode credit unlock). */
  function openVipGate(_ep?: Episode) {
    if (!authReady) return;
    if (!user) {
      openLogin();
      return;
    }
    openVip();
  }

  function onWatchFree() {
    const f =
      data!.episodes.find((e) => isUnlocked(e)) ?? data!.episodes[0];
    if (f) {
      if (isUnlocked(f)) setSelected(f);
      else {
        openVipGate(f);
        return;
      }
    }
    setWatching(true);
  }

  function playNext() {
    if (!selected || !data) return;
    const idx = data.episodes.findIndex((e) => e.no === selected.no);
    for (let i = idx + 1; i < data.episodes.length; i++) {
      const ep = data.episodes[i];
      if (isUnlocked(ep)) {
        setSelected(ep);
        return;
      }
    }
  }

  const hasNext = (() => {
    if (!selected || !data) return false;
    const idx = data.episodes.findIndex((e) => e.no === selected.no);
    return data.episodes.slice(idx + 1).some((e) => isUnlocked(e));
  })();

  // session 未就绪时不要误显示「请登录」（V3-01）
  const needsLogin = authReady && guestReady && playerReady && !user && !(selected?.id && canGuestWatch(String(selected.id)));
  const guestAllowed = !user && guestReady && playerReady && !!selected?.id && canGuestWatch(String(selected.id));
  const canPlay = playerReady && !!(user || guestAllowed);
  const locked = !playerReady;
  const playLoading = !authReady || !guestReady || (canPlay && !playUrl && !playErr);

  const selectEpisode = (ep: Episode) => {
    if (isUnlocked(ep)) {
      setSelected(ep);
      setDrawerOpen(false);
      setWatching(true);
    } else openVipGate(ep);
  };

  const tags = (() => {
    const fromApi = (drama.tags || []).filter(Boolean).slice(0, 4);
    if (fromApi.length) return fromApi;
    return cat ? [cat] : [];
  })();

  /* ---- Watching: mobile vertical ---- */
  if (watching && isMobile) {
    const epTitle = selected
      ? pickContentText(locale, selected.titleEn, selected.titleZh)
      : "";
    const epLine = selected
      ? `${t("detail.episodeLabel", { n: selected.no })}${epTitle ? ` | ${epTitle}` : ""}`
      : desc;
    const epPreview = epLine.length > 26 ? `${epLine.slice(0, 26)}...` : epLine;

    const exitImmersiveFs = async () => {
      setUiImmersive(false);
      setRotateFs(false);
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        /* ignore */
      }
      try {
        const orient = screen.orientation as ScreenOrientation & { unlock?: () => void };
        orient.unlock?.();
      } catch {
        /* ignore */
      }
    };

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

    /** 横屏沉浸：requestFullscreen + orientation.lock；失败则 CSS rotateFs */
    const enterLandscapeFullscreen = async () => {
      setShowRate(false);
      setShowMore(false);
      setShowQuality(false);
      setUiImmersive(false);
      const el = watchShellRef.current;
      let locked = false;
      try {
        if (el?.requestFullscreen && !document.fullscreenElement) {
          await el.requestFullscreen();
        }
        const orient = screen.orientation as ScreenOrientation & {
          lock?: (orientation: string) => Promise<void>;
        };
        if (orient.lock) {
          await orient.lock("landscape");
          locked = true;
        }
      } catch {
        locked = false;
      }
      if (!locked) setRotateFs(true);
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

    const immersiveFs = browserFs || uiImmersive || rotateFs;
    const fillVideo = !landscapeMode || immersiveFs;
    const resumeTimeLabel = resumeHint
      ? `${Math.floor(resumeHint.progressSec / 60)}:${String(Math.floor(resumeHint.progressSec % 60)).padStart(2, "0")}`
      : "";
    const episodeIndex = selected
      ? Math.max(
          0,
          data.episodes.findIndex((e) => e.no === selected.no),
        )
      : 0;
    const coverUrl = coverIsImg ? drama.cover[0] : undefined;
    const pagerMenusOpen = showRate || showMore || showQuality || drawerOpen;

    return (
      <div
        ref={watchShellRef}
        className={cn(
          rotateFs
            ? "fixed z-[70] overflow-hidden bg-black"
            : cn("fixed inset-0 z-[70]", landscapeMode ? "bg-[#181a1a]" : "bg-black"),
        )}
        style={
          rotateFs
            ? {
                width: "100vh",
                height: "100vw",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%) rotate(90deg)",
              }
            : undefined
        }
      >
        {/* Top chrome */}
        <div className="absolute left-0 right-0 top-0 z-40 flex items-center justify-between bg-gradient-to-b from-black/65 via-black/25 to-transparent px-2.5 pb-3 pt-[max(0.4rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => {
              void exitImmersiveFs();
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                router.push("/");
              }
            }}
            className="inline-flex items-center gap-0.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
            aria-label="back"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
            <span className="text-[15px] font-medium">
              {selected ? t("detail.episodeLabel", { n: selected.no }) : title}
            </span>
          </button>

          <div className="relative flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                setShowMore(false);
                setShowQuality(false);
                setShowRate((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
            >
              <Clock3 className="h-4 w-4" />
              {t("player.speed")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowRate(false);
                setShowQuality(false);
                setShowMore((v) => !v);
              }}
              className="grid h-9 w-9 place-items-center rounded-full text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
              aria-label={t("player.more")}
            >
              <MoreVertical className="h-5 w-5" />
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
                      "flex w-full items-center justify-center px-3 py-2.5 text-[13px]",
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
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] text-white/85"
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
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] text-white/85"
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
                    "flex w-full items-center justify-center px-3 py-2.5 text-[13px]",
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
                      "flex w-full items-center justify-center px-3 py-2.5 text-[13px]",
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

        {/* Video stage */}
        {landscapeMode && !immersiveFs ? (
          <div className="absolute inset-x-0 top-[max(3.25rem,calc(env(safe-area-inset-top)+2.75rem))] z-10">
            <div className="relative mx-auto w-full bg-black" style={{ aspectRatio: "16 / 9" }}>
              <VerticalPlayer
                videoRef={videoRef}
                active
                chrome="watch"
                objectFit="contain"
                showSeek={false}
                bottomInset={0}
                playbackRate={rate}
                onPlaybackRateChange={setRate}
                attachMedia={false}
                src={canPlay && playUrl ? playUrl : null}
                poster={coverUrl}
                autoPlay
                muted={muted}
                onMutedChange={setMuted}
                seekTo={resumeApplied.current ? null : seekTo}
                loginRequired={needsLogin}
                onLogin={() => openLogin("login")}
                onRegister={() => openLogin("register")}
                locked={locked}
                lockLabel={
                  selected
                    ? `${t("detail.episodeList")} ${selected.no}`
                    : t("player.empty")
                }
                lockActionLabel={lockActionLabel}
                onUnlock={
                  selected && !isUnlocked(selected) ? () => openVipGate(selected) : undefined
                }
                error={playErr}
                loading={playLoading}
                hasNext={hasNext}
                onNext={playNext}
                onEnded={playNext}
              />
            </div>
            <div className="mt-3 flex justify-center px-3">
              <button
                type="button"
                onClick={() => void enterLandscapeFullscreen()}
                className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-4 py-2 text-[13px] font-medium text-white ring-1 ring-white/12 backdrop-blur-sm"
              >
                <Smartphone className="h-4 w-4 rotate-90" strokeWidth={1.75} />
                {t("player.watchFullscreen")}
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 z-10">
            <VerticalPager
              index={episodeIndex}
              count={data.episodes.length}
              onChange={selectEpisodeByIndex}
              blocked={pagerBlocked || pagerMenusOpen}
              onTap={() => {
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
                      coverUrl={coverUrl}
                      coverFallback={drama.cover}
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
                      objectFit={fillVideo ? "cover" : "contain"}
                      // Shell owns the seek bar above the episode picker; immersive keeps an inset seek.
                      bottomInset={immersiveFs ? 12 : 0}
                      showSeek={immersiveFs}
                      playbackRate={rate}
                      onPlaybackRateChange={setRate}
                      attachMedia={false}
                      src={canPlay && playUrl ? playUrl : null}
                      poster={coverUrl}
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
                      onUnlock={!isUnlocked(ep) ? () => openVipGate(ep) : undefined}
                      error={playErr}
                      loading={playLoading}
                      hasNext={hasNext}
                      onNext={playNext}
                      onEnded={playNext}
                      onSeekingChange={onSeekingChange}
                      tapToToggle={false}
                    />

                    {!immersiveFs ? (
                      <div className="absolute bottom-[10.75rem] right-2.5 z-40 flex flex-col items-center gap-5">
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
                    ) : null}

                    {!immersiveFs ? (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-40 px-3"
                        style={{ bottom: WATCH_INFO_BOTTOM }}
                      >
                        <div className="pointer-events-auto max-w-[calc(100%-4.5rem)]">
                          <button
                            type="button"
                            className="inline-flex max-w-full items-center gap-0.5 text-[17px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]"
                            onClick={() => setDrawerOpen(true)}
                          >
                            <span className="truncate">{title}</span>
                            <ChevronRight className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2.25} />
                          </button>
                          <button
                            type="button"
                            className="mt-1.5 flex w-full items-start text-left text-[13px] leading-5 text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
                            onClick={() => setEpLineExpanded((v) => !v)}
                          >
                            <span className="min-w-0 flex-1">
                              {epLineExpanded ? epLine : epPreview}
                              {!epLineExpanded && epLine.length > 26 && (
                                <span className="ml-1 font-medium text-white">{t("detail.expand")}</span>
                              )}
                            </span>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              }}
            </VerticalPager>
          </div>
        )}

        {/* Letterbox mode keeps overlays outside the pager */}
        {landscapeMode && !immersiveFs ? (
          <>
            <div className="absolute bottom-[10.75rem] right-2.5 z-40 flex flex-col items-center gap-5">
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
            <div
              className="pointer-events-none absolute inset-x-0 z-40 px-3"
              style={{ bottom: WATCH_INFO_BOTTOM }}
            >
              <div className="pointer-events-auto max-w-[calc(100%-4.5rem)]">
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-0.5 text-[17px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]"
                  onClick={() => setDrawerOpen(true)}
                >
                  <span className="truncate">{title}</span>
                  <ChevronRight className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2.25} />
                </button>
                <button
                  type="button"
                  className="mt-1.5 flex w-full items-start text-left text-[13px] leading-5 text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
                  onClick={() => setEpLineExpanded((v) => !v)}
                >
                  <span className="min-w-0 flex-1">
                    {epLineExpanded ? epLine : epPreview}
                    {!epLineExpanded && epLine.length > 26 && (
                      <span className="ml-1 font-medium text-white">{t("detail.expand")}</span>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </>
        ) : null}

        {/* Resume toast */}
        {resumeToast && !immersiveFs ? (
          <div className="absolute inset-x-0 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex justify-center px-4">
            <div className="flex max-w-[92%] items-center gap-2 rounded-full bg-black/70 px-3.5 py-2 text-[12px] text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md">
              <span className="truncate">
                {t("player.resumeToast", { time: resumeTimeLabel })}
              </span>
              <button
                type="button"
                className="shrink-0 font-medium text-[#ff9a3d]"
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
                className="shrink-0 text-white/55"
                onClick={() => setResumeToast(false)}
                aria-label={t("close")}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        {/* Seek above episode picker (portrait + letterbox) */}
        {!immersiveFs ? (
          <div className="absolute inset-x-0 bottom-0 z-40 flex flex-col">
            <WatchSeekBar
              videoRef={videoRef}
              absolute={false}
              disabled={!playUrl || needsLogin || locked}
              onSeekingChange={onSeekingChange}
              className="pb-0.5"
            />
            <div
              className="px-2.5 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1"
              style={{ minHeight: WATCH_BAR_H }}
            >
              <div className="flex h-11 items-stretch overflow-hidden rounded-xl bg-[#2a2c2c]/92 text-white shadow-[0_-2px_16px_rgba(0,0,0,0.25)] ring-1 ring-white/8 backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3.5"
                >
                  <span className="truncate text-[13px] font-medium">
                    {t("detail.pickEpisodesBar", { n: drama.episodesCount })}
                  </span>
                  <ChevronUp className="h-4 w-4 shrink-0 opacity-85" />
                </button>
                <span className="my-2.5 w-px shrink-0 bg-white/15" aria-hidden />
                <button
                  type="button"
                  onClick={() =>
                    void (landscapeMode
                      ? enterLandscapeFullscreen()
                      : enterPortraitFullscreen())
                  }
                  className="grid w-12 shrink-0 place-items-center"
                  aria-label={t("player.fullscreen")}
                >
                  <Maximize className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void exitImmersiveFs()}
            className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-50 grid h-10 w-10 place-items-center rounded-[10px] bg-black/40 text-white backdrop-blur-sm"
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
          onUnlock={openVipGate}
          onSelect={selectEpisode}
          favorited={favorited}
          onToggleFavorite={() => void toggleFavorite()}
        />
      </div>
    );
  }

  /* ---- Watching: desktop theater (Hongguo split: player + sidebar) ---- */
  if (watching && !isMobile) {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col bg-[#181a1a]">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-4 md:px-5">
          <button
            type="button"
            onClick={() => setWatching(false)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[14px] text-white/85 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="max-w-[42vw] truncate">{title}</span>
          </button>
          <span className="text-[13px] text-white/45">
            {selected ? t("detail.episodeLabel", { n: selected.no }) : null}
          </span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1 bg-black">
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
              onUnlock={selected && !isUnlocked(selected) ? () => openVipGate(selected) : undefined}
              error={playErr}
              loading={playLoading}
              hasNext={hasNext}
              onNext={playNext}
              onEnded={playNext}
              title={selected ? `${title} · ${t("detail.episodeLabel", { n: selected.no })}` : title}
              onOpenEpisodes={() => setDrawerOpen(true)}
            />
          </div>

          <aside className="hidden w-[360px] shrink-0 flex-col overflow-hidden border-l border-white/[0.06] bg-[#121212] lg:flex">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="mb-5 flex gap-3">
                <div className="relative h-[84px] w-[60px] shrink-0 overflow-hidden rounded-md bg-white/[0.06]">
                  {coverIsImg ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={drama.cover[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div
                      className="h-full w-full"
                      style={{
                        background: `linear-gradient(150deg, ${drama.cover[0]}, ${drama.cover[1]})`,
                      }}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="line-clamp-2 text-[18px] font-medium leading-7 text-white/90">
                    {title}
                  </h1>
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-white/[0.08] px-2 py-0.5 text-[12px] text-white/65"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {desc ? (
                <div className="mb-6">
                  <h2 className="mb-2 text-[14px] font-medium text-white/80">{t("detail.basicInfo")}</h2>
                  <p className="line-clamp-3 text-[13px] leading-6 text-white/40">{desc}</p>
                </div>
              ) : null}

              <EpisodeList
                episodes={data.episodes}
                episodesCount={drama.episodesCount}
                selectedNo={selected?.no}
                layout="sidebar"
                isUnlocked={isUnlocked}
                onUnlock={openVipGate}
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
          onUnlock={openVipGate}
          onSelect={selectEpisode}
          favorited={favorited}
          onToggleFavorite={() => void toggleFavorite()}
        />

      </div>
    );
  }

  /* ---- Browse: Hongguo detail (desktop only; mobile never lands here) ---- */
  if (isMobile) {
    return <div className="fixed inset-0 z-[70] bg-black" aria-busy="true" />;
  }

  return (
    <div className="relative overflow-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-24">
      {/* Desktop backdrop — warm orange glow like hongguo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[min(920px,100%)] overflow-hidden md:block">
        {coverIsImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
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
              // eslint-disable-next-line @next/next/no-img-element
              <img src={drama.cover[0]} alt="" className="h-full w-full object-cover" />
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
                    key={tag}
                    className="inline-flex max-w-[6.5rem] items-center truncate rounded bg-[hsla(0,0%,88%,0.06)] px-2 py-1.5 text-[12px] leading-none text-white/70 md:h-8 md:max-w-[150px] md:rounded-md md:bg-[hsla(0,0%,88%,0.08)] md:px-2.5 md:py-0 md:text-[16px] md:text-white/80"
                  >
                    {tag}
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(drama.creator.avatarUrl)!}
                      alt=""
                      className="h-full w-full object-cover"
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
            onUnlock={openVipGate}
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

    </div>
  );
}

function WatchEpisodePeek({
  coverUrl,
  coverFallback,
  label,
  title,
}: {
  coverUrl?: string;
  coverFallback: string[];
  label: string;
  title: string;
}) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-black">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div
          className="h-full w-full"
          style={{
            background: `linear-gradient(150deg, ${coverFallback[0]}, ${coverFallback[1] || coverFallback[0]})`,
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25" />
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
