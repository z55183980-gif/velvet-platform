"use client";

import { useRef, useState } from "react";
import { adminUploadImage } from "@velvet/api-client";
import { cn } from "@velvet/ui";
import { ChevronDown, ImageIcon, ImagePlus, LoaderCircle, Trash2, Video } from "lucide-react";
import { captureRemoteVideoFrame, captureVideoFirstFrame } from "@/lib/capture-video-frame";
import { useI18n } from "@/lib/i18n";

/**
 * Drama-level cover picker (3:4 poster). Shared by local upload, online ingest, and detail.
 * Episode thumbnails still use EpisodeThumbnailField.
 */
export function DramaCoverField({
  url,
  disabled,
  videoFile,
  videoSrc,
  videoIsHls,
  showAdvancedUrl = true,
  onChange,
  onError,
}: {
  url?: string;
  disabled?: boolean;
  /** Local video already in the episode queue — enables one-click frame capture. */
  videoFile?: File | null;
  /** Hosted video URL for frame capture when no local file. */
  videoSrc?: string;
  videoIsHls?: boolean;
  showAdvancedUrl?: boolean;
  onChange: (url: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  const hasKnownVideo = !!(videoFile || videoSrc);

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

  const uploadBlob = async (blob: Blob, name: string) => {
    const saved = await adminUploadImage(blob, { kind: "cover", filename: `${name}-cover.jpg` });
    if (!saved?.url) throw new Error(t("coverUploadNoUrl"));
    onChange(saved.url);
  };

  const captureFromKnown = () => {
    if (videoFile) {
      void run(async () => {
        const blob = await captureVideoFirstFrame(videoFile);
        await uploadBlob(blob, videoFile.name.replace(/\.[^.]+$/, "") || "cover");
      });
      return;
    }
    if (videoSrc) {
      void run(async () => {
        const blob = await captureRemoteVideoFrame(videoSrc, { isHls: videoIsHls });
        await uploadBlob(blob, "cover");
      });
    }
  };

  return (
    <div className="drama-cover-field">
      <div className={cn("drama-cover-field__preview", !url && "is-empty")}>
        {busy ? (
          <LoaderCircle className="h-6 w-6 animate-spin text-brand" />
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" />
        ) : (
          <div className="drama-cover-field__empty">
            <ImageIcon className="h-7 w-7" />
            <span>{t("noCover")}</span>
          </div>
        )}
      </div>

      <div className="drama-cover-field__actions">
        <button
          type="button"
          className="drama-cover-field__btn"
          disabled={disabled || busy}
          onClick={() => imageRef.current?.click()}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          {t("thumbUpload")}
        </button>
        <button
          type="button"
          className="drama-cover-field__btn"
          disabled={disabled || busy}
          title={
            hasKnownVideo
              ? t("coverFromEpisodeHint")
              : t("coverPickVideoHint")
          }
          onClick={() => {
            if (hasKnownVideo) captureFromKnown();
            else videoRef.current?.click();
          }}
        >
          <Video className="h-3.5 w-3.5" />
          {t("thumbFromVideo")}
        </button>
        {url ? (
          <button
            type="button"
            className="drama-cover-field__btn drama-cover-field__btn--ghost"
            disabled={disabled || busy}
            onClick={() => onChange("")}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("coverClear")}
          </button>
        ) : null}
      </div>

      <p className="drama-cover-field__hint">{t("coverRecommendation")}</p>

      {showAdvancedUrl ? (
        <div className="drama-cover-field__advanced">
          <button
            type="button"
            className="drama-cover-field__advanced-toggle"
            disabled={disabled || busy}
            onClick={() => setShowUrl((v) => !v)}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition", showUrl && "rotate-180")} />
            {t("coverAdvancedUrl")}
          </button>
          {showUrl ? (
            <input
              className="drama-cover-field__url"
              type="text"
              value={url || ""}
              disabled={disabled || busy}
              placeholder={t("coverUrlPlaceholder")}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : null}
        </div>
      ) : null}

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
            const saved = await adminUploadImage(file, { kind: "cover", filename: file.name });
            if (!saved?.url) throw new Error(t("coverUploadNoUrl"));
            onChange(saved.url);
          });
        }}
      />
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
            await uploadBlob(blob, file.name.replace(/\.[^.]+$/, "") || "cover");
          });
        }}
      />
    </div>
  );
}
