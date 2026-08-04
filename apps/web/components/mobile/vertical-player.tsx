"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Crown,
  ListVideo,
  SkipForward,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { WatchSeekBar } from "@/components/mobile/watch-seek-bar";

const ACCENT = "#ff7e0d";
export const PLAYER_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const RATES = PLAYER_RATES;

/** full = desktop-style chrome; feed = 首页流; watch = 剧集内观看 */
export type VerticalPlayerChrome = "full" | "feed" | "watch";

function isImg(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function isHlsUrl(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

function safePlay(video: HTMLVideoElement) {
  // NotSupportedError when src not attached yet / unsupported — never let it bubble to Next overlay.
  return video.play().catch(() => {});
}

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VerticalPlayer({
  src,
  poster,
  autoPlay,
  muted: mutedProp,
  onMutedChange,
  onEnded,
  onNext,
  hasNext,
  locked,
  lockLabel,
  lockActionLabel,
  onUnlock,
  loginRequired,
  onLogin,
  onRegister,
  error,
  loading,
  seekTo,
  videoRef: externalRef,
  title,
  subtitle,
  onOpenEpisodes,
  active = true,
  chrome = "full",
  bottomInset = 0,
  objectFit = "cover",
  showSeek = true,
  playbackRate,
  onPlaybackRateChange,
  onSeekingChange,
  /** When false, parent owns HLS/src attach (e.g. drama-detail quality picker). Default true. */
  attachMedia = true,
  /** Local tap-to-toggle. Disable when a parent pager owns tap gestures. */
  tapToToggle = true,
}: {
  src?: string | null;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  onMutedChange?: (m: boolean) => void;
  onEnded?: () => void;
  onNext?: () => void;
  hasNext?: boolean;
  locked?: boolean;
  lockLabel?: string;
  lockActionLabel?: string;
  onUnlock?: () => void;
  loginRequired?: boolean;
  onLogin?: () => void;
  onRegister?: () => void;
  error?: string | null;
  loading?: boolean;
  seekTo?: number | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  title?: string;
  subtitle?: string;
  onOpenEpisodes?: () => void;
  active?: boolean;
  chrome?: VerticalPlayerChrome;
  /** Extra space below thin progress (watch page action bar) */
  bottomInset?: number;
  attachMedia?: boolean;
  objectFit?: "cover" | "contain";
  showSeek?: boolean;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  /** Fired when the feed/full scrubber drag starts or ends (for parent gesture locking). */
  onSeekingChange?: (seeking: boolean) => void;
  tapToToggle?: boolean;
}) {
  const { t } = useLocale();
  const innerRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef ?? innerRef;
  const seekRef = useRef<HTMLDivElement>(null);
  const tapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(mutedProp ?? true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [showChrome, setShowChrome] = useState(true);
  const [rate, setRate] = useState(playbackRate ?? 1);
  const [showRate, setShowRate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (playbackRate != null && playbackRate !== rate) setRate(playbackRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackRate]);

  const applyRate = (r: number) => {
    setRate(r);
    onPlaybackRateChange?.(r);
  };

  const bumpChrome = useCallback(() => {
    setShowChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !showRate && !dragging) {
        setShowChrome(false);
      }
    }, 2600);
  }, [videoRef, showRate, dragging]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (mutedProp != null) setMuted(mutedProp);
  }, [mutedProp]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
  }, [muted, videoRef]);

  // Attach media source here so play() is never called against an empty <video>.
  // Parents that own HLS (drama-detail quality UI) pass attachMedia={false}.
  useEffect(() => {
    const v = videoRef.current;
    if (!attachMedia || !v || !src || locked || loginRequired) return;

    let cancelled = false;
    let hls: { destroy: () => void } | null = null;

    const clearSrc = () => {
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
    };

    if (!isHlsUrl(src)) {
      v.src = src;
      return () => {
        cancelled = true;
        clearSrc();
      };
    }

    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = src;
      return () => {
        cancelled = true;
        clearSrc();
      };
    }

    (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (cancelled || !Hls.isSupported()) return;
        const instance = new Hls({ enableWorker: true });
        hls = instance;
        instance.loadSource(src);
        instance.attachMedia(v);
      } catch {
        /* ignore — play() stay no-ops until user retries */
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      clearSrc();
    };
  }, [attachMedia, src, locked, loginRequired, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!active) {
      v.pause();
      return;
    }
    if (!autoPlay || !src || locked || loginRequired) return;

    const tryPlay = () => {
      if (!v.paused) return;
      void safePlay(v);
    };
    tryPlay();
    v.addEventListener("canplay", tryPlay);
    v.addEventListener("loadeddata", tryPlay);
    return () => {
      v.removeEventListener("canplay", tryPlay);
      v.removeEventListener("loadeddata", tryPlay);
    };
  }, [active, autoPlay, src, locked, loginRequired, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(v.currentTime);
    const onMeta = () => setDuration(v.duration || 0);
    const onProg = () => {
      try {
        if (v.buffered.length > 0 && v.duration > 0) {
          setBuffered(v.buffered.end(v.buffered.length - 1) / v.duration);
        }
      } catch {
        /* ignore */
      }
    };
    const onEnd = () => onEnded?.();
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("progress", onProg);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("progress", onProg);
      v.removeEventListener("ended", onEnd);
    };
  }, [src, onEnded, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || seekTo == null || seekTo <= 5) return;
    const apply = () => {
      try {
        v.currentTime = seekTo;
      } catch {
        /* ignore */
      }
    };
    if (v.readyState >= 1) apply();
    else v.addEventListener("loadedmetadata", apply, { once: true });
  }, [seekTo, src, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
  }, [rate, videoRef, src]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || !src || locked || loginRequired) return;
    if (v.paused) void safePlay(v);
    else v.pause();
    bumpChrome();
  };

  const onTapPointerDown = (e: ReactPointerEvent) => {
    if (!tapToToggle) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target;
    if (target instanceof Element && target.closest("button, a, input, [data-no-tap], [role='slider']")) {
      tapRef.current = null;
      return;
    }
    tapRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  const onTapPointerUp = (e: ReactPointerEvent) => {
    if (!tapToToggle) return;
    const tap = tapRef.current;
    tapRef.current = null;
    if (!tap) return;
    if (performance.now() - tap.t > 420) return;
    if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) return;
    togglePlay();
  };

  const onTapPointerCancel = () => {
    tapRef.current = null;
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    onMutedChange?.(next);
    bumpChrome();
  };

  const setSeeking = useCallback(
    (next: boolean) => {
      setDragging(next);
      onSeekingChange?.(next);
    },
    [onSeekingChange],
  );

  const seekToRatio = (ratio: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = Math.max(0, Math.min(duration, ratio * duration));
  };

  const ratioFromEvent = (clientX: number) => {
    const el = seekRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => seekToRatio(ratioFromEvent(e.clientX));
    const onUp = () => setSeeking(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, duration, setSeeking]);

  // Always clear parent gesture lock on unmount / callback swap.
  useEffect(() => {
    return () => {
      onSeekingChange?.(false);
    };
  }, [onSeekingChange]);

  let overlay: ReactNode = null;
  if (loginRequired) {
    overlay = (
      <Overlay>
        <p className="text-[18px] font-medium text-white">{t("player.loginToWatch")}</p>
        <button
          className={buttonVariants({ variant: "primary", size: "lg" })}
          onClick={onRegister ?? onLogin}
          style={{ background: `linear-gradient(92.27deg, ${ACCENT} 0.32%, #ff9233)` }}
        >
          {t("player.freeRegister")}
        </button>
        {onLogin ? (
          <button
            type="button"
            onClick={onLogin}
            className="text-[14px] text-white/75 underline-offset-2 hover:text-white hover:underline"
          >
            {t("player.hasAccountLogin")}
          </button>
        ) : null}
      </Overlay>
    );
  } else if (locked) {
    overlay = (
      <Overlay dim>
        {poster && isImg(poster) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/30" />
        <div className="relative flex flex-col items-center gap-4 px-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-gold/15 text-gold backdrop-blur">
            <Crown className="h-6 w-6" />
          </span>
          <p className="text-[18px] font-medium text-white">{lockLabel}</p>
          <p className="max-w-xs text-[13px] leading-5 text-white/55">{t("vip.inactiveHint")}</p>
          {onUnlock && (
            <button
              className={buttonVariants({ variant: "primary", size: "lg" })}
              onClick={onUnlock}
              style={{ background: `linear-gradient(92.27deg, ${ACCENT} 0.32%, #ff9233)` }}
            >
              {lockActionLabel || t("vip.open")}
            </button>
          )}
        </div>
      </Overlay>
    );
  } else if (error) {
    overlay = (
      <Overlay>
        <p className="text-body text-danger">{error}</p>
      </Overlay>
    );
  } else if (loading) {
    overlay = (
      <Overlay>
        <p className="text-body-sm text-white/70">{t("player.loading")}</p>
      </Overlay>
    );
  }

  const progress = duration > 0 ? current / duration : 0;
  const isMinimal = chrome === "feed" || chrome === "watch";
  const chromeVisible = isMinimal || showChrome || !playing || showRate || dragging;

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden",
        chrome === "feed" ? "bg-base" : "bg-black",
      )}
      onPointerDown={(e) => {
        if (!isMinimal) bumpChrome();
        onTapPointerDown(e);
      }}
      onPointerUp={onTapPointerUp}
      onPointerCancel={onTapPointerCancel}
    >
      {src && !locked && !loginRequired ? (
        <video
          ref={videoRef}
          key={src}
          src={/\.m3u8(\?|$)/i.test(src) ? undefined : src}
          autoPlay={autoPlay && active}
          playsInline
          muted={muted}
          loop={chrome === "feed"}
          className={cn(
            "absolute inset-0 h-full w-full",
            objectFit === "contain" ? "object-contain" : "object-cover",
          )}
        />
      ) : poster && isImg(poster) && !overlay ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className={cn(
            "absolute inset-0 h-full w-full",
            objectFit === "contain" ? "object-contain" : "object-cover",
          )}
        />
      ) : null}

      {poster && isImg(poster) && !src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}

      {overlay}

      {src && !locked && !loginRequired && !error && !playing && !loading && (
        <button
          type="button"
          aria-label={t("player.play")}
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          className="absolute left-1/2 top-1/2 z-[6] grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm"
        >
          <Play className="ml-0.5 h-7 w-7 fill-white" />
        </button>
      )}

      {!isMinimal && (title || subtitle) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/35 to-transparent px-4 pb-20 pt-28">
          <div className="pointer-events-auto max-w-[85%]">
            {title && <h2 className="text-[17px] font-semibold text-white drop-shadow">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] text-white/75">{subtitle}</p>}
          </div>
        </div>
      )}

      {src && !locked && !loginRequired && !error && chrome === "watch" && showSeek ? (
        <WatchSeekBar videoRef={videoRef} bottom={bottomInset} />
      ) : null}

      {src && !locked && !loginRequired && !error && !isMinimal && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8 transition-opacity",
            chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={seekRef}
            className="group/seek relative mb-2 h-5 touch-none select-none cursor-pointer"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
              setSeeking(true);
              seekToRatio(ratioFromEvent(e.clientX));
              bumpChrome();
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/30"
                style={{ width: `${buffered * 100}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${progress * 100}%`, background: ACCENT }}
              />
            </div>
            <div
              className={cn(
                "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full shadow",
                dragging ? "opacity-100" : "opacity-90",
              )}
              style={{ left: `calc(${progress * 100}% - 6px)`, background: ACCENT }}
            />
          </div>

          <div className="mb-1 flex items-center justify-between text-[11px] tabular-nums text-white/65">
            <span>{fmtTime(current)}</span>
            <span>{fmtTime(duration)}</span>
          </div>

          <div className="flex items-center gap-1 text-white">
            <IconBtn onClick={togglePlay} label={playing ? t("player.pause") : t("player.play")}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-white" />}
            </IconBtn>
            {hasNext && (
              <IconBtn onClick={() => onNext?.()} label={t("player.next")}>
                <SkipForward className="h-5 w-5" />
              </IconBtn>
            )}
            <IconBtn onClick={toggleMute} label={muted ? t("player.unmute") : t("player.mute")}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </IconBtn>

            <div className="relative">
              <IconBtn
                onClick={() => {
                  setShowRate((v) => !v);
                  bumpChrome();
                }}
                label={t("player.speed")}
              >
                <span className="flex items-center gap-0.5 text-[12px] font-medium">
                  <Gauge className="h-4 w-4" />
                  {rate === 1 ? "1x" : `${rate}x`}
                </span>
              </IconBtn>
              {showRate && (
                <div className="absolute bottom-full left-0 mb-2 min-w-[84px] overflow-hidden rounded-lg bg-[#1c1e1e] py-1 shadow-lg ring-1 ring-white/10">
                  {RATES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        applyRate(r);
                        setShowRate(false);
                        bumpChrome();
                      }}
                      className={cn(
                        "flex w-full items-center justify-center px-3 py-2 text-[13px]",
                        r === rate ? "text-[#ff7e0d]" : "text-white/80",
                      )}
                    >
                      {r === 1 ? t("player.speedNormal") : `${r}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1" />
            {onOpenEpisodes && (
              <IconBtn onClick={onOpenEpisodes} label={t("player.episodes")}>
                <ListVideo className="h-5 w-5" />
              </IconBtn>
            )}
          </div>
        </div>
      )}

      {!src && !locked && !loginRequired && !loading && (
        <div className="absolute inset-0 z-[6] flex items-center justify-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/45 text-white backdrop-blur">
            <Play className="h-7 w-7 fill-white" />
          </span>
        </div>
      )}
    </div>
  );
}

function Overlay({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 p-6",
        dim ? "" : "bg-black/55",
      )}
    >
      {children}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-10 min-w-10 place-items-center rounded-md px-1.5 text-white/90 transition-colors hover:bg-white/10"
    >
      {children}
    </button>
  );
}
