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
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState("cover");
  const [cropZoom, setCropZoom] = useState(1);
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);

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

  const applyCrop = () => {
    if (!cropSource) return;
    void run(async () => {
      const image = new Image();
      image.src = cropSource;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(t("coverCropFailed")));
      });
      const targetW = 900;
      const targetH = 1200;
      const aspect = targetW / targetH;
      const sourceAspect = image.width / image.height;
      const baseW = sourceAspect > aspect ? image.height * aspect : image.width;
      const baseH = sourceAspect > aspect ? image.height : image.width / aspect;
      const cropW = baseW / cropZoom;
      const cropH = baseH / cropZoom;
      const sx = Math.max(0, Math.min(image.width - cropW, (image.width - cropW) * cropX / 100));
      const sy = Math.max(0, Math.min(image.height - cropH, (image.height - cropH) * cropY / 100));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.getContext("2d")?.drawImage(image, sx, sy, cropW, cropH, 0, 0, targetW, targetH);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error(t("coverCropFailed"))), "image/jpeg", 0.9));
      await uploadBlob(blob, cropFileName.replace(/\.[^.]+$/, "") || "cover");
      URL.revokeObjectURL(cropSource);
      setCropSource(null);
    });
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

      {cropSource ? (
        <div className="drama-cover-field__crop" role="dialog" aria-label={t("coverCropTitle")}>
          <div className="drama-cover-field__crop-preview" style={{ backgroundImage: `url(${cropSource})`, backgroundSize: `${cropZoom * 100}%`, backgroundPosition: `${cropX}% ${cropY}%` }} />
          <label>{t("coverCropZoom")}<input type="range" min="1" max="2.5" step="0.05" value={cropZoom} onChange={(e) => setCropZoom(Number(e.target.value))} /></label>
          <label>{t("coverCropHorizontal")}<input type="range" min="0" max="100" value={cropX} onChange={(e) => setCropX(Number(e.target.value))} /></label>
          <label>{t("coverCropVertical")}<input type="range" min="0" max="100" value={cropY} onChange={(e) => setCropY(Number(e.target.value))} /></label>
          <div className="drama-cover-field__crop-actions"><button type="button" className="drama-cover-field__btn" onClick={() => { URL.revokeObjectURL(cropSource); setCropSource(null); }}>{t("cancel")}</button><button type="button" className="drama-cover-field__btn drama-cover-field__btn--primary" onClick={applyCrop} disabled={busy}>{t("coverCropApply")}</button></div>
        </div>
      ) : null}

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
            const source = URL.createObjectURL(file);
            setCropFileName(file.name);
            setCropZoom(1);
            setCropX(50);
            setCropY(50);
            setCropSource(source);
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
