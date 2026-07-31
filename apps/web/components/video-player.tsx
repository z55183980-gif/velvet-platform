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
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "./ui/button";

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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
  error,
  loading,
  seekTo,
  videoRef: externalRef,
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
  error?: string | null;
  loading?: boolean;
  seekTo?: number | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const { t, locale } = useLocale();
  const innerRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef ?? innerRef;
  const shellRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fs, setFs] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpChrome = useCallback(() => {
    setShowChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowChrome(false);
    }, 2800);
  }, [videoRef]);

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
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("ended", () => onEnded?.());
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
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

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || !src) return;
    if (v.paused) void v.play();
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

  const seek = (ratio: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = Math.max(0, Math.min(duration, ratio * duration));
  };

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
        <p className="text-h4 font-semibold text-white">
          {locale === "zh" ? "登录后观看" : "Đăng nhập để xem"}
        </p>
        <button className={buttonVariants({ variant: "primary", size: "lg" })} onClick={onLogin}>
          {t("nav.login")}
        </button>
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
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/10 text-white backdrop-blur">
            <Lock className="h-6 w-6" />
          </span>
          <p className="text-h3 font-semibold text-white">{lockLabel}</p>
          {onUnlock && (
            <button className={buttonVariants({ variant: "primary", size: "lg" })} onClick={onUnlock}>
              {lockActionLabel}
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
        <p className="text-body-sm text-ink-muted">{t("player.loading")}</p>
      </Overlay>
    );
  }

  const progress = duration > 0 ? current / duration : 0;

  return (
    <div
      ref={shellRef}
      className="group/player relative aspect-video w-full overflow-hidden bg-black"
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

      {src && !locked && !loginRequired && !error && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-3 pb-3 pt-10 transition-opacity duration-[var(--dur-base)]",
            showChrome || !playing ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="group/seek mb-3 h-1.5 cursor-pointer rounded-full bg-white/20"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - rect.left) / rect.width);
            }}
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-75"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          <div className="flex items-center gap-2 text-white">
            <IconBtn onClick={togglePlay} label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </IconBtn>
            {hasNext && (
              <IconBtn onClick={() => onNext?.()} label="Next">
                <SkipForward className="h-5 w-5" />
              </IconBtn>
            )}
            <IconBtn onClick={toggleMute} label="Mute">
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </IconBtn>
            <span className="ml-1 text-caption tabular-nums text-white/80">
              {fmtTime(current)} / {fmtTime(duration)}
            </span>
            <div className="flex-1" />
            <IconBtn onClick={toggleFs} label="Fullscreen">
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
      className="grid h-9 w-9 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}
