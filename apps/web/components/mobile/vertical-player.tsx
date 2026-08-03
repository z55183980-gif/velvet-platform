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
  Volume2,
  VolumeX,
  Lock,
  ListVideo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";

function isImg(s: string) {
  return /^https?:\/\//.test(s) || s.startsWith("/");
}

export function VerticalPlayer({
  src,
  poster,
  autoPlay,
  muted: mutedProp,
  onMutedChange,
  onEnded,
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
  title,
  subtitle,
  onOpenEpisodes,
  active = true,
}: {
  src?: string | null;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  onMutedChange?: (m: boolean) => void;
  onEnded?: () => void;
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
  title?: string;
  subtitle?: string;
  onOpenEpisodes?: () => void;
  active?: boolean;
}) {
  const { t } = useLocale();
  const innerRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef ?? innerRef;
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(mutedProp ?? true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showChrome, setShowChrome] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpChrome = useCallback(() => {
    setShowChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowChrome(false);
    }, 2400);
  }, [videoRef]);

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

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!active) {
      v.pause();
      return;
    }
    if (autoPlay && src && !locked && !loginRequired) {
      void v.play().catch(() => {});
    }
  }, [active, autoPlay, src, locked, loginRequired, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(v.currentTime);
    const onMeta = () => setDuration(v.duration || 0);
    const onEnd = () => onEnded?.();
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
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

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || !src || locked || loginRequired) return;
    if (v.paused) void v.play();
    else v.pause();
    bumpChrome();
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    onMutedChange?.(next);
    bumpChrome();
  };

  const seek = (ratio: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = Math.max(0, Math.min(duration, ratio * duration));
  };

  let overlay: ReactNode = null;
  if (loginRequired) {
    overlay = (
      <Overlay>
        <p className="text-h4 font-semibold text-white">{t("nav.login")}</p>
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
          <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/30" />
        <div className="relative flex flex-col items-center gap-4 px-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/10 text-white backdrop-blur">
            <Lock className="h-6 w-6" />
          </span>
          <p className="text-h4 font-semibold text-white">{lockLabel}</p>
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
        <p className="text-body-sm text-white/70">{t("player.loading")}</p>
      </Overlay>
    );
  }

  const progress = duration > 0 ? current / duration : 0;

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-black"
      onClick={togglePlay}
      onPointerDown={bumpChrome}
    >
      {src && !locked && !loginRequired ? (
        <video
          ref={videoRef}
          key={src}
          src={/\.m3u8(\?|$)/i.test(src) ? undefined : src}
          autoPlay={autoPlay && active}
          playsInline
          muted={muted}
          loop={false}
          className="absolute inset-0 h-full w-full object-cover"
          onClick={(e) => e.stopPropagation()}
        />
      ) : poster && isImg(poster) && !overlay ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}

      {poster && isImg(poster) && !src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}

      {overlay}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-6 pt-24">
        <div className="pointer-events-auto max-w-[85%]">
          {title && <h2 className="text-h4 font-bold text-white drop-shadow">{title}</h2>}
          {subtitle && <p className="mt-1 text-body-sm text-white/80">{subtitle}</p>}
        </div>
      </div>

      {src && !locked && !loginRequired && !error && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 px-3 pb-3 pt-8 transition-opacity",
            showChrome || !playing ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="mb-3 h-1 cursor-pointer rounded-full bg-white/25"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - rect.left) / rect.width);
            }}
          >
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-2 text-white">
            <IconBtn onClick={togglePlay} label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </IconBtn>
            <IconBtn onClick={toggleMute} label="Mute">
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </IconBtn>
            <div className="flex-1" />
            {onOpenEpisodes && (
              <IconBtn onClick={onOpenEpisodes} label="Episodes">
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
      className="grid h-10 w-10 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/10"
    >
      {children}
    </button>
  );
}
