/** Payload for filling the local-upload main form from online probe/manual meta. */

export type OnlineIngestForm = "r2" | "link";
export type OnlineFormatPreference = "best_hls" | "best_mp4" | "best";

export type OnlineEpisodeFill = {
  episodeNumber: number;
  title?: string;
  /** Probe item page / playlist URL (parse flow). */
  webpageUrl?: string;
  /** Direct playable URL when already known (manual paste). */
  sourceUrl?: string;
  durationSec?: number;
};

/** Staged online resources — executed only when the main window submits. */
export type OnlineSourcePackage = {
  /** Public page URL for parse/import/transfer; empty for pure manual links. */
  pageUrl: string;
  ingestForm: OnlineIngestForm;
  formatPreference?: OnlineFormatPreference;
  maxEpisodes?: number;
  episodes: OnlineEpisodeFill[];
};

export type DramaInfoFillPayload = {
  titleZh?: string;
  titleEn?: string;
  coverUrl?: string;
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
  durationSec?: number | null;
};

type ProbeLike = {
  title?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  episodes?: ProbeEpisodeLike[] | null;
};

type ProbeExtras = {
  pageUrl?: string;
  ingestForm?: OnlineIngestForm;
  formatPreference?: OnlineFormatPreference;
  maxEpisodes?: number;
  /** Include title/cover/desc/totalEpisodes. Default true. */
  includeMeta?: boolean;
  /** Include staged online package. Default true. */
  includeOnline?: boolean;
  overwriteMeta?: boolean;
};

function selectProbeEpisodes(probe: ProbeLike, maxEpisodes?: number) {
  const episodeRows = Array.isArray(probe.episodes) ? probe.episodes : [];
  const max =
    maxEpisodes && maxEpisodes > 0
      ? Math.min(maxEpisodes, episodeRows.length)
      : episodeRows.length;
  return episodeRows.slice(0, max);
}

/** Map yt-dlp probe result → main-form fields (title/cover/desc/episode count) and/or online package. */
export function dramaInfoFromYtdlpProbe(
  probe: ProbeLike,
  extras?: ProbeExtras,
): DramaInfoFillPayload {
  const includeMeta = extras?.includeMeta !== false;
  const includeOnline = extras?.includeOnline !== false;
  const selected = selectProbeEpisodes(probe, extras?.maxEpisodes);

  const payload: DramaInfoFillPayload = {};

  if (includeMeta) {
    const raw = (probe.title || "").trim();
    const title = raw.slice(0, 40);
    const hasCjk = /[\u4e00-\u9fff]/.test(title);
    const desc = (probe.description || "").trim().slice(0, 300);
    const cover = (probe.coverUrl || "").trim();
    // EN is required on the local form; use probe title as interim even for CJK.
    payload.titleEn = title || undefined;
    payload.titleZh = hasCjk ? title : undefined;
    payload.coverUrl = cover || undefined;
    payload.descriptionZh = desc || undefined;
    payload.totalEpisodes = selected.length || undefined;
    if (extras?.overwriteMeta) payload.overwriteMeta = true;
  }

  if (includeOnline) {
    payload.online = {
      pageUrl: (extras?.pageUrl || "").trim(),
      ingestForm: extras?.ingestForm || "link",
      formatPreference: extras?.formatPreference || "best_hls",
      maxEpisodes: extras?.maxEpisodes,
      episodes: selected.map((ep, i) => ({
        episodeNumber: i + 1,
        title: (ep.title || "").trim() || undefined,
        webpageUrl: (ep.webpageUrl || "").trim() || undefined,
        durationSec: typeof ep.durationSec === "number" ? ep.durationSec : undefined,
      })),
    };
  }

  return payload;
}
