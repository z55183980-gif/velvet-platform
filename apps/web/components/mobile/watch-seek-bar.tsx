"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function readDuration(v: HTMLVideoElement) {
  const d = v.duration;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

type WatchSeekBarProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  bottom?: number;
  className?: string;
  disabled?: boolean;
  absolute?: boolean;
  /** Rebind when the underlying media identity changes (e.g. playUrl). */
  mediaKey?: string | null;
  /** The containing player is explicitly rotated clockwise by 90 degrees. */
  rotated?: boolean;
  /** Fired when scrub drag starts/ends (parent uses this to ignore swipe gestures). */
  onSeekingChange?: (seeking: boolean) => void;
  /** Tighter hit area for Hongguo-flush portrait watch chrome. */
  compact?: boolean;
};

/**
 * Hongguo-style scrubber:
 * - idle: thin inset track + always-visible circular thumb
 * - drag: thicken + thumb + current/total time above thumb
 * - seek throttled for smoother scrubbing on HLS
 */
export function WatchSeekBar({
  videoRef,
  bottom = 0,
  className,
  disabled,
  absolute = true,
  mediaKey,
  rotated = false,
  onSeekingChange,
  compact = false,
}: WatchSeekBarProps) {
  const seekRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [dragging, setDragging] = useState(false);
  const wasPaused = useRef(false);
  const dragRatio = useRef(0);
  const wantSeekTime = useRef<number | null>(null);
  const seekInFlight = useRef(false);
  const durationRef = useRef(0);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    let cancelled = false;
    let attached: HTMLVideoElement | null = null;
    let raf = 0;

    const detach = () => {
      if (!attached) return;
      attached.removeEventListener("timeupdate", onTime);
      attached.removeEventListener("loadedmetadata", onMeta);
      attached.removeEventListener("durationchange", onMeta);
      attached.removeEventListener("progress", onProg);
      attached.removeEventListener("seeked", onSeeked);
      attached.removeEventListener("seeking", onSeeking);
      attached = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const flushSeek = () => {
      const v = attached ?? videoRef.current;
      const next = wantSeekTime.current;
      if (!v || next == null || disabled) return;
      if (seekInFlight.current) return;
      seekInFlight.current = true;
      wantSeekTime.current = null;
      try {
        v.currentTime = next;
      } catch {
        seekInFlight.current = false;
      }
    };

    const onSeeked = () => {
      seekInFlight.current = false;
      // Catch up to the latest thumb position while still dragging.
      if (wantSeekTime.current != null) flushSeek();
    };
    const onSeeking = () => {
      seekInFlight.current = true;
    };

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

    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (v && v !== attached) {
        detach();
        attached = v;
        seekInFlight.current = false;
        attached.addEventListener("timeupdate", onTime);
        attached.addEventListener("loadedmetadata", onMeta);
        attached.addEventListener("durationchange", onMeta);
        attached.addEventListener("progress", onProg);
        attached.addEventListener("seeked", onSeeked);
        attached.addEventListener("seeking", onSeeking);
        onTime();
        onMeta();
        onProg();
      } else if (v && !dragging && !v.paused && !v.ended) {
        setCurrent(v.currentTime || 0);
        const d = readDuration(v);
        if (d > 0 && d !== durationRef.current) setDuration(d);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      detach();
    };
  }, [videoRef, mediaKey, dragging, disabled]);

  const requestSeek = (time: number) => {
    const d = durationRef.current;
    if (!d || disabled) return;
    const next = Math.max(0, Math.min(d, time));
    wantSeekTime.current = next;
    if (seekInFlight.current) return;
    const v = videoRef.current;
    if (!v) return;
    seekInFlight.current = true;
    wantSeekTime.current = null;
    try {
      v.currentTime = next;
    } catch {
      seekInFlight.current = false;
    }
  };

  const ratioFromEvent = (clientX: number, clientY: number) => {
    const el = seekRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    // Local L→R maps to screen top→bottom after clockwise 90°.
    // Use explicit layout state instead of guessing from a transient AABB.
    if (rotated) {
      const h = Math.max(1, rect.height);
      return Math.max(0, Math.min(1, (clientY - rect.top) / h));
    }
    const w = Math.max(1, rect.width);
    return Math.max(0, Math.min(1, (clientX - rect.left) / w));
  };

  const applyRatioUi = (ratio: number) => {
    dragRatio.current = ratio;
    const d = durationRef.current;
    if (!d) {
      setCurrent(ratio);
      return;
    }
    const time = ratio * d;
    setCurrent(time);
    requestSeek(time);
  };

  useEffect(() => {
    onSeekingChange?.(dragging);
  }, [dragging, onSeekingChange]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      applyRatioUi(ratioFromEvent(e.clientX, e.clientY));
    };
    const onUp = () => {
      const d = durationRef.current;
      if (d > 0) {
        const finalTime =
          wantSeekTime.current != null
            ? wantSeekTime.current
            : Math.max(0, Math.min(d, dragRatio.current * d));
        wantSeekTime.current = finalTime;
        const v = videoRef.current;
        if (v) {
          seekInFlight.current = false;
          try {
            v.currentTime = finalTime;
            setCurrent(finalTime);
          } catch {
            /* ignore */
          }
        }
      }
      wantSeekTime.current = null;
      setDragging(false);
      const video = videoRef.current;
      if (video && !wasPaused.current) {
        void video.play().catch(() => undefined);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, duration, disabled]);

  useEffect(
    () => () => {
      wantSeekTime.current = null;
      seekInFlight.current = false;
    },
    [],
  );

  const progress =
    duration > 0
      ? Math.max(0, Math.min(1, current / duration))
      : dragging
        ? Math.max(0, Math.min(1, current <= 1 ? current : 0))
        : 0;
  const timeLeft = Math.min(88, Math.max(12, progress * 100));

  return (
    <div
      className={cn(
        "relative px-3",
        absolute && "absolute inset-x-0 z-40",
        className,
      )}
      style={absolute ? { bottom } : undefined}
      onClick={(e) => e.stopPropagation()}
      data-no-tap
    >
      {dragging ? (
        <div
          className={cn(
            "pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold tabular-nums tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]",
            compact ? "bottom-[0.85rem]" : "bottom-[1.05rem]",
          )}
          style={{ left: `${timeLeft}%` }}
        >
          {fmtTime(duration > 0 ? current : 0)} / {fmtTime(duration)}
        </div>
      ) : null}

      <div
        ref={seekRef}
        className={cn(
          "relative touch-none select-none",
          compact ? "h-3.5" : "h-5",
          disabled ? "pointer-events-none opacity-40" : "cursor-pointer",
        )}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.stopPropagation();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          const v = videoRef.current;
          wasPaused.current = !!v?.paused;
          if (v && !v.paused) v.pause();
          setDragging(true);
          applyRatioUi(ratioFromEvent(e.clientX, e.clientY));
        }}
      >
        <div
          className={cn(
            "absolute inset-x-0 overflow-visible rounded-full transition-[height,background-color] duration-150",
            compact ? "bottom-[5px]" : "bottom-[7px]",
            dragging ? "h-[3px] bg-white/30" : "h-px bg-white/45",
          )}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/35"
            style={{ width: `${buffered * 100}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.4)] transition-[width,height] duration-150",
              dragging ? "h-3.5 w-3.5" : "h-2.5 w-2.5",
            )}
            style={{ left: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
