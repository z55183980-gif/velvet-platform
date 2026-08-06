import { isHlsSource, loadHls } from "@/lib/load-hls";

const CAPTURE_TIMEOUT_MS = 12_000;
const SEEK_FALLBACK_MS = 450;
const TO_BLOB_TIMEOUT_MS = 3_000;

/** Serialize frame captures — parallel `<video>` decode often hangs for later files. */
let captureChain: Promise<unknown> = Promise.resolve();

function enqueueCapture<T>(job: () => Promise<T>): Promise<T> {
  // Outer race: even if a job clears its internal timer then hangs (e.g. toBlob),
  // the chain must advance or every later episode stays on the spinner forever.
  const run = captureChain.then(
    () => withTimeout(job(), CAPTURE_TIMEOUT_MS + 1_500, "capture timed out"),
    () => withTimeout(job(), CAPTURE_TIMEOUT_MS + 1_500, "capture timed out"),
  );
  captureChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function guessVideoMime(file: File): string | undefined {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".mov") || name.endsWith(".m4v")) return "video/quicktime";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".mkv")) return "video/x-matroska";
  return undefined;
}

function objectUrlForVideo(file: File): string {
  const mime = guessVideoMime(file);
  if (!mime || file.type === mime) return URL.createObjectURL(file);
  // Re-wrap with a MIME hint (Blob part list, not a full byte copy) so Chromium
  // picks a demuxer for empty-type phone MOV/MP4 uploads.
  try {
    return URL.createObjectURL(
      new File([file], file.name, { type: mime, lastModified: file.lastModified }),
    );
  } catch {
    return URL.createObjectURL(file);
  }
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
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("toBlob timed out"));
      }, TO_BLOB_TIMEOUT_MS);
      canvas.toBlob(
        (blob) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
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

function waitForPaintedFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const rvfc = (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      }
    ).requestVideoFrameCallback;

    if (typeof rvfc === "function") {
      const id = rvfc.call(video, done);
      setTimeout(() => {
        try {
          (
            video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }
          ).cancelVideoFrameCallback?.(id);
        } catch {
          /* ignore */
        }
        done();
      }, 1_200);
      return;
    }

    // Force a decode on codecs that expose dimensions before any frame is ready.
    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.then === "function") {
      playAttempt
        .then(() => {
          try {
            video.pause();
          } catch {
            /* ignore */
          }
          done();
        })
        .catch(() => done());
      setTimeout(done, 1_200);
      return;
    }
    done();
  });
}

export type LocalVideoFrameCapture = {
  blob: Blob;
  /** Seconds; omitted when browser reports Infinity/NaN (common for some MOV/HEVC). */
  durationSec?: number;
};

function readFiniteDurationSec(video: HTMLVideoElement): number | undefined {
  const d = video.duration;
  if (!Number.isFinite(d) || d <= 0) return undefined;
  return d;
}

/**
 * Attach listeners first, then caller must set `video.src` (or attach HLS).
 * Avoids the classic race where `loadeddata` fires before handlers exist.
 */
function captureFromElement(
  video: HTMLVideoElement,
  quality: number,
  timeoutMs = CAPTURE_TIMEOUT_MS,
): Promise<LocalVideoFrameCapture> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let seekFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    let readyOnce = false;
    let durationSec: number | undefined;

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
        video.pause();
      } catch {
        /* ignore */
      }
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

    const noteDuration = () => {
      durationSec = readFiniteDurationSec(video) ?? durationSec;
    };

    const draw = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      detach();
      noteDuration();
      // HAVE_CURRENT_DATA (2) means a frame is already available to paint.
      const ensureFrame =
        video.readyState >= 2 ? Promise.resolve() : waitForPaintedFrame(video);
      void ensureFrame
        .then(() => drawFrame(video, quality))
        .then((blob) => {
          noteDuration();
          cleanupMedia();
          resolve({ blob, durationSec });
        })
        .catch((err) => {
          cleanupMedia();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    };

    const trySeekOrDraw = () => {
      if (settled) return;
      if (video.videoWidth < 2 || video.videoHeight < 2) return;

      noteDuration();
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
      noteDuration();
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

function mountOffscreenVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.controls = false;
  // Some Chromium builds skip decode for detached media elements.
  video.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
  document.body.appendChild(video);
  return video;
}

function unmountVideo(video: HTMLVideoElement) {
  try {
    video.remove();
  } catch {
    /* ignore */
  }
}

/** Capture approximately the first frame of a local video file as a JPEG blob. */
export function captureVideoFirstFrame(file: File, quality = 0.86): Promise<Blob> {
  return captureVideoFirstFrameWithMeta(file, quality).then((r) => r.blob);
}

/** Same as {@link captureVideoFirstFrame}, plus duration when the demuxer exposes it. */
export function captureVideoFirstFrameWithMeta(
  file: File,
  quality = 0.86,
): Promise<LocalVideoFrameCapture> {
  return enqueueCapture(async () => {
    const objectUrl = objectUrlForVideo(file);
    const video = mountOffscreenVideo();

    const promise = captureFromElement(video, quality).finally(() => {
      unmountVideo(video);
      URL.revokeObjectURL(objectUrl);
    });

    // Handlers are already attached — set src after to avoid missed events.
    // Do not call video.load() here: it can abort the just-started blob load.
    video.src = objectUrl;

    return promise;
  });
}

const PROBE_DURATION_TIMEOUT_MS = 8_000;

/**
 * Lightweight metadata-only duration probe (no frame capture).
 * Used when thumbnail capture fails but duration may still be readable.
 */
export function probeLocalVideoDuration(file: File): Promise<number | undefined> {
  return enqueueCapture(async () => {
    const objectUrl = objectUrlForVideo(file);
    const video = mountOffscreenVideo();
    video.preload = "metadata";

    try {
      return await withTimeout(
        new Promise<number | undefined>((resolve, reject) => {
          let settled = false;
          const finish = (value: number | undefined) => {
            if (settled) return;
            settled = true;
            video.onloadedmetadata = null;
            video.ondurationchange = null;
            video.onerror = null;
            resolve(value);
          };
          video.onloadedmetadata = () => finish(readFiniteDurationSec(video));
          video.ondurationchange = () => {
            const d = readFiniteDurationSec(video);
            if (d != null) finish(d);
          };
          video.onerror = () => {
            if (settled) return;
            settled = true;
            video.onloadedmetadata = null;
            video.ondurationchange = null;
            video.onerror = null;
            reject(new Error("failed to load video metadata"));
          };
          video.src = objectUrl;
        }),
        PROBE_DURATION_TIMEOUT_MS,
        "duration probe timed out",
      );
    } finally {
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore */
      }
      unmountVideo(video);
      URL.revokeObjectURL(objectUrl);
    }
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
    const video = mountOffscreenVideo();
    video.crossOrigin = "anonymous";

    let hls: { destroy: () => void } | null = null;
    const promise = captureFromElement(video, quality)
      .then((r) => r.blob)
      .finally(() => {
        try {
          hls?.destroy();
        } catch {
          /* ignore */
        }
        hls = null;
        unmountVideo(video);
      });

    const isHls = opts.isHls ?? isHlsSource(src);
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return promise;
    }

    try {
      const Hls = await withTimeout(loadHls(), 8_000, "HLS loader timed out");
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
