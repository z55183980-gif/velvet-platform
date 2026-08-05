export type HlsLike = {
  isSupported: () => boolean;
  Events: { ERROR: string };
  new (opts?: Record<string, unknown>): {
    loadSource: (src: string) => void;
    attachMedia: (video: HTMLVideoElement) => void;
    on: (event: string, cb: (...args: any[]) => void) => void;
    destroy: () => void;
  };
};

declare global {
  interface Window {
    Hls?: HlsLike;
  }
}

export function isHlsSource(src: string): boolean {
  return /\.m3u8(\?|$)/i.test(src) || /\/hls\//i.test(src);
}

export function loadHls(): Promise<HlsLike> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Hls) return Promise.resolve(window.Hls);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-hls-js]");
    if (existing) {
      existing.addEventListener("load", () =>
        window.Hls ? resolve(window.Hls) : reject(new Error("Hls missing")),
      );
      existing.addEventListener("error", () => reject(new Error("Hls script failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
    s.async = true;
    s.dataset.hlsJs = "1";
    s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error("Hls missing")));
    s.onerror = () => reject(new Error("Hls script failed"));
    document.head.appendChild(s);
  });
}
