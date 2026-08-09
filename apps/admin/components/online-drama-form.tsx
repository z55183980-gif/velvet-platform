"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@velvet/ui";
import { DramaCoverField } from "@/components/drama-cover-field";
import type { DramaInfoFillPayload } from "@/lib/drama-info-fill";
import { useI18n } from "@/lib/i18n";

type EpisodeRow = {
  episodeNumber: number;
  title: string;
  sourceUrl: string;
};

const emptyEpisode = (n: number): EpisodeRow => ({
  episodeNumber: n,
  title: "",
  sourceUrl: "",
});

/**
 * Manual paste of playable URLs.
 * fillMode：回填主窗口（不直接建档）；否则保留独立草稿创建（非弹窗场景）。
 */
export function OnlineDramaForm({
  embedded = false,
  fillMode = false,
  onDirtyChange,
  onFillDramaInfo,
  onBeforeNavigate,
}: {
  embedded?: boolean;
  /** When true, apply resources to the main create form instead of creating a drama here. */
  fillMode?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onFillDramaInfo?: (payload: DramaInfoFillPayload) => void;
  /** @deprecated only used by legacy direct-create path */
  onBeforeNavigate?: () => void;
} = {}) {
  const { t } = useI18n();
  const [titleZh, setTitleZh] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [bulk, setBulk] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([emptyEpisode(1)]);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [applied, setApplied] = useState(false);
  const [overwriteMeta, setOverwriteMeta] = useState(false);
  const panelClass = embedded ? "space-y-3" : "upload-panel space-y-3";
  const metaClass = embedded
    ? "grid gap-3 md:grid-cols-2"
    : "upload-panel grid gap-3 md:grid-cols-2";

  const dirty =
    !(filled || applied) &&
    (Boolean(
      titleZh.trim() ||
        coverUrl.trim() ||
        descriptionEn.trim() ||
        bulk.trim(),
    ) ||
      episodes.length > 1 ||
      episodes.some(
        (ep, i) =>
          Boolean(ep.title.trim() || ep.sourceUrl.trim()) || ep.episodeNumber !== i + 1,
      ));

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  function collectEpisodes(): EpisodeRow[] {
    const fromRows = episodes
      .map((ep) => ({
        episodeNumber: ep.episodeNumber,
        title: ep.title.trim(),
        sourceUrl: ep.sourceUrl.trim(),
      }))
      .filter((ep) => ep.sourceUrl);
    const maxNo = fromRows.reduce((m, ep) => Math.max(m, ep.episodeNumber), 0);
    const fromBulk = bulk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((sourceUrl, index) => ({
        episodeNumber: maxNo + index + 1,
        title: "",
        sourceUrl,
      }));
    return [...fromRows, ...fromBulk].map((ep, i) => ({
      ...ep,
      episodeNumber: ep.episodeNumber || i + 1,
    }));
  }

  function fillDramaMeta() {
    if (!onFillDramaInfo) {
      setError(t("ytdlpApplyNeedMain"));
      return;
    }
    const title = titleZh.trim().slice(0, 40);
    if (!title && !coverUrl.trim() && !descriptionEn.trim()) {
      setError(t("ytdlpFillNeedMeta"));
      return;
    }
    const hasCjk = /[\u4e00-\u9fff]/.test(title);
    const all = collectEpisodes();
    const desc = descriptionEn.trim().slice(0, 300);
    onFillDramaInfo({
      titleEn: title || undefined,
      titleZh: hasCjk ? title : undefined,
      coverUrl: coverUrl.trim() || undefined,
      descriptionEn: desc || undefined,
      totalEpisodes: all.length || undefined,
      overwriteMeta,
    });
    setError(null);
    setFilled(true);
    onDirtyChange?.(false);
  }

  function applyToMain() {
    const all = collectEpisodes();
    if (!all.length) {
      setError(t("onlineNeedEpisodes"));
      return;
    }
    if (!onFillDramaInfo) {
      setError(t("ytdlpApplyNeedMain"));
      return;
    }
    onFillDramaInfo({
      online: {
        pageUrl: "",
        ingestForm: "link",
        episodes: all.map((ep) => ({
          episodeNumber: ep.episodeNumber,
          title: ep.title || undefined,
          sourceUrl: ep.sourceUrl,
        })),
      },
    });
    setError(null);
    setApplied(true);
    onDirtyChange?.(false);
    onBeforeNavigate?.();
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-body-sm text-danger">{error}</p> : null}

      <div className={metaClass}>
        <label className="text-caption text-ink-muted md:col-span-2">
          {t("onlineTitleZh")}
          <Input className="mt-1" value={titleZh} onChange={(e) => {
            setTitleZh(e.target.value);
            setFilled(false);
            setApplied(false);
          }} />
        </label>
        <div className="text-caption text-ink-muted md:col-span-2">
          <span className="mb-1 block">{t("uploadSectionCover")}</span>
          <DramaCoverField
            url={coverUrl || undefined}
            videoSrc={episodes.find((ep) => ep.sourceUrl.trim())?.sourceUrl || undefined}
            videoIsHls={/\.m3u8(\?|$)/i.test(
              episodes.find((ep) => ep.sourceUrl.trim())?.sourceUrl || "",
            )}
            onChange={(url) => {
              setCoverUrl(url);
              setFilled(false);
              setApplied(false);
            }}
            onError={setError}
          />
        </div>
        <label className="text-caption text-ink-muted md:col-span-2">
          {t("onlineDescEn")}
          <textarea
            className="mt-1 min-h-20 w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm"
            value={descriptionEn}
            onChange={(e) => {
              setDescriptionEn(e.target.value);
              setFilled(false);
              setApplied(false);
            }}
          />
        </label>
      </div>

      <div className={panelClass}>
        <div>
          <h3 className="text-h4 font-semibold">{t("onlineEpisodesTitle")}</h3>
          <p className="text-body-sm text-ink-muted">{t("onlineEpisodesHint")}</p>
        </div>
        <label className="block text-caption text-ink-muted">
          {t("onlineEpisodesBulk")}
          <textarea
            className="mt-1 min-h-24 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-caption"
            placeholder={"https://cdn.example.com/ep1/index.m3u8\nhttps://cdn.example.com/ep2.mp4?token=…"}
            value={bulk}
            onChange={(e) => {
              setBulk(e.target.value);
              setFilled(false);
              setApplied(false);
            }}
          />
        </label>
        <p className="text-caption text-ink-muted">{t("onlineManualUrlTip")}</p>
        {episodes.map((ep, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <label className="text-caption text-ink-muted">
              #
              <Input
                type="number"
                className="mt-1 w-16"
                value={ep.episodeNumber}
                onChange={(e) => {
                  setEpisodes((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, episodeNumber: Number(e.target.value) || 1 } : row,
                    ),
                  );
                  setFilled(false);
                  setApplied(false);
                }}
              />
            </label>
            <label className="min-w-[12rem] flex-1 text-caption text-ink-muted">
              {t("onlineEpisodeUrl")}
              <Input
                className="mt-1"
                value={ep.sourceUrl}
                onChange={(e) => {
                  setEpisodes((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, sourceUrl: e.target.value } : row)),
                  );
                  setFilled(false);
                  setApplied(false);
                }}
              />
            </label>
            <label className="min-w-[8rem] flex-1 text-caption text-ink-muted">
              {t("onlineEpisodeTitle")}
              <Input
                className="mt-1"
                value={ep.title}
                onChange={(e) => {
                  setEpisodes((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, title: e.target.value } : row)),
                  );
                  setFilled(false);
                  setApplied(false);
                }}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={episodes.length <= 1}
              onClick={() => {
                setEpisodes((rows) => rows.filter((_, i) => i !== index));
                setFilled(false);
                setApplied(false);
              }}
            >
              {t("onlineRemoveEpisode")}
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setEpisodes((rows) => [...rows, emptyEpisode((rows.at(-1)?.episodeNumber ?? 0) + 1)]);
            setFilled(false);
            setApplied(false);
          }}
        >
          {t("onlineAddEpisode")}
        </Button>
      </div>

      <div className="space-y-2 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2.5">
        <label className="flex items-start gap-2 text-caption text-ink-muted">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={overwriteMeta}
            onChange={(e) => setOverwriteMeta(e.target.checked)}
          />
          <span>{t("ytdlpOverwriteMeta")}</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-caption text-ink-muted">{t("ytdlpFillDramaInfoHint")}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className={
              filled
                ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                : undefined
            }
            disabled={!fillMode && !onFillDramaInfo}
            onClick={fillDramaMeta}
          >
            {filled ? t("ytdlpFillDramaInfoDoneBtn") : t("ytdlpFillDramaInfo")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-caption text-ink-muted">{t("ytdlpApplyToMainHint")}</p>
          </div>
          <Button
            size="sm"
            variant={applied ? "secondary" : "primary"}
            className={
              applied
                ? "border-success/40 bg-success-soft text-success hover:bg-success/15"
                : undefined
            }
            disabled={!fillMode && !onFillDramaInfo}
            onClick={applyToMain}
          >
            {applied ? t("ytdlpApplyToMainDone") : t("ytdlpApplyToMain")}
          </Button>
        </div>
      </div>
    </div>
  );
}
