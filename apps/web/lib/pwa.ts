export type PwaPlatform = "ios" | "android" | "desktop" | "other";

const PROMPT_SEEN_KEY = "dv_pwa_prompt_seen";
const OPEN_EVENT = "velvet:open-pwa-install";

export function getPwaPlatform(): PwaPlatform {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  if (iOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Mobile|Tablet/i.test(ua)) return "other";
  return "desktop";
}

export function isPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mq || iosStandalone;
}

export function hasSeenPwaPrompt(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(PROMPT_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markPwaPromptSeen() {
  try {
    localStorage.setItem(PROMPT_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function openPwaInstallGuide() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function onOpenPwaInstallGuide(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  const fn = () => handler();
  window.addEventListener(OPEN_EVENT, fn);
  return () => window.removeEventListener(OPEN_EVENT, fn);
}

export async function registerPwaServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Avoid noisy SW registration failures on plain HTTP LAN IPs in some browsers.
  const secure =
    window.isSecureContext ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  if (!secure) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    /* ignore */
  }
}
