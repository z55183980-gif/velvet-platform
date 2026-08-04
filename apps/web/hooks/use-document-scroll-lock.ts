"use client";

import { useEffect, type RefObject } from "react";

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
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
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
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.right = prev.bodyRight;
      body.style.width = prev.bodyWidth;
      window.scrollTo(0, scrollY);
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
