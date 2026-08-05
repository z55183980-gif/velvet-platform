"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Play } from "lucide-react";
import { cn } from "@/lib/utils";

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function readDuration(v: HTMLVideoElement) {
  const d = v.duration;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

type FeedEpisodeBarProps = {
  href: string;
  label: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** When false, show CTA only (locked / login / no src). */
  seekEnabled?: boolean;
  /** Rebind when underlying media identity changes (e.g. playUrl). */
  mediaKey?: string | null;
  onSeekingChange?: (seeking: boolean) => void;
  className?: string;
};

/**
 * Home-feed episode strip: CTA row + progress flush to the bottom edge
 * (rounded top corners, sits above the tab bar).
 */
export function FeedEpisodeBar({
  href,
  label,
  videoRef,
  seekEnabled = true,
  mediaKey,
  onSeekingChange,
  className,
}: FeedEpisodeBarProps) {
  const seekRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [dragging, setDragging] = useState(false);
  const durationRef = useRef(0);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (!seekEnabled) {
      setCurrent(0);
      setDuration(0);
      setBuffered(0);
      return;
    }

    let cancelled = false;
    let attached: HTMLVideoElement | null = null;
    let raf = 0;

    const onTime = () => {
      const v = attached;
      if (!v || dragging) return;
      setCurrent(v.currentTime || 0);
      const d = readDuration(v);
      if (d > 0 && d !== durationRef.current) setDuration(d);
    };
    const onMeta = () => {
      const v = attached;
      if (!v) return;
      const d = readDuration(v);
      if (d > 0) setDuration(d);
    };
    const onProg = () => {
      const v = attached;
      if (!v) return;
      try {
        const d = readDuration(v);
        if (v.buffered.length > 0 && d > 0) {
          setBuffered(v.buffered.end(v.buffered.length - 1) / d);
        }
      } catch {
        /* ignore */
      }
    };

    const detach = () => {
      if (!attached) return;
      attached.removeEventListener("timeupdate", onTime);
      attached.removeEventListener("loadedmetadata", onMeta);
      attached.removeEventListener("durationchange", onMeta);
      attached.removeEventListener("progress", onProg);
      attached = null;
    };

    const attach = (v: HTMLVideoElement) => {
      detach();
      attached = v;
      attached.addEventListener("timeupdate", onTime);
      attached.addEventListener("loadedmetadata", onMeta);
      attached.addEventListener("durationchange", onMeta);
      attached.addEventListener("progress", onProg);
      onTime();
      onMeta();
      onProg();
    };

    // video mounts after playUrl (key={src}) — poll until ref is live, then keep in sync.
    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (v && v !== attached) {
        attach(v);
      } else if (v && !dragging && !v.paused && !v.ended) {
        // iOS/WebKit can under-fire timeupdate; mirror watch-seek-bar rAF sync.
        setCurrent(v.currentTime || 0);
        const d = readDuration(v);
        if (d > 0 && d !== durationRef.current) setDuration(d);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      detach();
    };
  }, [videoRef, seekEnabled, mediaKey, dragging]);

  const setSeeking = useCallback(
    (next: boolean) => {
      setDragging(next);
      onSeekingChange?.(next);
    },
    [onSeekingChange],
  );

  useEffect(() => {
    return () => {
      onSeekingChange?.(false);
    };
  }, [onSeekingChange]);

  const seekToRatio = (ratio: number) => {
    const v = videoRef.current;
    const d = durationRef.current;
    if (!v || !d) return;
    const next = Math.max(0, Math.min(d, ratio * d));
    v.currentTime = next;
    setCurrent(next);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, setSeeking]);

  const progress = duration > 0 ? current / duration : 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-t-[12px] bg-black/55 backdrop-blur-md",
        className,
      )}
      data-no-tap
    >
      <Link
        href={href}
        className="flex h-8 items-center gap-2 px-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-white/85"
          aria-hidden
        >
          <Play className="h-2.5 w-2.5 fill-white text-white" strokeWidth={0} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-none tracking-wide">
          {label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={2} />
      </Link>

      {seekEnabled ? (
        <div
          className="relative"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {dragging ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 text-center text-[11px] tabular-nums text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
              {fmtTime(current)} / {fmtTime(duration)}
            </div>
          ) : null}
          <div
            ref={seekRef}
            className="relative h-3.5 touch-none select-none cursor-pointer"
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
            }}
          >
            <div
              className={cn(
                // Center in the hit area so the scrubber thumb isn't clipped
                // by overflow-hidden / the tab bar edge below the feed stage.
                "absolute inset-x-2 top-1/2 -translate-y-1/2 overflow-visible bg-white/20 transition-[height] duration-150",
                dragging ? "h-1.5" : "h-[2px]",
              )}
            >
              <div
                className="absolute inset-y-0 left-0 bg-white/30"
                style={{ width: `${buffered * 100}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-white"
                style={{ width: `${progress * 100}%` }}
              />
              <div
                className={cn(
                  "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_3px_rgba(0,0,0,0.45)] transition-transform duration-150",
                  dragging ? "h-3 w-3 scale-110" : "h-2 w-2",
                )}
                style={{ left: `${progress * 100}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="h-[2px] bg-white/15" aria-hidden />
      )}
    </div>
  );
}
