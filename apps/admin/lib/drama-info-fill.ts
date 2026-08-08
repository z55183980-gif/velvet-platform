/** Payload for filling the local-upload main form from online probe/manual meta. */

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
  sourceUrl?: string | null;
  durationSec?: number | null;
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

function isDirectMediaUrl(url: string): boolean {
  return /\.(m3u8|mp4|webm|mkv)(\?|$)/i.test(url);
}

/** Map yt-dlp / AI probe result → main-form fields and/or online package. */
export function dramaInfoFromYtdlpProbe(
  probe: ProbeLike,
  extras?: ProbeExtras,
): DramaInfoFillPayload {
  const includeMeta = extras?.includeMeta !== false;
  const includeOnline = extras?.includeOnline !== false;
  const selected = selectProbeEpisodes(probe, extras?.maxEpisodes);
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
    payload.descriptionZh = desc || undefined;
    payload.totalEpisodes = selected.length || undefined;
    if (extras?.overwriteMeta) payload.overwriteMeta = true;
  }

  if (includeOnline) {
    // AI extract URLs are often episode pages / CDN links — prefer link ingest when caller omits form.
    payload.online = {
      pageUrl: (extras?.pageUrl || "").trim(),
      ingestForm: extras?.ingestForm || "link",
      formatPreference: extras?.formatPreference || "best_hls",
      maxEpisodes: extras?.maxEpisodes,
      episodes: selected.map((ep, i) => {
        const webpageUrl = (ep.webpageUrl || "").trim() || undefined;
        const sourceUrl = (ep.sourceUrl || "").trim() || undefined;
        const resolvedSource =
          sourceUrl ||
          (webpageUrl && fromAi ? webpageUrl : undefined) ||
          (webpageUrl && isDirectMediaUrl(webpageUrl) ? webpageUrl : undefined);
        return {
          episodeNumber: i + 1,
          title: (ep.title || "").trim() || undefined,
          webpageUrl,
          sourceUrl: resolvedSource,
          durationSec: typeof ep.durationSec === "number" ? ep.durationSec : undefined,
        };
      }),
    };
  }

  return payload;
}
