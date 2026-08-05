import { isHlsSource, loadHls } from "@/lib/load-hls";

function drawFrame(video: HTMLVideoElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const w = video.videoWidth || 720;
      const h = video.videoHeight || 1280;
      if (w < 2 || h < 2) {
        reject(new Error("invalid video dimensions"));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas unavailable"));
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("toBlob failed"));
        },
        "image/jpeg",
        quality,
      );
    } catch (e) {
      reject(e);
    }
  });
}

function seekAndDraw(video: HTMLVideoElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const draw = () => {
      if (settled) return;
      settled = true;
      drawFrame(video, quality).then(resolve, reject);
    };
    video.onloadeddata = () => {
      // Seek slightly past 0 — some codecs return a black frame at t=0.
      const target = Math.min(0.5, Math.max(0, (video.duration || 1) * 0.02));
      try {
        if (Number.isFinite(target) && target > 0) video.currentTime = target;
        else draw();
      } catch {
        draw();
      }
    };
    video.onseeked = () => draw();
    video.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error("failed to load video"));
    };
  });
}

/** Capture approximately the first frame of a local video file as a JPEG blob. */
export function captureVideoFirstFrame(file: File, quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    seekAndDraw(video, quality)
      .then((blob) => {
        URL.revokeObjectURL(objectUrl);
        resolve(blob);
      })
      .catch((err) => {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      });
  });
}

/**
 * Capture a frame directly from an already-hosted video (HLS or progressive
 * MP4) without re-uploading anything — used to pull a cover/thumbnail from
 * media that's already on the server.
 *
 * Requires the CDN/storage origin to send CORS headers (Access-Control-Allow-Origin)
 * for the video, otherwise the canvas is tainted and toBlob() throws a SecurityError.
 */
export function captureRemoteVideoFrame(
  src: string,
  opts: { isHls?: boolean; quality?: number } = {},
): Promise<Blob> {
  const quality = opts.quality ?? 0.86;
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    let hls: { destroy: () => void } | null = null;
    let settled = false;
    const cleanup = () => {
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const succeed = (blob: Blob) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(blob);
    };

    seekAndDraw(video, quality).then(succeed, fail);

    const isHls = opts.isHls ?? isHlsSource(src);
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    void loadHls()
      .then((Hls) => {
        if (!Hls.isSupported()) {
          fail(new Error("HLS not supported in this browser"));
          return;
        }
        const instance = new Hls({});
        hls = instance;
        instance.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean }) => {
          if (data?.fatal) fail(new Error("hls load error"));
        });
        instance.loadSource(src);
        instance.attachMedia(video);
      })
      .catch(fail);
  });
}
