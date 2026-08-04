"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type WatchSeekBarProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  bottom?: number;
  className?: string;
  disabled?: boolean;
  absolute?: boolean;
  /** Fired when scrub drag starts/ends (parent uses this to ignore swipe gestures). */
  onSeekingChange?: (seeking: boolean) => void;
};

/**
 * Hongguo-style scrubber:
 * - idle: thin track
 * - drag: thicken + vertical head + preview thumb + time
 * - seek throttled for smoother scrubbing on HLS
 */
export function WatchSeekBar({
  videoRef,
  bottom = 0,
  className,
  disabled,
  absolute = true,
  onSeekingChange,
}: WatchSeekBarProps) {
  const seekRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const wasPaused = useRef(false);
  const dragRatio = useRef(0);
  const lastSeekAt = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (!dragging) setCurrent(v.currentTime);
    };
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
    onTime();
    onMeta();
    onProg();
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("durationchange", onMeta);
    v.addEventListener("progress", onProg);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", onMeta);
      v.removeEventListener("progress", onProg);
    };
  }, [videoRef, dragging]);

  const captureFrame = () => {
    const v = videoRef.current;
    const canvas = previewCanvasRef.current;
    if (!v || !canvas || v.readyState < 2) return;
    const w = 90;
    const h = 160;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      const vw = v.videoWidth || w;
      const vh = v.videoHeight || h;
      const scale = Math.max(w / vw, h / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      setPreviewUrl(canvas.toDataURL("image/jpeg", 0.7));
    } catch {
      /* cross-origin / empty frame */
    }
  };

  const commitSeek = (time: number) => {
    const v = videoRef.current;
    if (!v || !duration || disabled) return;
    const next = Math.max(0, Math.min(duration, time));
    try {
      v.currentTime = next;
    } catch {
      /* ignore */
    }
    lastSeekAt.current = Date.now();
  };

  const scheduleSeek = (time: number) => {
    pendingSeek.current = time;
    const now = Date.now();
    const elapsed = now - lastSeekAt.current;
    if (elapsed >= 90) {
      if (seekTimer.current) {
        clearTimeout(seekTimer.current);
        seekTimer.current = null;
      }
      commitSeek(time);
      pendingSeek.current = null;
      return;
    }
    if (seekTimer.current) return;
    seekTimer.current = setTimeout(() => {
      seekTimer.current = null;
      if (pendingSeek.current != null) {
        commitSeek(pendingSeek.current);
        pendingSeek.current = null;
      }
    }, 90 - elapsed);
  };

  const ratioFromEvent = (clientX: number) => {
    const el = seekRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const applyRatioUi = (ratio: number) => {
    dragRatio.current = ratio;
    if (!duration) return;
    const time = ratio * duration;
    setCurrent(time);
    scheduleSeek(time);
  };

  useEffect(() => {
    onSeekingChange?.(dragging);
  }, [dragging, onSeekingChange]);

  useEffect(() => {
    if (!dragging) return;
    const v = videoRef.current;
    const onSeeked = () => captureFrame();
    v?.addEventListener("seeked", onSeeked);
    captureFrame();

    const onMove = (e: PointerEvent) => {
      applyRatioUi(ratioFromEvent(e.clientX));
    };
    const onUp = () => {
      if (seekTimer.current) {
        clearTimeout(seekTimer.current);
        seekTimer.current = null;
      }
      if (pendingSeek.current != null) {
        commitSeek(pendingSeek.current);
        pendingSeek.current = null;
      }
      setDragging(false);
      setPreviewUrl(null);
      const video = videoRef.current;
      if (video && !wasPaused.current) {
        void video.play().catch(() => undefined);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      v?.removeEventListener("seeked", onSeeked);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, duration, disabled]);

  useEffect(
    () => () => {
      if (seekTimer.current) clearTimeout(seekTimer.current);
    },
    [],
  );

  const progress = duration > 0 ? current / duration : 0;
  const previewLeft = Math.min(86, Math.max(14, progress * 100));

  return (
    <div
      className={cn(absolute && "absolute inset-x-0 z-40", "px-3", className)}
      style={absolute ? { bottom } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <canvas ref={previewCanvasRef} className="hidden" />

      {dragging ? (
        <div
          className="pointer-events-none absolute bottom-[1.35rem] flex w-[4.5rem] -translate-x-1/2 flex-col items-center"
          style={{ left: `${previewLeft}%` }}
        >
          <div className="overflow-hidden rounded-md ring-2 ring-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.45)]">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-28 w-[4.5rem] object-cover" />
            ) : (
              <div className="flex h-28 w-[4.5rem] items-center justify-center bg-black/65 text-[11px] text-white/50">
                …
              </div>
            )}
          </div>
          <div className="mt-1.5 text-[12px] font-medium tabular-nums tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
            {fmtTime(current)} / {fmtTime(duration)}
          </div>
        </div>
      ) : null}

      <div
        ref={seekRef}
        className={cn(
          "relative h-6 touch-none select-none",
          disabled ? "pointer-events-none opacity-40" : "cursor-pointer",
        )}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.stopPropagation();
          const v = videoRef.current;
          wasPaused.current = !!v?.paused;
          if (v && !v.paused) v.pause();
          setDragging(true);
          applyRatioUi(ratioFromEvent(e.clientX));
        }}
      >
        <div
          className={cn(
            "absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-visible rounded-full transition-[height,background-color] duration-150",
            dragging ? "h-1.5 bg-white/28" : "h-0.5 bg-white/35",
          )}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/40"
            style={{ width: `${buffered * 100}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div
          className={cn(
            "absolute top-1/2 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,0.45)] transition-opacity duration-150",
            dragging ? "h-4 opacity-100" : "h-2 opacity-0",
          )}
          style={{ left: `${progress * 100}%` }}
          aria-hidden={!dragging}
        />
      </div>
    </div>
  );
}
