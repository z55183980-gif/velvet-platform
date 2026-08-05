/** Capture approximately the first frame of a local video file as a JPEG blob. */
export function captureVideoFirstFrame(file: File, quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    let settled = false;
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
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

    const draw = () => {
      try {
        const w = video.videoWidth || 720;
        const h = video.videoHeight || 1280;
        if (w < 2 || h < 2) {
          fail(new Error("invalid video dimensions"));
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fail(new Error("canvas unavailable"));
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (blob) succeed(blob);
            else fail(new Error("toBlob failed"));
          },
          "image/jpeg",
          quality,
        );
      } catch (e) {
        fail(e);
      }
    };

    video.onloadeddata = () => {
      // Seek slightly past 0 — some codecs return a black frame at t=0.
      const target = Math.min(0.1, Math.max(0, (video.duration || 1) * 0.01));
      try {
        if (Number.isFinite(target) && target > 0) video.currentTime = target;
        else draw();
      } catch {
        draw();
      }
    };
    video.onseeked = () => draw();
    video.onerror = () => fail(new Error("failed to load video"));
  });
}
