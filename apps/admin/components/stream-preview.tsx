"use client";

import { useEffect, useRef, useState } from "react";
import { isHlsSource, loadHls } from "@/lib/load-hls";

/**
 * Lightweight stream preview for admin: progressive MP4 via native video,
 * HLS via hls.js (CDN) when needed.
 */
export function StreamPreview({
  src,
  poster,
  className,
}: {
  src: string;
  poster?: string;
  className?: string;
}) {
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

  return (
    <div className={className}>
      <video
        ref={videoRef}
        className="aspect-video w-full rounded bg-black object-contain"
        controls
        playsInline
        poster={poster}
        onError={() => setError((e) => e || "play_error")}
      />
      {error ? (
        <p className="mt-1 text-caption text-danger">
          {error === "browser_no_hls" || error === "hls_load_failed" || error === "hls_fatal"
            ? "HLS 预览失败（CORS/格式）。可改用「优先 MP4」，或转存后预览本地文件。"
            : "直链预览失败（防盗链/CORS 可能导致浏览器无法播放）。服务端转存不受影响。"}
        </p>
      ) : null}
    </div>
  );
}
