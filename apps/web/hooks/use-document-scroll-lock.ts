"use client";

import { useEffect, type RefObject } from "react";

type StyleSnapshot = {
  htmlOverflow: string;
  bodyOverflow: string;
  htmlOverscroll: string;
  bodyOverscroll: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
};

/**
 * Nested scroll locks share one document style snapshot + scrollY.
 * Only the outermost (depth 0→1) applies, and only the last release restores.
 */
let lockDepth = 0;
let savedScrollY = 0;
let baseStyles: StyleSnapshot | null = null;

function applyDocumentLock() {
  const html = document.documentElement;
  const body = document.body;
  savedScrollY = window.scrollY;
  baseStyles = {
    htmlOverflow: html.style.overflow,
    bodyOverflow: body.style.overflow,
    htmlOverscroll: html.style.overscrollBehavior,
    bodyOverscroll: body.style.overscrollBehavior,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
  };
  html.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  body.style.position = "fixed";
  body.style.top = `-${savedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

function releaseDocumentLock() {
  if (!baseStyles) return;
  const html = document.documentElement;
  const body = document.body;
  const prev = baseStyles;
  const y = savedScrollY;
  baseStyles = null;
  html.style.overflow = prev.htmlOverflow;
  html.style.overscrollBehavior = prev.htmlOverscroll;
  body.style.overflow = prev.bodyOverflow;
  body.style.overscrollBehavior = prev.bodyOverscroll;
  body.style.position = prev.bodyPosition;
  body.style.top = prev.bodyTop;
  body.style.left = prev.bodyLeft;
  body.style.right = prev.bodyRight;
  body.style.width = prev.bodyWidth;
  window.scrollTo(0, y);
}

/**
 * Locks document scroll and cancels non-scrolling touchmoves so mobile
 * overscroll / pull-to-refresh cannot drag the page under a fixed shell.
 */
export function useDocumentScrollLock(
  enabled: boolean,
  rootRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!enabled) return;
    if (lockDepth === 0) applyDocumentLock();
    lockDepth += 1;
    return () => {
      lockDepth = Math.max(0, lockDepth - 1);
      if (lockDepth === 0) releaseDocumentLock();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const canScrollTouchTarget = (target: EventTarget | null) => {
      let node = target instanceof Element ? target : null;
      while (node && node !== document.documentElement) {
        if (node instanceof HTMLElement) {
          const style = window.getComputedStyle(node);
          const oy = style.overflowY;
          const ox = style.overflowX;
          const yScrollable =
            (oy === "auto" || oy === "scroll" || oy === "overlay") &&
            node.scrollHeight > node.clientHeight + 1;
          const xScrollable =
            (ox === "auto" || ox === "scroll" || ox === "overlay") &&
            node.scrollWidth > node.clientWidth + 1;
          if (yScrollable || xScrollable) return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (canScrollTouchTarget(e.target)) return;
      e.preventDefault();
    };

    const el = rootRef?.current ?? null;
    el?.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el?.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, [enabled, rootRef]);
}
