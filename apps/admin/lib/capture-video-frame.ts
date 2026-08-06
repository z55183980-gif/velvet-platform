import { isHlsSource, loadHls } from "@/lib/load-hls";

const CAPTURE_TIMEOUT_MS = 12_000;
const SEEK_FALLBACK_MS = 450;

/** Serialize frame captures — parallel `<video>` decode often hangs for later files. */
let captureChain: Promise<unknown> = Promise.resolve();

function enqueueCapture<T>(job: () => Promise<T>): Promise<T> {
  const run = captureChain.then(job, job);
  captureChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function drawFrame(video: HTMLVideoElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
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

/**
 * Attach listeners first, then caller must set `video.src` (or attach HLS).
 * Avoids the classic race where `loadeddata` fires before handlers exist.
 */
function captureFromElement(
  video: HTMLVideoElement,
  quality: number,
  timeoutMs = CAPTURE_TIMEOUT_MS,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let seekFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    let readyOnce = false;

    const clearTimers = () => {
      if (seekFallbackTimer !== undefined) clearTimeout(seekFallbackTimer);
      if (hardTimer !== undefined) clearTimeout(hardTimer);
      seekFallbackTimer = undefined;
      hardTimer = undefined;
    };

    const detach = () => {
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.oncanplay = null;
      video.onseeked = null;
      video.onerror = null;
    };

    const cleanupMedia = () => {
      detach();
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore */
      }
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimers();
      cleanupMedia();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const draw = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      detach();
      drawFrame(video, quality)
        .then((blob) => {
          cleanupMedia();
          resolve(blob);
        })
        .catch((err) => {
          cleanupMedia();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    };

    const trySeekOrDraw = () => {
      if (settled) return;
      if (video.videoWidth < 2 || video.videoHeight < 2) return;

      const duration = video.duration;
      // Nudge past 0 — some codecs return a black frame at t=0.
      const target =
        Number.isFinite(duration) && duration > 0
          ? Math.min(0.5, Math.max(0.05, duration * 0.02))
          : 0.1;

      try {
        if (Math.abs((video.currentTime || 0) - target) < 0.02) {
          draw();
          return;
        }
        video.currentTime = target;
        // Some browsers never fire `seeked` (short clips / HEVC / already buffered).
        seekFallbackTimer = setTimeout(draw, SEEK_FALLBACK_MS);
      } catch {
        draw();
      }
    };

    const onReady = () => {
      if (settled || readyOnce) return;
      if (video.videoWidth < 2) return;
      readyOnce = true;
      trySeekOrDraw();
    };

    hardTimer = setTimeout(() => fail(new Error("capture timed out")), timeoutMs);

    video.onloadedmetadata = onReady;
    video.onloadeddata = onReady;
    video.oncanplay = onReady;
    video.onseeked = () => {
      if (seekFallbackTimer !== undefined) clearTimeout(seekFallbackTimer);
      seekFallbackTimer = undefined;
      draw();
    };
    video.onerror = () => fail(new Error("failed to load video"));
  });
}

/** Capture approximately the first frame of a local video file as a JPEG blob. */
export function captureVideoFirstFrame(file: File, quality = 0.86): Promise<Blob> {
  return enqueueCapture(async () => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");

    const promise = captureFromElement(video, quality).finally(() => {
      URL.revokeObjectURL(objectUrl);
    });

    // Handlers are already attached — set src after to avoid missed events.
    video.src = objectUrl;
    try {
      video.load();
    } catch {
      /* ignore */
    }

    return promise;
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
  return enqueueCapture(async () => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");

    let hls: { destroy: () => void } | null = null;
    const promise = captureFromElement(video, quality).finally(() => {
      try {
        hls?.destroy();
      } catch {
        /* ignore */
      }
      hls = null;
    });

    const isHls = opts.isHls ?? isHlsSource(src);
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      try {
        video.load();
      } catch {
        /* ignore */
      }
      return promise;
    }

    try {
      const Hls = await loadHls();
      if (!Hls.isSupported()) {
        throw new Error("HLS not supported in this browser");
      }
      const instance = new Hls({});
      hls = instance;
      instance.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean }) => {
        if (data?.fatal) {
          try {
            instance.destroy();
          } catch {
            /* ignore */
          }
          video.dispatchEvent(new Event("error"));
        }
      });
      instance.loadSource(src);
      instance.attachMedia(video);
      return promise;
    } catch (e) {
      video.dispatchEvent(new Event("error"));
      try {
        await promise;
      } catch {
        /* expected after forced error */
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
  });
}
