"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Play,
  Pause,
  Maximize,
  Minimize,
  SkipForward,
  Volume2,
  VolumeX,
  Crown,
  ListVideo,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "./ui/button";

const ACCENT = "#ff7e0d";
const RATES = [0.75, 1, 1.25, 1.5, 2] as const;

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function safePlay(video: HTMLVideoElement) {
  return video.play().catch(() => {});
}

export function VideoPlayer({
  src,
  poster,
  autoPlay,
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
  fill,
  onOpenEpisodes,
  title,
}: {
  src?: string | null;
  poster?: string;
  autoPlay?: boolean;
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
  /** Fill parent height (Hongguo theater pane) instead of 16:9 */
  fill?: boolean;
  onOpenEpisodes?: () => void;
  title?: string;
}) {
  const { t } = useLocale();
  const innerRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef ?? innerRef;
  const shellRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [fs, setFs] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const [rate, setRate] = useState(1);
  const [showRate, setShowRate] = useState(false);
  const [showVol, setShowVol] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpChrome = useCallback(() => {
    setShowChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (
        videoRef.current &&
        !videoRef.current.paused &&
        !showRate &&
        !showVol &&
        !dragging
      ) {
        setShowChrome(false);
      }
    }, 2800);
  }, [videoRef, showRate, showVol, dragging]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

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
    if (!v || !src) return;
    if (v.paused) void safePlay(v);
    else v.pause();
    bumpChrome();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    bumpChrome();
  };

  const setVol = (n: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(1, n));
    v.volume = next;
    v.muted = next === 0;
    setVolume(next);
    setMuted(next === 0);
  };

  const seekToRatio = useCallback(
    (ratio: number) => {
      const v = videoRef.current;
      if (!v || !duration) return;
      v.currentTime = Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration, videoRef],
  );

  const ratioFromEvent = (clientX: number) => {
    const el = seekRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => seekToRatio(ratioFromEvent(e.clientX));
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, seekToRatio]);

  const toggleFs = async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setFs(true);
      } else {
        await document.exitFullscreen();
        setFs(false);
      }
    } catch {
      /* ignore */
    }
    bumpChrome();
  };

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  let overlay: ReactNode = null;
  if (loginRequired) {
    overlay = (
      <Overlay>
        <p className="text-[18px] font-medium text-white/95">{t("player.loginToWatch")}</p>
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
          <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/40" />
        <div className="relative flex flex-col items-center gap-5 px-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-gold/15 text-gold backdrop-blur">
            <Crown className="h-6 w-6" />
          </span>
          <p className="text-[20px] font-medium text-white">{lockLabel}</p>
          <p className="max-w-xs text-[14px] leading-6 text-white/55">{t("vip.inactiveHint")}</p>
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
        <p className="text-body-sm text-white/50">{t("player.loading")}</p>
      </Overlay>
    );
  }

  const progress = duration > 0 ? current / duration : 0;
  const chromeVisible = showChrome || !playing || showRate || showVol || dragging;

  return (
    <div
      ref={shellRef}
      className={cn(
        "group/player relative w-full overflow-hidden bg-black",
        fill ? "h-full min-h-0" : "aspect-video",
      )}
      onMouseMove={bumpChrome}
      onClick={() => {
        if (!locked && !loginRequired && src) togglePlay();
      }}
    >
      {src && !locked && !loginRequired ? (
        <video
          ref={videoRef}
          key={src}
          src={/\.m3u8(\?|$)/i.test(src) ? undefined : src}
          autoPlay={autoPlay}
          playsInline
          className="absolute inset-0 h-full w-full bg-black object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}

      {overlay}

      {/* Center play — Hongguo / xgplayer style */}
      {src && !locked && !loginRequired && !error && !playing && !loading && (
        <button
          type="button"
          aria-label={t("player.play")}
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          className="absolute left-1/2 top-1/2 z-[6] grid h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-opacity hover:bg-black/55"
        >
          <Play className="ml-1 h-8 w-8 fill-white" />
        </button>
      )}

      {src && !locked && !loginRequired && !error && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 transition-opacity duration-200",
            chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
            style={{
              background: "linear-gradient(180deg, transparent, rgba(0,0,0,.55))",
            }}
          />

          {title && (
            <div className="relative px-4 pb-1">
              <p className="truncate text-[14px] font-medium text-white/90 drop-shadow">{title}</p>
            </div>
          )}

          {/* Progress */}
          <div className="relative px-3 pb-1">
            <div
              ref={seekRef}
              className="group/seek relative h-5 cursor-pointer"
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(true);
                seekToRatio(ratioFromEvent(e.clientX));
                bumpChrome();
              }}
            >
              <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                  style={{ width: `${buffered * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${progress * 100}%`, background: ACCENT }}
                />
              </div>
              <div
                className={cn(
                  "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-transform",
                  "opacity-0 group-hover/seek:opacity-100",
                  dragging && "opacity-100 scale-110",
                )}
                style={{ left: `calc(${progress * 100}% - 7px)`, background: ACCENT }}
              />
            </div>
          </div>

          {/* Controls row */}
          <div className="relative flex items-center gap-0.5 px-2 pb-3 text-white">
            <IconBtn onClick={togglePlay} label={playing ? t("player.pause") : t("player.play")}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-white" />}
            </IconBtn>

            {hasNext && (
              <IconBtn onClick={() => onNext?.()} label={t("player.next")}>
                <SkipForward className="h-5 w-5" />
              </IconBtn>
            )}

            <div
              className="relative flex items-center"
              onMouseEnter={() => setShowVol(true)}
              onMouseLeave={() => setShowVol(false)}
            >
              <IconBtn onClick={toggleMute} label={muted ? t("player.unmute") : t("player.mute")}>
                {muted || volume === 0 ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </IconBtn>
              <div
                className={cn(
                  "flex h-8 items-center overflow-hidden transition-all duration-150",
                  showVol ? "ml-1 w-20 opacity-100" : "w-0 opacity-0",
                )}
              >
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  aria-label={t("player.volume")}
                  onChange={(e) => setVol(Number(e.target.value))}
                  className="h-1 w-full cursor-pointer accent-[#ff7e0d]"
                />
              </div>
            </div>

            <span className="ml-1 select-none text-[12px] tabular-nums text-white/80">
              {fmtTime(current)}
              <span className="text-white/40"> / </span>
              {fmtTime(duration)}
            </span>

            <div className="flex-1" />

            <div className="relative">
              <IconBtn
                onClick={() => {
                  setShowRate((v) => !v);
                  bumpChrome();
                }}
                label={t("player.speed")}
              >
                <span className="flex items-center gap-0.5 text-[12px] font-medium tabular-nums">
                  <Gauge className="h-4 w-4" />
                  {rate === 1 ? "1x" : `${rate}x`}
                </span>
              </IconBtn>
              {showRate && (
                <div className="absolute bottom-full right-0 mb-2 min-w-[88px] overflow-hidden rounded-lg bg-[#1c1e1e] py-1 shadow-lg ring-1 ring-white/10">
                  {RATES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setRate(r);
                        setShowRate(false);
                        bumpChrome();
                      }}
                      className={cn(
                        "flex w-full items-center justify-center px-3 py-2 text-[13px] transition-colors",
                        r === rate ? "text-[#ff7e0d]" : "text-white/80 hover:bg-white/5",
                      )}
                    >
                      {r === 1 ? t("player.speedNormal") : `${r}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {onOpenEpisodes && (
              <IconBtn onClick={onOpenEpisodes} label={t("player.episodes")}>
                <ListVideo className="h-5 w-5" />
              </IconBtn>
            )}

            <IconBtn
              onClick={toggleFs}
              label={fs ? t("player.exitFullscreen") : t("player.fullscreen")}
            >
              {fs ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </IconBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function isImg(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

function Overlay({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 p-6",
        dim ? "" : "bg-black/50",
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
      className="grid h-9 min-w-9 place-items-center rounded-md px-1.5 text-white/90 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}
