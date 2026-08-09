"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { cn } from "@/lib/utils";

const SNAP_MS = 280;
const DISTANCE_RATIO = 0.18;
const VELOCITY_PX_MS = 0.45;
const AXIS_LOCK_PX = 8;
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_MS = 420;
const WHEEL_COOLDOWN_MS = 520;
const EDGE_RESIST = 0.32;

const TAP_IGNORE_SELECTOR =
  "button, a, input, textarea, select, label, [role='button'], [role='slider'], [data-no-tap]";

type PageOffset = number;

/**
 * Douyin-style vertical pager: finger-follow drag, then snap by distance/velocity.
 * Parent renders a sliding window of prev / current / next(+ahead) pages.
 */
export function VerticalPager({
  index,
  count,
  onChange,
  blocked = false,
  onTap,
  ahead = 1,
  preserveCenterMedia = false,
  className,
  children,
}: {
  index: number;
  count: number;
  onChange: (next: number) => void;
  /** When true (e.g. scrubbing), ignore page gestures. */
  blocked?: boolean;
  /** Fired on a short press with little movement (not a swipe). */
  onTap?: () => void;
  /**
   * How many upcoming pages to keep mounted after the current one.
   * Home feed uses 2 so the second-next item can media-warm for fast swipes.
   */
  ahead?: number;
  /**
   * Keep the center slot mounted while its page index changes. Watch pages use
   * this to preserve one user-authorized <video>; feed pages retain page keys so
   * warmed neighbors can promote to active without losing their media state.
   */
  preserveCenterMedia?: boolean;
  className?: string;
  children: (ctx: {
    offset: PageOffset;
    pageIndex: number;
    active: boolean;
  }) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(0);
  const indexRef = useRef(index);
  const blockedRef = useRef(blocked);
  const onTapRef = useRef(onTap);
  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startT: number;
    lastY: number;
    lastT: number;
    velocity: number;
    axis: "undecided" | "h" | "v";
    from: number;
  } | null>(null);
  const animatingRef = useRef(false);
  const snapTimerRef = useRef<number | null>(null);
  const wheelLockUntil = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [animTo, setAnimTo] = useState<number | null>(null);

  indexRef.current = index;
  blockedRef.current = blocked;
  onTapRef.current = onTap;

  const measure = useCallback(() => {
    const h = rootRef.current?.clientHeight ?? 0;
    heightRef.current = h;
    return h;
  }, []);

  const clearSnapTimer = useCallback(() => {
    if (snapTimerRef.current != null) {
      window.clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => () => clearSnapTimer(), [clearSnapTimer]);

  const canPrev = index > 0;
  const canNext = index < count - 1;

  const finishSnap = useCallback(
    (target: number) => {
      const h = heightRef.current || measure();
      if (!h) {
        clearSnapTimer();
        setDragY(0);
        setAnimTo(null);
        animatingRef.current = false;
        return;
      }
      animatingRef.current = true;
      setAnimTo(target);
      clearSnapTimer();
      snapTimerRef.current = window.setTimeout(() => {
        snapTimerRef.current = null;
        const cur = indexRef.current;
        if (target < 0 && cur < count - 1) {
          onChange(cur + 1);
        } else if (target > 0 && cur > 0) {
          onChange(cur - 1);
        }
        setDragY(0);
        setAnimTo(null);
        animatingRef.current = false;
      }, SNAP_MS);
    },
    [clearSnapTimer, count, measure, onChange],
  );

  const clampDrag = useCallback(
    (raw: number) => {
      const h = heightRef.current || 1;
      const cur = indexRef.current;
      let y = raw;
      if (cur <= 0 && y > 0) y *= EDGE_RESIST;
      if (cur >= count - 1 && y < 0) y *= EDGE_RESIST;
      const max = h * 1.05;
      return Math.max(-max, Math.min(max, y));
    },
    [count],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (blockedRef.current || animatingRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    measure();
    const target = e.target;
    // Interactive descendants own their pointer stream. Capturing it here causes
    // slider scrubs to compete with page swipes, especially in rotated layouts.
    if (target instanceof Element && target.closest(TAP_IGNORE_SELECTOR)) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startT: performance.now(),
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
      axis: "undecided",
      from: dragY,
    };
    try {
      rootRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (blockedRef.current || animatingRef.current) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.axis === "undecided") {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      d.axis = Math.abs(dy) >= Math.abs(dx) * 1.15 ? "v" : "h";
      if (d.axis === "h") {
        dragRef.current = null;
        setDragY(0);
        return;
      }
    }
    if (d.axis !== "v") return;

    e.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.velocity = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = now;
    setDragY(clampDrag(d.from + dy));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (blockedRef.current || animatingRef.current) {
      setDragY(0);
      return;
    }

    const elapsed = Math.max(0, performance.now() - d.startT);
    const move = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (
      d.axis !== "v" &&
      move <= TAP_MAX_MOVE_PX &&
      elapsed <= TAP_MAX_MS
    ) {
      setDragY(0);
      onTapRef.current?.();
      return;
    }

    if (d.axis !== "v") {
      setDragY(0);
      return;
    }

    const h = heightRef.current || measure();
    const totalDy = e.clientY - d.startY;
    const avgVelocity = totalDy / Math.max(16, elapsed);
    // Prefer recent sample for flicks; fall back to average for short taps.
    const velocity =
      Math.abs(d.velocity) > Math.abs(avgVelocity) ? d.velocity : avgVelocity;
    const y = clampDrag(d.from + totalDy);
    const threshold = h * DISTANCE_RATIO;

    let target = 0;
    if ((y < -threshold || velocity < -VELOCITY_PX_MS) && indexRef.current < count - 1) {
      target = -h;
    } else if ((y > threshold || velocity > VELOCITY_PX_MS) && indexRef.current > 0) {
      target = h;
    }
    if (target === 0) {
      animatingRef.current = true;
      setAnimTo(0);
      clearSnapTimer();
      snapTimerRef.current = window.setTimeout(() => {
        snapTimerRef.current = null;
        setDragY(0);
        setAnimTo(null);
        animatingRef.current = false;
      }, SNAP_MS);
      return;
    }
    setDragY(y);
    finishSnap(target);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (animatingRef.current) return;
    animatingRef.current = true;
    setAnimTo(0);
    clearSnapTimer();
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = null;
      setDragY(0);
      setAnimTo(null);
      animatingRef.current = false;
    }, SNAP_MS);
  };

  // Native non-passive touchmove so iOS doesn't steal the gesture once vertical.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      const d = dragRef.current;
      if (d?.axis === "v") e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const onWheel = (e: ReactWheelEvent) => {
    if (blockedRef.current || animatingRef.current) return;
    if (Math.abs(e.deltaY) < 18) return;
    const now = performance.now();
    if (now < wheelLockUntil.current) return;
    if (e.deltaY > 0 && canNext) {
      wheelLockUntil.current = now + WHEEL_COOLDOWN_MS;
      measure();
      finishSnap(-(heightRef.current || 1));
    } else if (e.deltaY < 0 && canPrev) {
      wheelLockUntil.current = now + WHEEL_COOLDOWN_MS;
      measure();
      finishSnap(heightRef.current || 1);
    }
  };

  // Keyboard: flip with the same snap animation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blockedRef.current || animatingRef.current) return;
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        if (!canNext) return;
        e.preventDefault();
        measure();
        finishSnap(-(heightRef.current || 1));
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        if (!canPrev) return;
        e.preventDefault();
        measure();
        finishSnap(heightRef.current || 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNext, canPrev, finishSnap, measure]);

  const translateY = animTo != null ? animTo : dragY;
  const transitioning = animTo != null;

  const pages: PageOffset[] = [];
  if (canPrev) pages.push(-1);
  pages.push(0);
  const aheadCount = Math.max(0, Math.floor(ahead));
  for (let step = 1; step <= aheadCount; step++) {
    if (index + step < count) pages.push(step);
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative h-full min-h-0 touch-none overflow-hidden overscroll-none bg-base",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
    >
      <div
        ref={trackRef}
        className="absolute inset-0 will-change-transform"
        style={{
          transform: `translate3d(0, ${translateY}px, 0)`,
          transition: transitioning
            ? `transform ${SNAP_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`
            : "none",
        }}
      >
        {pages.map((offset) => {
          const pageIndex = index + offset;
          return (
            <div
              key={preserveCenterMedia ? `slot:${offset}` : `page:${pageIndex}`}
              className="absolute inset-x-0 top-0 h-full"
              style={{ transform: `translate3d(0, ${offset * 100}%, 0)` }}
              // Keep inactive slides from eating taps while settled.
              inert={offset !== 0 ? true : undefined}
            >
              {children({
                offset,
                pageIndex,
                // Keep center page "active" even while snapping so parents don't remount media.
                active: offset === 0,
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
