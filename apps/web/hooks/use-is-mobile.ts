"use client";

import { useLayoutEffect, useState } from "react";

/** Matches Tailwind `md` (768px). */
export function useIsMobile(breakpointPx = 768): { mobile: boolean; ready: boolean } {
  const [mobile, setMobile] = useState(false);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    setReady(true);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [breakpointPx]);

  return { mobile, ready };
}
