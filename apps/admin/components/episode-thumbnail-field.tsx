"use client";

import { useRef, useState } from "react";
import { adminUploadImage } from "@velvet/api-client";
import { cn } from "@velvet/ui";
import { ImageIcon, ImagePlus, LoaderCircle, Video } from "lucide-react";
import { captureRemoteVideoFrame, captureVideoFirstFrame } from "@/lib/capture-video-frame";

export function EpisodeThumbnailField({
  url,
  disabled,
  kind = "thumbnail",
  size = "compact",
  onUploaded,
  onError,
  fromVideoLabel,
  uploadLabel,
  videoFile,
  videoSrc,
  videoIsHls,
}: {
  url?: string;
  disabled?: boolean;
  kind?: "cover" | "thumbnail" | "image";
  /** "compact" fits a narrow table cell; "form" a wide form row; "poster" a full-width 3:4 cover panel. */
  size?: "compact" | "form" | "poster";
  onUploaded: (url: string) => void | Promise<void>;
  onError: (message: string) => void;
  fromVideoLabel: string;
  uploadLabel: string;
  /** A video file already picked/selected locally (e.g. queued for upload) — captured directly, no file dialog. */
  videoFile?: File;
  /** URL of a video already hosted on the server (HLS or MP4) — captured directly, no file dialog. Takes effect only when `videoFile` is absent. */
  videoSrc?: string;
  videoIsHls?: boolean;
}) {
  const videoRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const uploadFrame = async (blob: Blob, name: string) => {
    const saved = await adminUploadImage(blob, { kind, filename: `${name}-${kind}.jpg` });
    await onUploaded(saved.url);
  };

  // When a video is already selected/hosted, grab the frame straight from it —
  // no file picker. Only fall back to asking for a local file when neither is set.
  const captureFromKnownSource = videoFile
    ? () =>
        run(async () => {
          const blob = await captureVideoFirstFrame(videoFile);
          await uploadFrame(blob, videoFile.name.replace(/\.[^.]+$/, "") || "media");
        })
    : videoSrc
      ? () =>
          run(async () => {
            const blob = await captureRemoteVideoFrame(videoSrc, { isHls: videoIsHls });
            await uploadFrame(blob, "frame");
          })
      : null;

  return (
    <div
      className={cn(
        "content-ep-thumb",
        size === "form" && "content-ep-thumb--form",
        size === "poster" && "content-ep-thumb--poster",
      )}
    >
      <div className="content-ep-thumb__preview">
        {busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-brand" />
        ) : url ? (
          // Signed API/blob previews intentionally bypass Next image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" />
        ) : (
          <ImageIcon className="h-4 w-4 text-ink-subtle" />
        )}
      </div>
      <div className="content-ep-thumb__actions">
        <button
          type="button"
          className="content-ep-thumb__btn"
          disabled={disabled || busy}
          title={fromVideoLabel}
          onClick={captureFromKnownSource ?? (() => videoRef.current?.click())}
        >
          <Video className="h-3.5 w-3.5" />
          <span>{fromVideoLabel}</span>
        </button>
        <button
          type="button"
          className="content-ep-thumb__btn"
          disabled={disabled || busy}
          title={uploadLabel}
          onClick={() => imageRef.current?.click()}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          <span>{uploadLabel}</span>
        </button>
      </div>
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void run(async () => {
            const blob = await captureVideoFirstFrame(file);
            await uploadFrame(blob, file.name.replace(/\.[^.]+$/, "") || "media");
          });
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void run(async () => {
            const saved = await adminUploadImage(file, { kind, filename: file.name });
            await onUploaded(saved.url);
          });
        }}
      />
    </div>
  );
}
