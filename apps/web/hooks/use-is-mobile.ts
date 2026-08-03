"use client";

import { useEffect, useState } from "react";

/** Matches Tailwind `md` (768px). SSR defaults to desktop to avoid mobile flash on PC. */
export function useIsMobile(breakpointPx = 768) {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [breakpointPx]);

  return mobile;
}
