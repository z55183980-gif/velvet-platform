"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Matches Tailwind `md` while keeping touch phones mobile after rotation.
 * A viewport-only query flips large phones to desktop when landscape/fullscreen
 * makes their CSS width exceed 767px.
 */
export function useIsMobile(breakpointPx = 768): { mobile: boolean; ready: boolean } {
  const [mobile, setMobile] = useState(false);
  const [ready, setReady] = useState(false);
  const detectedMobileRef = useRef(false);

  useLayoutEffect(() => {
    const viewportMq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const coarsePointerMq = window.matchMedia("(pointer: coarse)");
    const apply = () => {
      const screenShortSide = Math.min(window.screen.width, window.screen.height);
      const touchPhone =
        screenShortSide < breakpointPx &&
        (navigator.maxTouchPoints > 0 || coarsePointerMq.matches);
      // Device identity must not flip merely because rotation widened the viewport.
      detectedMobileRef.current ||= viewportMq.matches || touchPhone;
      setMobile(detectedMobileRef.current);
    };
    apply();
    setReady(true);
    viewportMq.addEventListener("change", apply);
    coarsePointerMq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      viewportMq.removeEventListener("change", apply);
      coarsePointerMq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, [breakpointPx]);

  return { mobile, ready };
}
