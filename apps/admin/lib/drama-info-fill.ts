/** Payload for filling the local-upload main form from online probe/manual meta. */

import { isPlayableMediaUrl } from "./playable-url";

export type OnlineIngestForm = "r2" | "link";
export type OnlineFormatPreference = "best_hls" | "best_mp4" | "best";

export type OnlineEpisodeFill = {
  episodeNumber: number;
  title?: string;
  /** Probe item page / playlist URL (parse flow). */
  webpageUrl?: string;
  /** Direct playable URL when already known (manual paste / AI extract). */
  sourceUrl?: string;
  durationSec?: number;
  /** yt-dlp playlist entry index when the page is a playlist. */
  playlistIndex?: number;
};

/** Staged online resources — executed only when the main window submits. */
export type OnlineSourcePackage = {
  /** Public page URL for parse/import/transfer; empty for pure manual links. */
  pageUrl: string;
  ingestForm: OnlineIngestForm;
  formatPreference?: OnlineFormatPreference;
  maxEpisodes?: number;
  episodes: OnlineEpisodeFill[];
  /** Optional yt-dlp auth carried from the online dialog into submit. */
  cookiesFile?: string;
  authBearer?: string;
  /** Burn Velvet watermark during R2 transfer transcode. */
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
};

export type DramaInfoFillPayload = {
  titleZh?: string;
  titleEn?: string;
  titleFr?: string;
  coverUrl?: string;
  /** Primary synopsis — English (matches create form / titleEn). */
  descriptionEn?: string;
  /** Optional Chinese synopsis; probe only sets this when description is CJK. */
  descriptionZh?: string;
  totalEpisodes?: number;
  /** Category is set on the main form — popup must not override unless explicit. */
  categorySlug?: string;
  /**
   * When true, overwrite non-empty main-form meta fields.
   * When false/omit, only fill blank fields. Does not affect `online` staging.
   */
  overwriteMeta?: boolean;
  online?: OnlineSourcePackage;
};

type ProbeEpisodeLike = {
  index?: number;
  title?: string | null;
  webpageUrl?: string | null;
  sourceUrl?: string | null;
  durationSec?: number | null;
  playlistIndex?: number | null;
};

type ProbeLike = {
  title?: string | null;
  titleZh?: string | null;
  titleEn?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  source?: "ai" | "ytdlp" | string | null;
  episodes?: ProbeEpisodeLike[] | null;
};

type ProbeExtras = {
  pageUrl?: string;
  ingestForm?: OnlineIngestForm;
  formatPreference?: OnlineFormatPreference;
  maxEpisodes?: number;
  /** When set, only these probe episode `index` values are staged (order preserved). */
  episodeIndexes?: number[];
  cookiesFile?: string;
  authBearer?: string;
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
  /** Include title/cover/desc/totalEpisodes. Default true. */
  includeMeta?: boolean;
  /** Include staged online package. Default true. */
  includeOnline?: boolean;
  overwriteMeta?: boolean;
};

function selectProbeEpisodes(
  probe: ProbeLike,
  opts?: { maxEpisodes?: number; episodeIndexes?: number[] },
) {
  const episodeRows = Array.isArray(probe.episodes) ? probe.episodes : [];
  let rows = episodeRows;
  if (opts?.episodeIndexes && opts.episodeIndexes.length > 0) {
    const want = new Set(opts.episodeIndexes.map(Number));
    rows = episodeRows.filter((ep) => want.has(Number(ep.index)));
  }
  const max =
    opts?.maxEpisodes && opts.maxEpisodes > 0
      ? Math.min(opts.maxEpisodes, rows.length)
      : rows.length;
  return rows.slice(0, max);
}

/** Map yt-dlp / AI probe result → main-form fields and/or online package. */
export function dramaInfoFromYtdlpProbe(
  probe: ProbeLike,
  extras?: ProbeExtras,
): DramaInfoFillPayload {
  const includeMeta = extras?.includeMeta !== false;
  const includeOnline = extras?.includeOnline !== false;
  const selected = selectProbeEpisodes(probe, {
    maxEpisodes: extras?.maxEpisodes,
    episodeIndexes: extras?.episodeIndexes,
  });
  const fromAi = probe.source === "ai";

  const payload: DramaInfoFillPayload = {};

  if (includeMeta) {
    const titleZh = (probe.titleZh || "").trim().slice(0, 40);
    const titleEn = (probe.titleEn || "").trim().slice(0, 40);
    const raw = (probe.title || "").trim().slice(0, 40);
    const hasCjk = /[\u4e00-\u9fff]/.test(raw);
    const desc = (probe.description || "").trim().slice(0, 300);
    const cover = (probe.coverUrl || "").trim();

    if (fromAi) {
      payload.titleZh = titleZh || (hasCjk ? raw : undefined);
      payload.titleEn = titleEn || raw || undefined;
    } else {
      // EN is required on the local form; use probe title as interim even for CJK.
      payload.titleEn = titleEn || raw || undefined;
      payload.titleZh = titleZh || (hasCjk ? raw : undefined);
    }
    payload.coverUrl = cover || undefined;
    // Primary description is English (same rule as titleEn). CJK also fills zh.
    if (desc) {
      payload.descriptionEn = desc;
      if (/[\u4e00-\u9fff]/.test(desc)) {
        payload.descriptionZh = desc;
      }
    }
    payload.totalEpisodes = selected.length || undefined;
    if (extras?.overwriteMeta) payload.overwriteMeta = true;
  }

  if (includeOnline) {
    // Never put episode *page* URLs into sourceUrl — only playable media.
    payload.online = {
      pageUrl: (extras?.pageUrl || "").trim(),
      ingestForm: extras?.ingestForm || "link",
      formatPreference: extras?.formatPreference || "best",
      maxEpisodes: extras?.episodeIndexes?.length
        ? extras.episodeIndexes.length
        : extras?.maxEpisodes,
      cookiesFile: extras?.cookiesFile?.trim() || undefined,
      authBearer: extras?.authBearer?.trim() || undefined,
      watermarkEnabled: extras?.watermarkEnabled,
      watermarkX: extras?.watermarkX,
      watermarkY: extras?.watermarkY,
      watermarkScale: extras?.watermarkScale,
      episodes: selected.map((ep, i) => {
        const webpageRaw = (ep.webpageUrl || "").trim() || undefined;
        const sourceRaw = (ep.sourceUrl || "").trim() || undefined;
        const playableSource = isPlayableMediaUrl(sourceRaw)
          ? sourceRaw
          : isPlayableMediaUrl(webpageRaw)
            ? webpageRaw
            : undefined;
        // Page URL stays on webpageUrl for resolve/transfer; never promote to sourceUrl.
        const webpageUrl =
          webpageRaw && !isPlayableMediaUrl(webpageRaw)
            ? webpageRaw
            : sourceRaw && !isPlayableMediaUrl(sourceRaw)
              ? sourceRaw
              : webpageRaw;
        const indexNum = Number(ep.index);
        const playlistIndex =
          typeof ep.playlistIndex === "number" && Number.isFinite(ep.playlistIndex)
            ? ep.playlistIndex
            : undefined;
        return {
          episodeNumber: Number.isFinite(indexNum) && indexNum > 0 ? indexNum : i + 1,
          title: (ep.title || "").trim() || undefined,
          webpageUrl,
          sourceUrl: playableSource,
          durationSec: typeof ep.durationSec === "number" ? ep.durationSec : undefined,
          playlistIndex,
        };
      }),
    };
  }

  return payload;
}
