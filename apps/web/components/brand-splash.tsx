"use client";

import { useEffect } from "react";

export const VELVET_BOOT_SPLASH_ID = "velvet-boot-splash";
const STORAGE_KEY = "dv_splash_done";
const MIN_MS = 1400;
const MAX_MS = 2600;
const FADE_MS = 340;

/**
 * TikTok-style cold open: black stage + centered mark (once per session, mobile).
 * Static #velvet-boot-splash is painted from root layout for first paint; this
 * controller fades it out and marks the session.
 *
 * Root layout also installs an inline failsafe timer so a hydration crash cannot
 * leave the splash covering the app forever.
 */
export function BrandSplash() {
  useEffect(() => {
    const el = document.getElementById(VELVET_BOOT_SPLASH_ID);
    if (!el) return;
    if (el.dataset.skip === "1" || el.hasAttribute("hidden")) {
      el.remove();
      document.documentElement.classList.remove("velvet-splash-lock");
      return;
    }

    let finished = false;
    let minTimer = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* ignore */
      }
      el.style.transition = `opacity ${FADE_MS}ms ease`;
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      document.documentElement.classList.remove("velvet-splash-lock");
      window.setTimeout(() => el.remove(), FADE_MS + 40);
    };

    document.documentElement.classList.add("velvet-splash-lock");
    const started = performance.now();

    const releaseAfterMin = () => {
      const wait = Math.max(0, MIN_MS - (performance.now() - started));
      minTimer = window.setTimeout(finish, wait);
    };

    if (document.readyState === "complete") releaseAfterMin();
    else window.addEventListener("load", releaseAfterMin, { once: true });

    const maxTimer = window.setTimeout(finish, MAX_MS);
    return () => {
      window.clearTimeout(maxTimer);
      window.clearTimeout(minTimer);
      window.removeEventListener("load", releaseAfterMin);
    };
  }, []);

  return null;
}
