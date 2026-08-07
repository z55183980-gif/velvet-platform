"use client";

import { useEffect, useRef, useState } from "react";
import { isHlsSource, loadHls } from "@/lib/load-hls";
import { useI18n } from "@/lib/i18n";

/**
 * Lightweight stream preview for admin: progressive MP4 via native video,
 * HLS via hls.js (CDN) when needed.
 * Browser CORS/hotlink failures are expected for many third-party URLs —
 * they do not mean server-side import/transfer will fail.
 */
export function StreamPreview({
  src,
  poster,
  className,
  failHint,
}: {
  src: string;
  poster?: string;
  className?: string;
  /** Shown when browser cannot play (CORS / hotlink). */
  failHint?: string;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setError(null);

    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    const isHls = isHlsSource(src);

    const attachNative = () => {
      video.src = src;
      video.load();
    };

    const run = async () => {
      if (!isHls) {
        attachNative();
        return;
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        attachNative();
        return;
      }
      try {
        const Hls = await loadHls();
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError("browser_no_hls");
          return;
        }
        const instance = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        });
        instance.loadSource(src);
        instance.attachMedia(video);
        instance.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean }) => {
          if (data?.fatal) {
            setError("hls_fatal");
            instance.destroy();
          }
        });
        hls = instance;
      } catch {
        if (!cancelled) setError("hls_load_failed");
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  const isHlsError =
    error === "browser_no_hls" || error === "hls_load_failed" || error === "hls_fatal";
  const defaultFail = isHlsError
    ? t("streamPreviewHlsFail")
    : t("streamPreviewDirectFail");

  return (
    <div className={className}>
      <p className="mb-1 text-caption text-ink-muted">{t("streamPreviewOptionalNote")}</p>
      <video
        ref={videoRef}
        className="aspect-video w-full rounded bg-black object-contain"
        controls
        playsInline
        poster={poster}
        onError={() => setError((e) => e || "play_error")}
      />
      {error ? (
        <div className="mt-1 space-y-0.5 rounded border border-line bg-surface-muted px-2 py-1.5">
          <p className="text-caption text-ink-muted">{failHint || defaultFail}</p>
          <p className="text-caption text-ink-subtle">{t("streamPreviewServerOk")}</p>
        </div>
      ) : null}
    </div>
  );
}
