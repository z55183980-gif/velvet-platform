"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { creatorApi, creatorUploadVideo } from "@/lib/creator-api";
import { formatApiError, useToast } from "@/components/toast";

function CreatorUploadInner() {
  const search = useSearchParams();
  const { t } = useLocale();
  const toast = useToast();
  const [dramas, setDramas] = useState<any[]>([]);
  const [epDramaId, setEpDramaId] = useState("");
  const [epNo, setEpNo] = useState("1");
  const [epPrice, setEpPrice] = useState("10");
  const [epHls, setEpHls] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const msg = formatApiError(e, fallback);
      setErr(msg);
      toast.error(msg);
    },
    [toast],
  );

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const list = await creatorApi<any[]>("/dramas");
      const editable = (list || []).filter((d) => d.status === "DRAFT" || d.status === "REJECTED");
      setDramas(editable);
      const q = search.get("dramaId") || "";
      if (q && editable.some((d) => String(d.id) === q)) {
        setEpDramaId(q);
        const drama = editable.find((d) => String(d.id) === q);
        const maxEpisode = Math.max(
          0,
          ...((drama?.episodes || []).map((ep: any) => Number(ep.episodeNumber) || 0)),
        );
        setEpNo(String(maxEpisode + 1));
      }
    } catch (e: unknown) {
      fail(e, "error");
    }
  }, [fail, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onUploadFile(file: File | null) {
    if (!file) return;
    setUploadBusy(true);
    setUploadStatus(t("creator.uploading"));
    setErr(null);
    try {
      const { relativePath } = await creatorUploadVideo(file);
      setEpHls(relativePath || "");
      setUploadStatus(relativePath);
    } catch (e: unknown) {
      fail(e, "upload failed");
      setUploadStatus(null);
    } finally {
      setUploadBusy(false);
    }
  }

  async function addEpisode() {
    if (!epDramaId) return;
    const episodeNumber = Number(epNo);
    const selectedDrama = dramas.find((d) => String(d.id) === epDramaId);
    const isFree = episodeNumber <= Number(selectedDrama?.freeEpisodeCount ?? 3);
    const sourceIsHls = /\.m3u8(?:\?|$)/i.test(epHls.trim());
    setBusy(true);
    try {
      const ep = await creatorApi<any>(`/dramas/${epDramaId}/episodes`, {
        method: "POST",
        body: JSON.stringify({
          episodeNumber,
          title: `Episode ${episodeNumber}`,
          isFree,
          priceCredits: isFree ? 0 : Number(epPrice),
          hlsUrl: sourceIsHls ? epHls.trim() : undefined,
          originalUrl: epHls.trim() || undefined,
        }),
      });
      if (epHls && !sourceIsHls && ep?.id) {
        try {
          await creatorApi("/transcode", {
            method: "POST",
            body: JSON.stringify({ relativePath: epHls, episodeId: String(ep.id) }),
          });
        } catch {
          /* optional */
        }
      }
      await reload();
      setEpHls("");
      setUploadStatus(null);
      setEpNo(String(episodeNumber + 1));
    } catch (e: unknown) {
      fail(e, "episode failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-h3 font-semibold text-ink">{t("creator.uploadTitle")}</h2>

      {err && (
        <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-surface px-3 py-2 text-caption text-danger">
          {err}
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <select
          className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
          value={epDramaId}
          onChange={(e) => {
            const dramaId = e.target.value;
            setEpDramaId(dramaId);
            const drama = dramas.find((d) => String(d.id) === dramaId);
            const maxEpisode = Math.max(
              0,
              ...((drama?.episodes || []).map((ep: any) => Number(ep.episodeNumber) || 0)),
            );
            setEpNo(String(maxEpisode + 1));
          }}
        >
          <option value="">{t("creator.selectDrama")}</option>
          {dramas.map((d) => (
            <option key={String(d.id)} value={String(d.id)}>
              {d.titleEn}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
          placeholder={t("creator.episodeNo")}
          value={epNo}
          onChange={(e) => setEpNo(e.target.value)}
        />
        <input
          type="number"
          min={0}
          className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
          placeholder={t("creator.priceCredits")}
          value={epPrice}
          onChange={(e) => setEpPrice(e.target.value)}
        />
        <input
          className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink"
          placeholder={t("creator.sourcePath")}
          value={epHls}
          onChange={(e) => setEpHls(e.target.value)}
        />
        <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-line bg-surface px-3 py-2 text-body-sm text-ink-muted hover:text-ink">
          <input
            type="file"
            accept="video/mp4,video/*,.mp4,.mov,.mkv,.webm"
            className="hidden"
            disabled={uploadBusy}
            onChange={(e) => void onUploadFile(e.target.files?.[0] || null)}
          />
          {uploadBusy ? t("creator.uploading") : t("creator.uploadSource")}
        </label>
        <button
          type="button"
          disabled={busy}
          className={buttonVariants({ variant: "primary" })}
          onClick={() => void addEpisode()}
        >
          {t("creator.addEpisode")}
        </button>
      </div>
      {uploadStatus && <p className="mt-2 text-caption text-ink-subtle">{uploadStatus}</p>}
    </div>
  );
}

export default function CreatorUploadPage() {
  const { t } = useLocale();
  return (
    <Suspense fallback={<p className="text-body-sm text-ink-muted">{t("common.loading")}</p>}>
      <CreatorUploadInner />
    </Suspense>
  );
}
