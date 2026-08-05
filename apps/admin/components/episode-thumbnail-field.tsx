"use client";

import { useRef, useState } from "react";
import { adminUploadImage } from "@velvet/api-client";
import { ImageIcon, ImagePlus, LoaderCircle, Video } from "lucide-react";
import { captureVideoFirstFrame } from "@/lib/capture-video-frame";

export function EpisodeThumbnailField({
  url,
  disabled,
  kind = "thumbnail",
  onUploaded,
  onError,
  fromVideoLabel,
  uploadLabel,
}: {
  url?: string;
  disabled?: boolean;
  kind?: "cover" | "thumbnail" | "image";
  onUploaded: (url: string) => void | Promise<void>;
  onError: (message: string) => void;
  fromVideoLabel: string;
  uploadLabel: string;
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

  return (
    <div className="content-ep-thumb">
      <div className="content-ep-thumb__preview">
        {busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-brand" />
        ) : url ? (
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
          onClick={() => videoRef.current?.click()}
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
            const saved = await adminUploadImage(blob, {
              kind,
              filename: `${file.name.replace(/\.[^.]+$/, "") || "media"}-${kind}.jpg`,
            });
            await onUploaded(saved.url);
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
