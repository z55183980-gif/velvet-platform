import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { BizCode, BizException } from '../common/biz.exception';
import { OpenaiService } from '../common/openai.service';
import { signMediaPath } from '../common/media-sign.util';
import { requireSecret } from '../common/security-config';
import { UploadService } from '../upload/upload.service';
import { AdminService } from './admin.service';
import { AdminEpisodesService } from './episodes.service';
import { inferExternalUrlExpiry, isPlayableMediaUrl } from './online-drama.util';
import { LockAccessService } from '../common/lock-access.service';
import {
  YtdlpAuthOverride,
  YtdlpFormatPreference,
  YtdlpProvider,
  type YtdlpProbeResult,
} from './ytdlp.provider';
import {
  buildExtractContext,
  expandDramaPageCandidates,
  extractEpisodeLinksFromHtml,
  extractMetaFromNextData,
  isDramaboxHost,
  isNetshortHost,
  isReelshortHost,
  type ExtractedPageEpisode,
} from './online-page-extract.util';
import {
  DEFAULT_CATEGORY_SLUGS,
  inferCategorySlug,
  sanitizeCategorySlug,
} from './drama-category-infer.util';
import { mapLabelsToExistingTags } from './drama-tag-match.util';
import { safeFetchPublicText } from '../common/safe-http-fetch';

export type YtdlpImportOptions = {
  url: string;
  /** When empty, inferred from title/description before create. */
  categorySlug?: string;
  titleZh?: string;
  titleEn?: string;
  /** Optional owner for admin create; falls back to platform default. */
  creatorId?: string;
  /** Ignored — imports always create DRAFT. Kept for API compatibility. */
  status?: 'DRAFT';
  maxEpisodes?: number;
  formatPreference?: YtdlpFormatPreference;
  cookiesFile?: string;
  authBearer?: string;
};

export type YtdlpTransferEpisodeInput = {
  episodeNumber?: number;
  title?: string;
  webpageUrl?: string;
  sourceUrl?: string;
  playlistIndex?: number;
  durationSec?: number | null;
};

export type YtdlpTransferOptions = YtdlpImportOptions & {
  /** local = keep HLS on disk; r2 = push HLS to R2 after transcode */
  target: 'local' | 'r2';
  /** When set, skip yt-dlp playlist probe and transfer these episodes only. */
  episodes?: YtdlpTransferEpisodeInput[];
  /** Display tags selected by the operator or extracted from the source page. */
  sourceTags?: string[];
  coverUrl?: string;
  /** Primary synopsis (English). Legacy clients may send descriptionZh only. */
  descriptionEn?: string;
  descriptionZh?: string;
  freeEpisodeCount?: number;
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
  buyoutCredits?: number | string | null;
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
};

export type YtdlpEpisodeFailure = {
  episodeNumber: number;
  url: string;
  error: string;
};

export type YtdlpTransferJobEntry = {
  episodeId: string;
  episodeNumber: number;
  jobId: string;
  filename: string;
  size: number;
  webpageUrl?: string;
  /** Actual download target — required for correct resume / dedup. */
  downloadUrl?: string;
  sourceIndex?: number;
};

export type YtdlpTransferJobState = {
  id: string;
  dramaId: string;
  slug: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';
  target: 'local' | 'r2';
  preferR2: boolean;
  total: number;
  transferred: number;
  currentEpisode: number | null;
  failedEpisodes: YtdlpEpisodeFailure[];
  jobs: YtdlpTransferJobEntry[];
  previewUrl?: string;
  extractor?: string;
  kind?: 'single' | 'playlist';
  externalRef?: string;
  sourceType?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type TransferPayload = {
  preference: YtdlpFormatPreference;
  preferR2: boolean;
  dramaId: string;
  actorId?: string;
  cookiesFile?: string;
  /** Legacy plaintext field; new jobs use authBearerEnc. */
  authBearer?: string;
  authBearerEnc?: string;
  watermarkEnabled?: boolean;
  watermarkX?: number;
  watermarkY?: number;
  watermarkScale?: number;
  selected: Array<{
    index: number;
    id: string;
    title?: string;
    /** Page / canonical URL for bookkeeping. */
    webpageUrl: string;
    /** Preferred download target (playable media or episode page). */
    downloadUrl: string;
    sourceUrl?: string;
    playlistIndex?: number;
    durationSec?: number | null;
  }>;
  /** When true, episodeNumber follows selected.index (gaps allowed). */
  useSourceIndexAsEpisodeNumber?: boolean;
  /** Parent transfer job id when this is a resume / gap-fill run. */
  resumeOf?: string;
};

type DbTransferRow = {
  id: string;
  dramaId: bigint;
  slug: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
  target: string;
  preferR2: boolean;
  total: number;
  transferred: number;
  currentEpisode: number | null;
  failedEpisodes: unknown;
  jobs: unknown;
  payload: unknown;
  previewUrl: string | null;
  extractor: string | null;
  kind: string | null;
  externalRef: string | null;
  sourceType: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class YtdlpImportService implements OnModuleInit {
  private readonly logger = new Logger(YtdlpImportService.name);
  /** In-process lock so recover + concurrent poll doesn't double-run. */
  private readonly activeRuns = new Set<string>();
  private readonly transferEpisodeHardCap = 120;
  private readonly transferFileHardCap = 4 * 1024 * 1024 * 1024;
  private readonly transferTotalHardCap = 100 * 1024 * 1024 * 1024;
  private readonly transferMinFreeBytes = 5 * 1024 * 1024 * 1024;

  constructor(
    private readonly provider: YtdlpProvider,
    private readonly admin: AdminService,
    private readonly episodes: AdminEpisodesService,
    private readonly upload: UploadService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lockAccess: LockAccessService,
    private readonly openai: OpenaiService,
  ) {}

  async onModuleInit() {
    // Defer slightly so the HTTP server can bind first.
    setTimeout(() => {
      void this.recoverPendingTransferJobs();
    }, 1500);
  }

  async status() {
    const base = await this.provider.status();
    return {
      ...base,
      openaiConfigured: this.openai.isConfigured(),
      openaiModel: this.openai.isConfigured() ? this.openai.modelName() : null,
    };
  }

  saveCookies(hostname: string, content: Buffer | string) {
    return this.provider.saveHostCookiesFile({ hostname, content });
  }

  probe(url: string, auth?: YtdlpAuthOverride) {
    // yt-dlp cannot enumerate NetShort's encrypted episode pages. Reuse the
    // deterministic HTML/RSC catalog extractor; each page is resolved later.
    if (isNetshortHost(url) || isReelshortHost(url)) {
      return this.aiExtract({
        url,
        cookiesFile: auth?.cookiesFile,
        authBearer: auth?.bearerToken,
      });
    }
    return this.provider.probe(url, auth);
  }

  /**
   * Path B: fetch public page HTML → deterministic episode href extract (+ OpenAI meta fallback).
   * Site parsers are host-matched (ReelShort vs DramaBox). Tags come from page labels when present.
   */
  async aiExtract(opts: {
    url: string;
    maxEpisodes?: number;
    cookiesFile?: string;
    authBearer?: string;
  }) {
    const pageUrl = await this.provider.assertSafePageUrl(opts.url);
    const auth = this.authFromOpts(opts);
    const candidates = expandDramaPageCandidates(pageUrl);
    const allowedCategories = await this.listCategorySlugs();
    const dramabox = isDramaboxHost(pageUrl);
    const netshort = isNetshortHost(pageUrl);

    const episodeMap = new Map<number, ExtractedPageEpisode>();
    let bestMeta: {
      title?: string;
      coverUrl?: string;
      description?: string;
      genreLabels?: string[];
      fixedTagLabels?: string[];
      language?: string;
      paidStart?: number;
      chapterCount?: number;
    } = {};
    let bestHtml = '';
    let bestHtmlUrl = pageUrl;
    let fetchedOk = 0;
    const fetchErrors: string[] = [];

    for (const candidate of candidates) {
      const headers = this.provider.buildPageFetchHeaders(candidate, auth);
      let rawHtml: string;
      let fetchedFrom = candidate;
      try {
        // SSRF-safe: private-IP check on every redirect hop (no redirect:'follow').
        const page = await safeFetchPublicText(candidate, {
          headers,
          timeoutMs: 12_000,
          maxBytes: 4 * 1024 * 1024,
          maxRedirects: 3,
        });
        if (page.status < 200 || page.status >= 300 || !page.text) {
          fetchErrors.push(`${candidate}: HTTP ${page.status || 'empty'}`);
          continue;
        }
        rawHtml = page.text;
        fetchedFrom = page.finalUrl;
      } catch (e: unknown) {
        fetchErrors.push(
          `${candidate}: ${e instanceof Error ? e.message : String(e)}`,
        );
        continue;
      }
      fetchedOk += 1;
      if (rawHtml.length > bestHtml.length) {
        bestHtml = rawHtml;
        bestHtmlUrl = fetchedFrom;
      }

      for (const ep of extractEpisodeLinksFromHtml(rawHtml, fetchedFrom)) {
        if (!episodeMap.has(ep.episodeNumber)) episodeMap.set(ep.episodeNumber, ep);
      }

      const { meta, episodes: nextEps } = extractMetaFromNextData(
        rawHtml,
        fetchedFrom,
      );
      if (meta.title && !bestMeta.title) bestMeta.title = meta.title;
      if (meta.coverUrl && !bestMeta.coverUrl) bestMeta.coverUrl = meta.coverUrl;
      if (meta.description && !bestMeta.description) {
        bestMeta.description = meta.description;
      }
      if (meta.language && !bestMeta.language) bestMeta.language = meta.language;
      if (
        meta.paidStart &&
        (!bestMeta.paidStart || meta.paidStart < bestMeta.paidStart)
      ) {
        bestMeta.paidStart = meta.paidStart;
      }
      if (meta.chapterCount && !bestMeta.chapterCount) {
        bestMeta.chapterCount = meta.chapterCount;
      }
      if (meta.genreLabels?.length) {
        bestMeta.genreLabels = [
          ...new Set([...(bestMeta.genreLabels || []), ...meta.genreLabels]),
        ].slice(0, 6);
      }
      if (meta.fixedTagLabels?.length) {
        bestMeta.fixedTagLabels = [
          ...new Set([...(bestMeta.fixedTagLabels || []), ...meta.fixedTagLabels]),
        ].slice(0, 6);
      }
      for (const ep of nextEps) {
        // Prefer page hrefs for ReelShort (yt-dlp later); keep media URLs if no href.
        if (!episodeMap.has(ep.episodeNumber)) episodeMap.set(ep.episodeNumber, ep);
      }
    }

    let episodes = [...episodeMap.values()].sort(
      (a, b) => a.episodeNumber - b.episodeNumber,
    );

    // LLM fallback / meta enrichment when href extract is thin
    let notes = '';
    let model: string | undefined;
    let titleZh = '';
    let titleEn = bestMeta.title || '';
    // Keep historical variable name for probe.description mapping; content follows page language.
    let descriptionZh = bestMeta.description || '';
    let coverUrl = bestMeta.coverUrl || '';
    let categorySlug = '';
    const fixedTagLabels = [...(bestMeta.fixedTagLabels || [])];
    let tags = fixedTagLabels.length
      ? fixedTagLabels
      : [...(bestMeta.genreLabels || [])];

    const needLlm =
      this.openai.isConfigured() &&
      (episodes.length < 2 || !titleEn || !descriptionZh);

    if (needLlm) {
      if (!bestHtml) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          fetchErrors[0]
            ? `抓取页面失败: ${fetchErrors[0]}`
            : '抓取页面失败',
        );
      }
      const pageText = buildExtractContext(bestHtml, bestHtmlUrl);
      if (pageText.replace(/\s+/g, ' ').trim().length < 40) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          '页面文本过少，可能需登录态（请上传 cookies）或换剧集主页链接',
        );
      }
      try {
        const extracted = await this.openai.extractDramaPage({
          pageUrl: bestHtmlUrl,
          pageText,
          allowedCategorySlugs: allowedCategories,
          // DramaBox / NetShort EN pages: keep synopsis language aligned with the page.
          ...(dramabox || netshort
            ? { preferDescriptionLanguage: bestMeta.language || 'en' }
            : {}),
        });
        model = extracted.model;
        notes = extracted.notes || '';
        if (extracted.titleZh) titleZh = extracted.titleZh;
        if (extracted.titleEn) titleEn = extracted.titleEn || titleEn;
        if (extracted.coverUrl && /^https?:\/\//i.test(extracted.coverUrl)) {
          coverUrl = extracted.coverUrl;
        }
        const llmDesc =
          (dramabox || netshort
            ? extracted.descriptionEn || extracted.descriptionZh
            : extracted.descriptionZh || extracted.descriptionEn) || '';
        if (llmDesc) {
          if (
            (dramabox || netshort) &&
            descriptionZh &&
            /[\u4e00-\u9fff]/.test(llmDesc) &&
            !/[\u4e00-\u9fff]/.test(descriptionZh)
          ) {
            // Keep English page synopsis; ignore invented Chinese from LLM.
          } else {
            descriptionZh = llmDesc || descriptionZh;
          }
        }
        // ReelShort exposes authoritative /tags/ anchors. Do not let an LLM
        // append speculative labels when deterministic fixed tags exist.
        if (extracted.tags?.length && !fixedTagLabels.length) {
          tags = [...new Set([...tags, ...extracted.tags])].slice(0, 6);
        }
        const fromLlm = sanitizeCategorySlug(
          extracted.categorySlug,
          allowedCategories,
        );
        if (fromLlm) categorySlug = fromLlm;
        if (episodes.length < 2 && extracted.episodes.length) {
          for (const ep of extracted.episodes) {
            if (!episodeMap.has(ep.episodeNumber)) {
              episodeMap.set(ep.episodeNumber, ep);
            }
          }
          episodes = [...episodeMap.values()].sort(
            (a, b) => a.episodeNumber - b.episodeNumber,
          );
        }
      } catch (e: unknown) {
        // If we already have deterministic episodes, keep going; else rethrow.
        if (episodes.length === 0) throw e;
        notes = `AI meta skipped: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else if (!bestHtml && episodes.length === 0) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        fetchErrors[0]
          ? `抓取页面失败: ${fetchErrors[0]}`
          : '抓取页面失败',
      );
    } else if (episodes.length >= 2) {
      if (dramabox && bestMeta.chapterCount) {
        const withMedia = episodes.filter((ep) =>
          /\.(m3u8|mp4|webm|mkv|mov|m4v)(\?|$)/i.test(ep.sourceUrl),
        ).length;
        notes =
          `DramaBox deterministic extract from ${fetchedOk} page(s); skipped LLM. ` +
          `${episodes.length}/${bestMeta.chapterCount} chapters` +
          (withMedia < episodes.length
            ? ` (${withMedia} with direct media, rest chapter pages)`
            : '');
      } else if (netshort) {
        notes =
          `NetShort deterministic extract from ${fetchedOk} page(s); skipped LLM. ` +
          `${episodes.length} episode page URL(s) for encrypted API resolve` +
          (bestMeta.chapterCount ? ` (catalog ${bestMeta.chapterCount})` : '') +
          (bestMeta.paidStart ? `; locked from EP${bestMeta.paidStart}` : '') +
          '.';
      } else {
        notes = `Deterministic extract from ${fetchedOk} page(s); skipped LLM.`;
      }
    }

    // Soft category for DB FK only — UI backfills tags instead of category.
    if (!categorySlug) {
      const resolved = await this.resolveCategorySlug({
        title: titleZh || titleEn || bestMeta.title,
        description: descriptionZh || bestMeta.description,
        pageLabels: tags.length ? tags : bestMeta.genreLabels,
        allowedSlugs: allowedCategories,
      });
      if (resolved.slug) {
        categorySlug = resolved.slug;
        if (resolved.via === 'llm' && resolved.model) {
          model = model || resolved.model;
        }
        if (resolved.note && !dramabox && !netshort) {
          notes = notes ? `${notes} ${resolved.note}` : resolved.note;
        }
      }
    }

    const max =
      opts.maxEpisodes && opts.maxEpisodes > 0 ? Math.floor(opts.maxEpisodes) : undefined;
    if (max) episodes = episodes.slice(0, max);

    // Re-number contiguous after slice
    episodes = episodes.map((ep, i) => ({
      ...ep,
      episodeNumber: i + 1,
      title: ep.title || `EP${i + 1}`,
    }));

    if (!episodes.length) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        notes
          ? `未抽到可用分集链接：${notes}`
          : dramabox
            ? '未抽到可用分集链接。请确认 DramaBox 剧集页可访问且含 chapterList'
            : '未抽到可用分集链接。请改用剧集主页 /movie/... 或 /full-episodes/...，并确认链接可访问（非 404）',
      );
    }

    const title = (titleEn || titleZh || bestMeta.title || `AI extract`).trim();

    // Remap free-form page/LLM genres onto the closest existing dictionary keys.
    // Unknown / weak matches are dropped — never invent new DramaTagLabel rows here.
    if (tags.length && !fixedTagLabels.length) {
      const catalog = await this.prisma.dramaTagLabel.findMany({
        select: { key: true, nameEn: true, nameZh: true, nameFr: true },
      });
      tags = mapLabelsToExistingTags(tags, catalog, { max: 6 });
    }

    const probe: YtdlpProbeResult & {
      source: 'ai';
      titleZh?: string;
      titleEn?: string;
      categorySlug?: string;
      tags?: string[];
      notes?: string;
      model?: string;
      htmlChars: number;
      textChars: number;
      resolvedFrom?: string[];
      paidStart?: number;
      episodes: Array<
        YtdlpProbeResult['episodes'][number] & { sourceUrl?: string }
      >;
    } = {
      extractor: model ? 'openai+html' : 'html',
      id: `ai:${Buffer.from(pageUrl).toString('base64url').slice(0, 24)}`,
      title,
      coverUrl: /^https?:\/\//i.test(coverUrl) ? coverUrl : undefined,
      description: descriptionZh || undefined,
      webpageUrl: bestHtmlUrl || pageUrl,
      kind: episodes.length > 1 ? 'playlist' : 'single',
      source: 'ai',
      titleZh: titleZh || undefined,
      titleEn: titleEn || undefined,
      categorySlug: categorySlug || undefined,
      tags: tags.length ? tags.slice(0, 6) : undefined,
      notes: notes || undefined,
      model,
      htmlChars: bestHtml.length,
      textChars: bestHtml ? buildExtractContext(bestHtml, bestHtmlUrl).length : 0,
      resolvedFrom: candidates,
      paidStart: bestMeta.paidStart,
      episodes: episodes.map((ep) => {
        const mediaLike = /\.(m3u8|mp4|webm|mkv|mov|m4v)(\?|$)/i.test(ep.sourceUrl)
          || /\/(hls|playlist|index\.m3u8|master\.m3u8)\b/i.test(ep.sourceUrl);
        return {
          index: ep.episodeNumber,
          id: `ai-ep-${ep.episodeNumber}`,
          title: ep.title,
          webpageUrl: mediaLike ? bestHtmlUrl || pageUrl : ep.sourceUrl,
          // Page URLs must not be treated as playable sourceUrl.
          sourceUrl: mediaLike ? ep.sourceUrl : undefined,
          candidateCount: 1,
        };
      }),
    };

    this.logger.log(
      `aiExtract ${pageUrl} → ${episodes.length} eps via ${probe.extractor}` +
        ` tags=${(tags || []).join(',') || '-'} host=${
          dramabox ? 'dramabox' : netshort ? 'netshort' : 'default'
        } (fetched=${fetchedOk})`,
    );
    return probe;
  }

  resolve(
    url: string,
    formatPreference?: YtdlpFormatPreference,
    playlistIndex?: number,
    auth?: YtdlpAuthOverride,
  ) {
    return this.provider
      .resolvePlayUrl(url, formatPreference || 'best_hls', playlistIndex, auth)
      .then((playUrl) => ({
        playUrl,
        originalUrl: url,
      }));
  }

  /**
   * Resolve (if needed) then ffmpeg-extract first frame for watermark placement UI.
   * Never uses drama cover art — always a decoded video frame.
   */
  async previewFrame(opts: {
    url: string;
    formatPreference?: YtdlpFormatPreference;
    playlistIndex?: number;
    cookiesFile?: string;
    authBearer?: string;
  }) {
    const raw = String(opts.url || '').trim();
    if (!/^https?:\/\//i.test(raw)) {
      throw new BizException(BizCode.BAD_REQUEST, '请提供可访问的视频或分集页 URL');
    }
    const auth = this.authFromOpts(opts);
    let playUrl = raw;
    if (!isPlayableMediaUrl(playUrl)) {
      playUrl = await this.provider.resolvePlayUrl(
        playUrl,
        opts.formatPreference || 'best_mp4',
        opts.playlistIndex,
        auth,
      );
    }
    if (!playUrl) {
      throw new BizException(BizCode.BAD_REQUEST, '未能解析到可取帧的播放地址');
    }
    const frame = await this.upload.extractFirstFrame(playUrl);
    return { ...frame, playUrl };
  }

  /**
   * Batch-resolve episode page URLs (NetShort API or yt-dlp after AI extract).
   * Limited concurrency; skips URLs that already look like direct media.
   */
  async resolveBatch(opts: {
    episodes: Array<{ index?: number; url: string; playlistIndex?: number }>;
    formatPreference?: YtdlpFormatPreference;
    maxEpisodes?: number;
    cookiesFile?: string;
    authBearer?: string;
  }) {
    const auth = this.authFromOpts(opts);
    const pref = opts.formatPreference || 'best_hls';
    // NetShort catalogs commonly exceed the legacy 40-item batch ceiling.
    // Keep bounded + low-concurrency, but allow one complete catalog pass.
    const netshortBatch = (opts.episodes || []).some((episode) =>
      isNetshortHost(String(episode.url || '')),
    );
    const dramaboxBatch = (opts.episodes || []).some((episode) =>
      isDramaboxHost(String(episode.url || '')),
    );
    const hardCap = netshortBatch || dramaboxBatch ? 120 : 40;
    const max =
      opts.maxEpisodes && opts.maxEpisodes > 0
        ? Math.min(Math.floor(opts.maxEpisodes), hardCap)
        : hardCap;

    const items = (opts.episodes || [])
      .map((ep, i) => ({
        index: Number(ep.index) > 0 ? Number(ep.index) : i + 1,
        url: String(ep.url || '').trim(),
        playlistIndex:
          ep.playlistIndex && ep.playlistIndex > 0 ? ep.playlistIndex : undefined,
      }))
      .filter((ep) => /^https?:\/\//i.test(ep.url))
      .slice(0, max);

    if (!items.length) {
      throw new BizException(BizCode.BAD_REQUEST, '没有可解析的分集链接');
    }

    const resolved: Array<{
      index: number;
      webpageUrl: string;
      playUrl: string;
      alreadyDirect?: boolean;
    }> = [];
    const failed: Array<{ index: number; webpageUrl: string; error: string }> = [];

    const concurrency = 2;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        const ep = items[i];
        if (isPlayableMediaUrl(ep.url)) {
          resolved.push({
            index: ep.index,
            webpageUrl: ep.url,
            playUrl: ep.url,
            alreadyDirect: true,
          });
          continue;
        }
        try {
          const playUrl = await this.provider.resolvePlayUrl(
            ep.url,
            pref,
            ep.playlistIndex,
            auth,
          );
          resolved.push({
            index: ep.index,
            webpageUrl: ep.url,
            playUrl,
          });
        } catch (e: unknown) {
          failed.push({
            index: ep.index,
            webpageUrl: ep.url,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });
    await Promise.all(workers);

    resolved.sort((a, b) => a.index - b.index);
    failed.sort((a, b) => a.index - b.index);

    this.logger.log(
      `resolveBatch ok=${resolved.length} fail=${failed.length} of ${items.length}`,
    );

    return {
      total: items.length,
      resolvedCount: resolved.length,
      failedCount: failed.length,
      formatPreference: pref,
      resolved,
      failed,
    };
  }

  /**
   * Lightweight category inference for Apply-to-main when probe has no categorySlug.
   * Same stack as ai-extract: explicit → page/heuristic → LLM.
   */
  async inferCategory(opts: {
    categorySlug?: string;
    title?: string;
    description?: string;
    pageLabels?: string[];
  }) {
    const resolved = await this.resolveCategorySlug({
      categorySlug: opts.categorySlug,
      title: opts.title,
      description: opts.description,
      pageLabels: opts.pageLabels,
    });
    return {
      categorySlug: resolved.slug || null,
      via: resolved.via || null,
      note: resolved.note || null,
      model: resolved.model || null,
    };
  }

  private async listCategorySlugs(): Promise<string[]> {
    const rows = await this.prisma.category.findMany({
      select: { slug: true },
      orderBy: { sortOrder: 'asc' },
    });
    const slugs = rows.map((r) => r.slug).filter(Boolean);
    return slugs.length ? slugs : [...DEFAULT_CATEGORY_SLUGS];
  }

  /**
   * Resolve catalog category: explicit slug → page/heuristic → LLM classify.
   * confidence gate for LLM: ≥ 0.55.
   */
  private async resolveCategorySlug(opts: {
    categorySlug?: string;
    title?: string;
    description?: string;
    pageLabels?: string[];
    allowedSlugs?: string[];
  }): Promise<{ slug?: string; via?: 'explicit' | 'page' | 'heuristic' | 'llm'; note?: string; model?: string }> {
    const allowed = opts.allowedSlugs?.length
      ? opts.allowedSlugs
      : await this.listCategorySlugs();

    const explicit = sanitizeCategorySlug(opts.categorySlug, allowed);
    if (explicit) return { slug: explicit, via: 'explicit' };

    const hit = inferCategorySlug({
      allowedSlugs: allowed,
      title: opts.title,
      description: opts.description,
      pageLabels: opts.pageLabels,
    });
    if (hit) {
      return {
        slug: hit.slug,
        via: hit.source,
        note: `category=${hit.slug} via ${hit.source}`,
      };
    }

    if (!this.openai.isConfigured()) return {};

    try {
      const classified = await this.openai.classifyDramaCategory({
        title: opts.title,
        description: opts.description,
        pageLabels: opts.pageLabels,
        allowedCategorySlugs: allowed,
      });
      if (
        classified.categorySlug &&
        classified.confidence >= 0.55
      ) {
        return {
          slug: classified.categorySlug,
          via: 'llm',
          model: classified.model,
          note: `category=${classified.categorySlug} via llm (${classified.confidence.toFixed(2)})`,
        };
      }
    } catch (e: unknown) {
      this.logger.warn(
        `category classify skipped: ${e instanceof Error ? e.message : e}`,
      );
    }
    return {};
  }

  /** Prefer explicit category; if empty, infer from titles/descriptions; else default. */
  private async requireCategorySlug(opts: {
    categorySlug?: string;
    titleZh?: string;
    titleEn?: string;
    descriptionEn?: string;
    descriptionZh?: string;
  }): Promise<string> {
    const resolved = await this.resolveCategorySlug({
      categorySlug: opts.categorySlug,
      title: opts.titleZh || opts.titleEn,
      description: opts.descriptionEn || opts.descriptionZh,
    });
    if (resolved.slug) return resolved.slug;
    const fallback = await this.prisma.category.findFirst({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { slug: true },
    });
    if (fallback?.slug) return fallback.slug;
    return 'romance';
  }

  private authFromOpts(opts?: {
    cookiesFile?: string;
    authBearer?: string;
  }): YtdlpAuthOverride | undefined {
    if (!opts?.cookiesFile?.trim() && !opts?.authBearer?.trim()) return undefined;
    return {
      cookiesFile: opts.cookiesFile?.trim() || undefined,
      bearerToken: opts.authBearer?.trim() || undefined,
    };
  }

  private transferSecretKey(): Buffer {
    const configured =
      this.config.get<string>('YTDLP_PAYLOAD_KEY')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim();
    const secret = requireSecret('YTDLP_PAYLOAD_KEY', configured, 'dev-ytdlp-payload-key');
    return createHash('sha256').update(secret).digest();
  }

  private encryptBearer(value?: string): string | undefined {
    const token = String(value || '').trim();
    if (!token) return undefined;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.transferSecretKey(), iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private decryptBearer(value?: string): string | undefined {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    if (!raw.startsWith('v1.')) return raw; // legacy rows; scrubbed after claim
    const [, ivRaw, tagRaw, dataRaw] = raw.split('.');
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.transferSecretKey(),
        Buffer.from(ivRaw, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, '转存任务认证信息已失效，请重新提交');
    }
  }

  private payloadAuth(payload: TransferPayload) {
    return this.authFromOpts({
      cookiesFile: payload.cookiesFile,
      authBearer: this.decryptBearer(payload.authBearerEnc || payload.authBearer),
    });
  }

  private capTransferEpisodes(value: number | undefined, available: number): number {
    const requested = value && value > 0 ? Math.floor(value) : available;
    return Math.min(requested, available, this.transferEpisodeHardCap);
  }

  private async isTransferCancelRequested(jobId: string): Promise<boolean> {
    const row = await this.prisma.ytdlpTransferJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return row?.status === 'CANCEL_REQUESTED' || row?.status === 'CANCELLED';
  }

  private async markTransferCancelled(jobId: string) {
    await this.prisma.ytdlpTransferJob.updateMany({
      where: { id: jobId, status: { in: ['CANCEL_REQUESTED', 'RUNNING', 'QUEUED'] } },
      data: { status: 'CANCELLED', currentEpisode: null, finishedAt: new Date() },
    });
  }

  private assertTransferDiskHeadroom(dir: string) {
    const statfsSync = (fs as typeof fs & { statfsSync?: (path: string) => { bavail: number; bsize: number } }).statfsSync;
    if (!statfsSync) return;
    try {
      const stat = statfsSync(dir);
      const free = Number(stat.bavail) * Number(stat.bsize);
      if (Number.isFinite(free) && free < this.transferMinFreeBytes) {
        throw new BizException(BizCode.BAD_REQUEST, '磁盘剩余空间不足，无法继续转存');
      }
    } catch (e) {
      if (e instanceof BizException) throw e;
    }
  }

  /**
   * Download one public-page item via yt-dlp into a temp file for browser attachment download.
   * Caller must delete absPath after the response finishes.
   */
  async downloadEpisodeForBrowser(opts: {
    url: string;
    formatPreference?: YtdlpFormatPreference;
    playlistIndex?: number;
    filenameHint?: string;
    cookiesFile?: string;
    authBearer?: string;
  }): Promise<{ absPath: string; filename: string; size: number; mime: string }> {
    const pageUrl = String(opts.url || '').trim();
    if (!pageUrl) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');

    const tmpDir = path.join(this.upload.getStorageRoot(), 'tmp', 'ytdlp-browser-dl');
    fs.mkdirSync(tmpDir, { recursive: true });

    // HLS playlists are not useful as a single browser attachment — prefer a merged MP4.
    const pref: YtdlpFormatPreference =
      opts.formatPreference === 'best_hls'
        ? 'best_mp4'
        : opts.formatPreference || 'best_mp4';

    const downloaded = await this.provider.downloadToFile(
      pageUrl,
      tmpDir,
      pref,
      opts.playlistIndex,
      this.authFromOpts(opts),
    );

    const ext = path.extname(downloaded.absPath) || '.mp4';
    const filename = this.safeDownloadFilename(opts.filenameHint, downloaded.filename, ext);
    const mime =
      ext.toLowerCase() === '.webm'
        ? 'video/webm'
        : ext.toLowerCase() === '.mkv'
          ? 'video/x-matroska'
          : 'video/mp4';

    return {
      absPath: downloaded.absPath,
      filename,
      size: downloaded.size,
      mime,
    };
  }

  private safeDownloadFilename(hint: string | undefined, fallback: string, ext: string) {
    const raw = String(hint || fallback || 'episode')
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    const base = raw || 'episode';
    if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
    return `${base}${ext.startsWith('.') ? ext : `.${ext}`}`;
  }

  async getTransferJob(jobId: string): Promise<YtdlpTransferJobState> {
    const job = await this.prisma.ytdlpTransferJob.findUnique({
      where: { id: String(jobId || '').trim() },
    });
    if (!job) throw new BizException(BizCode.NOT_FOUND, '转存任务不存在或已过期');
    return this.toPublicState(job as DbTransferRow);
  }

  async cancelTransferJob(jobId: string) {
    const id = String(jobId || '').trim();
    if (!id) throw new BizException(BizCode.BAD_REQUEST, '转存任务 ID 无效');
    const queued = await this.prisma.ytdlpTransferJob.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'CANCELLED', currentEpisode: null, finishedAt: new Date() },
    });
    const result = queued.count
      ? queued
      : await this.prisma.ytdlpTransferJob.updateMany({
          where: { id, status: 'RUNNING' },
          data: { status: 'CANCEL_REQUESTED', currentEpisode: null },
        });
    if (!result.count) {
      const row = await this.prisma.ytdlpTransferJob.findUnique({ where: { id } });
      if (!row) throw new BizException(BizCode.NOT_FOUND, '转存任务不存在');
      return this.toPublicState(row as DbTransferRow);
    }
    const row = await this.prisma.ytdlpTransferJob.findUnique({ where: { id } });
    if (!row) throw new BizException(BizCode.NOT_FOUND, '转存任务不存在');
    return this.toPublicState(row as DbTransferRow);
  }

  async importDrama(opts: YtdlpImportOptions, actorId?: bigint) {
    const pageUrl = String(opts.url || '').trim();
    if (!pageUrl) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');
    const categorySlug = await this.requireCategorySlug(opts);

    const auth = this.authFromOpts(opts);
    const probe = await this.probe(pageUrl, auth);
    const externalRef = this.provider.externalRefFor(
      probe.webpageUrl,
      probe.extractor,
      probe.id,
    );

    const existing = await this.prisma.drama.findFirst({
      where: { externalRef } as any,
      select: { id: true, slug: true, titleZh: true, status: true },
    });
    if (existing) {
      throw new BizException(
        BizCode.CONFLICT,
        `该公开资源已导入: id=${existing.id} slug=${existing.slug}`,
      );
    }

    if (!probe.episodes.length) {
      throw new BizException(BizCode.BAD_REQUEST, '未解析到分集，无法导入');
    }

    const preference = opts.formatPreference || 'best_hls';
    const limit =
      opts.maxEpisodes && opts.maxEpisodes > 0
        ? Math.min(opts.maxEpisodes, probe.episodes.length)
        : probe.episodes.length;
    const selected = probe.episodes.slice(0, limit);

    const episodes: Array<{
      episodeNumber: number;
      title?: string;
      sourceUrl: string;
      sourcePageUrl?: string;
      sourceProvider?: string;
      externalVideoId?: string;
      playlistIndex?: number;
      isFree?: boolean;
    }> = [];
    const errors: YtdlpEpisodeFailure[] = [];

    for (const ep of selected) {
      try {
        const playUrl = await this.provider.resolvePlayUrl(
          ep.webpageUrl,
          preference,
          ep.playlistIndex,
          auth,
        );
        // Consecutive 1..n so partial resolve failures do not leave publish gaps.
        const episodeNumber = episodes.length + 1;
        episodes.push({
          episodeNumber,
          title: ep.title || `第 ${episodeNumber} 集`,
          sourceUrl: playUrl,
          sourcePageUrl: ep.webpageUrl,
          sourceProvider: probe.extractor,
          externalVideoId: ep.id,
          playlistIndex: ep.playlistIndex,
          isFree: episodeNumber <= 3,
        });
      } catch (e: any) {
        this.logger.warn(`resolve ep ${ep.index} failed: ${e?.message || e}`);
        errors.push({
          episodeNumber: ep.index,
          url: ep.webpageUrl,
          error: e?.message || 'resolve failed',
        });
      }
    }

    if (!episodes.length) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `全部分集播放地址解析失败（${errors.length}）`,
      );
    }

    const titleEn = (opts.titleEn || probe.title || opts.titleZh || '').trim();
    if (!titleEn) {
      throw new BizException(BizCode.BAD_REQUEST, '英文标题必填');
    }
    const titleZh = (opts.titleZh || '').trim() || undefined;
    const probeDesc = (probe.description || '').trim() || undefined;
    const created = await this.admin.createOnlineDrama(
      {
        titleEn,
        titleZh,
        descriptionEn: probeDesc,
        // Only put CJK probe text into zh; do not duplicate English into both fields.
        descriptionZh:
          probeDesc && /[\u4e00-\u9fff]/.test(probeDesc) ? probeDesc : undefined,
        categorySlug,
        coverUrl: probe.coverUrl,
        creatorId: opts.creatorId,
        lockMode: 'FREE_FIRST_N',
        freeEpisodeCount: 3,
        // 拉取的第三方内容必须先完成来源/可播审核，不允许直接上线。
        status: 'DRAFT',
        externalRef,
        sourceTags: [
          'ytdlp',
          probe.extractor,
          `ytdlp:${probe.id}`,
          ...(probe.tags || []),
        ],
        relaxedPlayUrl: true,
        episodes,
      },
      actorId,
    );

    return {
      ...created,
      externalRef,
      extractor: probe.extractor,
      kind: probe.kind,
      resolvedEpisodes: episodes.length,
      failedEpisodes: errors,
    };
  }

  /** 将公开页面/播放列表解析后追加到已有草稿作品，并按外部视频 ID 去重。 */
  async appendToDrama(
    dramaId: string,
    opts: Pick<
      YtdlpImportOptions,
      'url' | 'maxEpisodes' | 'formatPreference' | 'cookiesFile' | 'authBearer'
    >,
    actorId?: bigint,
  ) {
    const drama = await this.prisma.drama.findUnique({ where: { id: BigInt(dramaId) } });
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'drama.notFound');
    if (drama.sourceType !== 'ONLINE') {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '仅外链播放剧可追加公开资源；托管剧请用上传或转存',
      );
    }
    if (drama.status !== 'DRAFT' && drama.status !== 'REJECTED' && drama.status !== 'OFFLINE') {
      throw new BizException(BizCode.CONFLICT, '审核中或已上线作品不能追加公开资源');
    }
    const auth = this.authFromOpts(opts);
    const probe = await this.probe(opts.url, auth);
    const limit = opts.maxEpisodes && opts.maxEpisodes > 0
      ? Math.min(Math.floor(opts.maxEpisodes), probe.episodes.length)
      : probe.episodes.length;
    const selected = probe.episodes.slice(0, limit);
    const existing = await this.prisma.episode.findMany({
      where: { dramaId: drama.id, sourceProvider: probe.extractor },
      select: { externalVideoId: true },
    });
    const seen = new Set(existing.map((ep) => ep.externalVideoId).filter(Boolean));
    const added: Array<{ id: string; episodeNumber: number; title?: string }> = [];
    const skipped: Array<{ externalVideoId: string; reason: string }> = [];
    const errors: Array<{ externalVideoId: string; error: string }> = [];
    const policy = await this.lockAccess.resolveForDrama(drama);
    const maxAgg = await this.prisma.episode.aggregate({
      where: { dramaId: drama.id },
      _max: { episodeNumber: true },
    });
    let nextNumber = (maxAgg._max.episodeNumber ?? 0) + 1;

    for (const source of selected) {
      if (seen.has(source.id)) {
        skipped.push({ externalVideoId: source.id, reason: 'duplicate' });
        continue;
      }
      try {
        const playUrl = await this.provider.resolvePlayUrl(
          source.webpageUrl,
          opts.formatPreference || 'best_hls',
          source.playlistIndex,
          auth,
        );
        const isFree = this.lockAccess.isFree(
          { isFree: false, episodeNumber: nextNumber },
          policy,
        );
        const created = await this.episodes.create(
          dramaId,
          {
            title: source.title,
            episodeNumber: nextNumber,
            isFree,
            priceCredits: isFree ? 0 : 10,
            hlsUrl: playUrl,
            originalUrl: playUrl,
          },
          actorId,
        );
        nextNumber += 1;
        await this.prisma.episode.update({
          where: { id: BigInt(created.id) },
          data: {
            sourcePageUrl: source.webpageUrl,
            sourceProvider: probe.extractor,
            externalVideoId: source.id,
            playlistIndex: source.playlistIndex,
            resolvedAt: new Date(),
            resolvedExpiresAt: inferExternalUrlExpiry(playUrl),
            transcodeStatus: 'COMPLETED',
          },
        });
        added.push({ id: created.id, episodeNumber: created.episodeNumber, title: source.title });
        seen.add(source.id);
      } catch (e: any) {
        errors.push({ externalVideoId: source.id, error: e?.message || String(e) });
      }
    }
    await this.prisma.drama.update({
      where: { id: drama.id },
      data: { status: 'DRAFT', totalEpisodes: await this.prisma.episode.count({ where: { dramaId: drama.id } }) },
    });
    return { added, skipped, errors, extractor: probe.extractor };
  }

  /**
   * Start async transfer: create drama shell immediately, download+transcode in background.
   * Poll GET /ytdlp/transfer/:jobId for progress. Job state is DB-backed (survives restart).
   *
   * When `opts.episodes` is provided (AI/manual selection), skip playlist probe and
   * download only those URLs (prefer playable sourceUrl, else webpageUrl).
   */
  async transferDrama(opts: YtdlpTransferOptions, actorId?: bigint) {
    const pageUrl = String(opts.url || '').trim();
    const categorySlug = await this.requireCategorySlug(opts);
    const target = opts.target === 'r2' ? 'r2' : 'local';

    const storage = this.upload.storageStatus();
    if (target === 'r2' && !storage.r2Configured) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'R2 未配置凭证，无法转存到 R2（请设置 R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY）',
      );
    }
    if (!(await this.upload.detectFfmpeg())) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '未检测到 ffmpeg，无法转码。请安装 ffmpeg 或设置 FFMPEG_PATH 后重试',
      );
    }

    const auth = this.authFromOpts(opts);
    const preference =
      opts.formatPreference === 'best_hls' ? 'best' : opts.formatPreference || 'best';
    const explicit = this.normalizeTransferEpisodes(opts.episodes);

    let selected: TransferPayload['selected'];
    let extractor: string;
    let probeId: string;
    let kind: 'single' | 'playlist';
    let coverUrl = opts.coverUrl?.trim() || undefined;
    let descriptionEn: string | undefined;
    let descriptionZh: string | undefined;
    if (opts.descriptionEn?.trim() && opts.descriptionZh?.trim()) {
      // Both provided explicitly — keep zh separately (do not wipe).
      descriptionZh = opts.descriptionZh.trim();
      descriptionEn = opts.descriptionEn.trim();
    } else if (opts.descriptionEn?.trim()) {
      descriptionEn = opts.descriptionEn.trim();
    } else if (opts.descriptionZh?.trim()) {
      // Legacy: single field was named descriptionZh but held primary (EN) synopsis.
      const legacy = opts.descriptionZh.trim();
      if (/[\u4e00-\u9fff]/.test(legacy)) {
        descriptionZh = legacy;
      } else {
        descriptionEn = legacy;
      }
    }
    let probeTitle: string | undefined;
    let refUrl = pageUrl;

    if (explicit.length) {
      const limit = this.capTransferEpisodes(opts.maxEpisodes, explicit.length);
      selected = explicit.slice(0, limit);
      if (!refUrl) refUrl = selected[0]?.webpageUrl || selected[0]?.downloadUrl || '';
      if (!refUrl) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');
      extractor = 'episode-list';
      probeId = createHash('sha1')
        .update(selected.map((ep) => ep.downloadUrl).join('|'))
        .digest('hex')
        .slice(0, 20);
      kind = selected.length > 1 ? 'playlist' : 'single';
    } else {
      if (!pageUrl) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');
      const probe = await this.probe(pageUrl, auth);
      if (!probe.episodes.length) {
        throw new BizException(BizCode.BAD_REQUEST, '未解析到分集，无法转存');
      }
      const limit = this.capTransferEpisodes(opts.maxEpisodes, probe.episodes.length);
      selected = probe.episodes.slice(0, limit).map((ep) => ({
        index: ep.index,
        id: ep.id,
        title: ep.title,
        webpageUrl: ep.webpageUrl,
        downloadUrl: ep.webpageUrl,
        playlistIndex: ep.playlistIndex,
        durationSec: ep.durationSec ?? null,
      }));
      extractor = probe.extractor;
      probeId = probe.id;
      kind = probe.kind;
      coverUrl = coverUrl || probe.coverUrl;
      const probeDesc = probe.description || undefined;
      if (!descriptionEn && !descriptionZh && probeDesc) {
        descriptionEn = probeDesc;
        if (/[\u4e00-\u9fff]/.test(probeDesc)) {
          descriptionZh = probeDesc;
        }
      }
      probeTitle = probe.title;
      refUrl = probe.webpageUrl || pageUrl;
    }

    const externalRef = this.provider.externalRefFor(refUrl, extractor, probeId);

    const existing = await this.prisma.drama.findFirst({
      where: { externalRef } as any,
      select: { id: true, slug: true, titleZh: true, status: true },
    });
    if (existing) {
      throw new BizException(
        BizCode.CONFLICT,
        `该公开资源已导入: id=${existing.id} slug=${existing.slug}`,
      );
    }

    const titleEn = (opts.titleEn || probeTitle || opts.titleZh || '').trim();
    if (!titleEn) {
      throw new BizException(BizCode.BAD_REQUEST, '英文标题必填');
    }
    const titleZh = (opts.titleZh || '').trim() || undefined;
    const sourceType = target === 'r2' ? 'R2' : 'LOCAL';
    const freeEpisodeCount =
      opts.freeEpisodeCount != null
        ? Math.max(0, Math.floor(Number(opts.freeEpisodeCount)))
        : selected.length;
    const lockMode =
      opts.lockMode === undefined
        ? 'ALL_FREE'
        : opts.lockMode === null || opts.lockMode === 'INHERIT'
          ? null
          : opts.lockMode;
    const drama = await this.admin.createLocalUploadDrama(
      {
        titleEn,
        titleZh,
        descriptionEn,
        descriptionZh,
        categorySlug,
        coverUrl,
        creatorId: opts.creatorId,
        lockMode,
        freeEpisodeCount,
        buyoutCredits: opts.buyoutCredits,
        status: 'DRAFT',
        sourceType,
        sourceTags: [
          'ytdlp',
          'transfer',
          target,
          extractor,
          `ytdlp:${probeId}`,
          ...(opts.sourceTags || []),
        ],
        totalEpisodes: selected.length,
        externalRef,
      },
      actorId,
    );

    const preferR2 = target === 'r2';
    const jobId = randomUUID();
    const payload: TransferPayload = {
      preference,
      preferR2,
      dramaId: drama.id,
      actorId: actorId != null ? String(actorId) : undefined,
      cookiesFile: opts.cookiesFile?.trim() || undefined,
      authBearerEnc: this.encryptBearer(opts.authBearer),
      watermarkEnabled: !!opts.watermarkEnabled,
      watermarkX: opts.watermarkX,
      watermarkY: opts.watermarkY,
      watermarkScale: opts.watermarkScale,
      selected,
      useSourceIndexAsEpisodeNumber: true,
    };

    const row = await this.prisma.ytdlpTransferJob.create({
      data: {
        id: jobId,
        dramaId: BigInt(drama.id),
        slug: drama.slug,
        status: 'QUEUED',
        target,
        preferR2,
        total: selected.length,
        transferred: 0,
        currentEpisode: null,
        failedEpisodes: [],
        jobs: [],
        payload: payload as any,
        extractor,
        kind,
        externalRef,
        sourceType: drama.sourceType,
      },
    });

    void this.runTransferJob(jobId);
    await this.pruneTransferJobs();

    return {
      jobId: row.id,
      id: drama.id,
      slug: drama.slug,
      status: drama.status,
      jobStatus: 'queued' as const,
      sourceType: drama.sourceType,
      target,
      preferR2,
      storageBackend: storage.storageBackend,
      r2Configured: storage.r2Configured,
      ffmpegReady: true,
      extractor,
      kind,
      externalRef,
      totalEpisodes: selected.length,
      transferredEpisodes: 0,
      failedEpisodes: [] as YtdlpEpisodeFailure[],
      jobs: [] as YtdlpTransferJobEntry[],
      async: true as const,
    };
  }

  private normalizeTransferEpisodes(
    episodes?: YtdlpTransferEpisodeInput[],
  ): TransferPayload['selected'] {
    if (!Array.isArray(episodes) || !episodes.length) return [];
    const out: TransferPayload['selected'] = [];
    const seenIndexes = new Set<number>();
    const seenUrls = new Set<string>();
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const sourceUrl = String(ep.sourceUrl || '').trim() || undefined;
      const webpageUrl = String(ep.webpageUrl || '').trim() || undefined;
      const downloadUrl =
        (sourceUrl && isPlayableMediaUrl(sourceUrl) ? sourceUrl : undefined) ||
        webpageUrl ||
        sourceUrl;
      if (!downloadUrl) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          `第 ${ep.episodeNumber || i + 1} 集缺少下载地址（webpageUrl / sourceUrl）`,
        );
      }
      const n = Number(ep.episodeNumber);
      const index = Number.isFinite(n) && n > 0 ? n : i + 1;
      if (seenIndexes.has(index)) {
        throw new BizException(BizCode.BAD_REQUEST, `重复集号: ${index}`);
      }
      if (!/^https?:\/\//i.test(downloadUrl)) {
        throw new BizException(BizCode.BAD_REQUEST, `第 ${index} 集仅支持 http/https 地址`);
      }
      const urlKey = downloadUrl.trim();
      if (seenUrls.has(urlKey)) {
        throw new BizException(BizCode.BAD_REQUEST, `重复下载地址: ${urlKey}`);
      }
      seenIndexes.add(index);
      seenUrls.add(urlKey);
      out.push({
        index,
        id: `xfer-ep-${index}`,
        title: (ep.title || '').trim() || undefined,
        webpageUrl: webpageUrl || downloadUrl,
        downloadUrl,
        sourceUrl,
        playlistIndex: ep.playlistIndex,
        durationSec: ep.durationSec ?? null,
      });
    }
    return out;
  }

  private async recoverPendingTransferJobs() {
    try {
      let recovered = 0;
      const pendingIds: string[] = [];
      let skip = 0;
      while (true) {
        const pending = await this.prisma.ytdlpTransferJob.findMany({
          where: {
            status: { in: ['QUEUED', 'RUNNING'] },
            // Telegram jobs are recovered by TelegramImportService.
            NOT: { extractor: 'telegram' },
          },
          orderBy: { createdAt: 'asc' },
          take: 20,
          skip,
          select: { id: true },
        });
        if (!pending.length) break;
        pendingIds.push(...pending.map((job) => job.id));
        skip += pending.length;
        if (pending.length < 20) break;
      }
      for (const id of pendingIds) {
        const job = await this.prisma.ytdlpTransferJob.findUnique({ where: { id } });
        if (!job || (job.status !== 'QUEUED' && job.status !== 'RUNNING')) continue;
        if (job.status === 'RUNNING') {
          await this.prisma.ytdlpTransferJob.updateMany({
            where: { id: job.id, status: 'RUNNING' },
            data: { status: 'QUEUED', currentEpisode: null },
          });
        }
        void this.runTransferJob(job.id);
        recovered += 1;
      }
      if (recovered) this.logger.log(`recovered ${recovered} ytdlp transfer job(s)`);
    } catch (e: any) {
      this.logger.warn(`transfer job recover skipped: ${e?.message || e}`);
    }
  }

  /**
   * Gap-fill a COMPLETED/FAILED transfer: optionally realign drama episodeNumbers
   * to selected.sourceIndex, then queue a new job for missing download targets.
   */
  async resumeTransferJob(
    jobId: string,
    opts?: { realignEpisodeNumbers?: boolean },
    actorId?: bigint,
  ) {
    const row = await this.prisma.ytdlpTransferJob.findUnique({
      where: { id: String(jobId || '').trim() },
    });
    if (!row) throw new BizException(BizCode.NOT_FOUND, '转存任务不存在');
    if (row.status === 'QUEUED' || row.status === 'RUNNING') {
      throw new BizException(BizCode.CONFLICT, '转存任务仍在进行中，请稍后再试');
    }

    const payload = row.payload as TransferPayload;
    if (!payload?.selected?.length) {
      throw new BizException(BizCode.BAD_REQUEST, '转存任务缺少分集载荷，无法续跑');
    }

    const existingJobs = this.parseJobs(row.jobs);
    const done = this.transferDoneKeys(existingJobs);
    const missing = payload.selected.filter((ep) => {
      const downloadUrl =
        (ep as { downloadUrl?: string }).downloadUrl ||
        ep.sourceUrl ||
        ep.webpageUrl;
      return !this.isTransferItemDone(done, ep.index, downloadUrl);
    });

    if (!missing.length) {
      const total = await this.prisma.episode.count({
        where: { dramaId: row.dramaId },
      });
      await this.prisma.drama
        .update({
          where: { id: row.dramaId },
          data: { totalEpisodes: total },
        })
        .catch(() => undefined);
      return {
        resumed: false as const,
        reason: 'already_complete' as const,
        dramaId: row.dramaId.toString(),
        slug: row.slug,
        missing: 0,
        totalEpisodes: total,
        parentJobId: row.id,
      };
    }

    if (opts?.realignEpisodeNumbers !== false) {
      await this.realignTransferEpisodeNumbers(row, existingJobs);
    }

    const preferR2 = row.preferR2;
    const target = row.target === 'r2' ? 'r2' : 'local';
    const newJobId = randomUUID();
    const nextPayload: TransferPayload = {
      ...payload,
      actorId: actorId != null ? String(actorId) : payload.actorId,
      selected: missing,
      useSourceIndexAsEpisodeNumber: true,
      resumeOf: row.id,
    };

    const created = await this.prisma.ytdlpTransferJob.create({
      data: {
        id: newJobId,
        dramaId: row.dramaId,
        slug: row.slug,
        status: 'QUEUED',
        target,
        preferR2,
        total: missing.length,
        transferred: 0,
        currentEpisode: null,
        failedEpisodes: [],
        jobs: [],
        payload: nextPayload as any,
        extractor: row.extractor,
        kind: row.kind,
        externalRef: row.externalRef,
        sourceType: row.sourceType,
      },
    });

    void this.runTransferJob(newJobId);
    await this.pruneTransferJobs();

    return {
      resumed: true as const,
      jobId: created.id,
      parentJobId: row.id,
      dramaId: row.dramaId.toString(),
      slug: row.slug,
      missing: missing.length,
      missingIndexes: missing.map((m) => m.index),
      target,
      preferR2,
      jobStatus: 'queued' as const,
      async: true as const,
    };
  }

  /** Move existing transferred episodes so episodeNumber === sourceIndex. */
  private async realignTransferEpisodeNumbers(
    row: { id: string; dramaId: bigint },
    jobs: YtdlpTransferJobEntry[],
  ) {
    const withIndex = jobs.filter(
      (j) => j.episodeId && j.sourceIndex != null && Number(j.sourceIndex) > 0,
    );
    if (!withIndex.length) return;

    // Two-pass to satisfy @@unique([dramaId, episodeNumber]).
    for (const j of withIndex) {
      const sourceIndex = Number(j.sourceIndex);
      await this.prisma.episode.update({
        where: { id: BigInt(j.episodeId) },
        data: { episodeNumber: 1_000_000 + sourceIndex },
      });
    }
    for (const j of withIndex) {
      const sourceIndex = Number(j.sourceIndex);
      await this.prisma.episode.update({
        where: { id: BigInt(j.episodeId) },
        data: {
          episodeNumber: sourceIndex,
          title: `第 ${sourceIndex} 集`,
        },
      });
    }

    const realigned = jobs.map((j) =>
      j.sourceIndex != null && Number(j.sourceIndex) > 0
        ? { ...j, episodeNumber: Number(j.sourceIndex) }
        : j,
    );
    await this.prisma.ytdlpTransferJob.update({
      where: { id: row.id },
      data: { jobs: realigned as any },
    });

    const total = await this.prisma.episode.count({ where: { dramaId: row.dramaId } });
    await this.prisma.drama
      .update({
        where: { id: row.dramaId },
        data: { totalEpisodes: total },
      })
      .catch(() => undefined);

    this.logger.log(
      `realigned ${withIndex.length} episode number(s) for drama=${row.dramaId} from transfer ${row.id}`,
    );
  }

  private transferDoneKeys(jobs: YtdlpTransferJobEntry[]) {
    const keys = new Set<string>();
    for (const j of jobs) {
      if (j.downloadUrl) keys.add(`dl:${j.downloadUrl}`);
      if (j.sourceIndex != null && Number(j.sourceIndex) > 0) {
        keys.add(`idx:${Number(j.sourceIndex)}`);
      }
    }
    return keys;
  }

  private isTransferItemDone(
    done: Set<string>,
    sourceIndex: number,
    downloadUrl: string,
  ) {
    if (downloadUrl && done.has(`dl:${downloadUrl}`)) return true;
    if (sourceIndex > 0 && done.has(`idx:${sourceIndex}`)) return true;
    return false;
  }

  private async runTransferJob(jobId: string) {
    if (this.activeRuns.has(jobId)) return;
    this.activeRuns.add(jobId);

    try {
      const row = await this.prisma.ytdlpTransferJob.findUnique({ where: { id: jobId } });
      if (!row) return;
      if (row.status === 'COMPLETED' || row.status === 'FAILED' || row.status === 'CANCELLED') return;

      let payload = row.payload as TransferPayload;
      if (!payload?.selected?.length) {
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: '转存任务缺少分集载荷，无法恢复',
            finishedAt: new Date(),
          },
        });
        return;
      }

      // Cross-instance claim: only one worker can transition QUEUED → RUNNING.
      // The in-process Set remains useful as a cheap duplicate guard, but is
      // not relied upon for correctness.
      const claimed = await this.prisma.ytdlpTransferJob.updateMany({
        where: { id: jobId, status: 'QUEUED' },
        data: {
          status: 'RUNNING',
          startedAt: row.startedAt ?? new Date(),
          attempts: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return;

      // Migrate legacy plaintext payloads on first claim. New rows never
      // persist the bearer token in clear text.
      if (payload.authBearer && !payload.authBearerEnc) {
        const migrated: TransferPayload = {
          ...payload,
          authBearerEnc: this.encryptBearer(payload.authBearer),
        };
        delete migrated.authBearer;
        payload = migrated;
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: { payload: migrated as any },
        });
      }

      const uploadDir = this.upload.getUploadDir();
      const extractor = row.extractor || 'unknown';
      const actorId = payload.actorId != null ? BigInt(payload.actorId) : undefined;
      let jobs = this.parseJobs(row.jobs);
      let failedEpisodes = this.parseFailures(row.failedEpisodes);
      let totalDownloadedBytes = jobs.reduce((sum, item) => sum + Math.max(0, Number(item.size) || 0), 0);
      // Dedup by downloadUrl + sourceIndex only — never by webpageUrl alone.
      // Dramabox-style lists often share one episode page URL across many m3u8s.
      const done = this.transferDoneKeys(jobs);
      const useSourceIndex =
        payload.useSourceIndexAsEpisodeNumber !== false || !!payload.resumeOf;

      for (const ep of payload.selected) {
        if (await this.isTransferCancelRequested(jobId)) {
          await this.markTransferCancelled(jobId);
          return;
        }
        const downloadUrl =
          (ep as { downloadUrl?: string }).downloadUrl ||
          ep.sourceUrl ||
          ep.webpageUrl;
        if (this.isTransferItemDone(done, ep.index, downloadUrl)) continue;

        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: { currentEpisode: ep.index },
        });

        try {
          const episodeNumber = useSourceIndex ? ep.index : jobs.length + 1;

          const occupied = await this.prisma.episode.findUnique({
            where: {
              dramaId_episodeNumber: {
                dramaId: BigInt(payload.dramaId),
                episodeNumber,
              },
            },
            select: { id: true, originalUrl: true, hlsUrl: true, transcodeStatus: true },
          });
          if (occupied) {
            // Recovery compensation: an Episode may have been committed before
            // the transfer JSON update. Reuse/repair its transcode job instead
            // of silently skipping it forever.
            const existingJob = await this.prisma.mediaTranscodeJob.findFirst({
              where: { episodeId: occupied.id },
              orderBy: { createdAt: 'desc' },
              select: { id: true, status: true },
            });
            const inputRel = occupied.originalUrl || occupied.hlsUrl || '';
            const inputAbs = inputRel ? this.upload.resolveAbs(inputRel) : '';
            let mediaJobId = existingJob?.id;
            if (
              occupied.transcodeStatus !== 'COMPLETED' &&
              inputAbs &&
              fs.existsSync(inputAbs) &&
              (!existingJob || existingJob.status === 'FAILED')
            ) {
              const repaired = await this.upload.enqueueTranscode(inputRel, String(occupied.id), {
                preferR2: payload.preferR2,
                watermarkEnabled: !!payload.watermarkEnabled,
                watermarkX: payload.watermarkX,
                watermarkY: payload.watermarkY,
                watermarkScale: payload.watermarkScale,
              });
              mediaJobId = repaired.id;
            }
            const entry: YtdlpTransferJobEntry = {
              episodeId: String(occupied.id),
              episodeNumber,
              jobId: mediaJobId || 'existing',
              filename: inputAbs ? path.basename(inputAbs) : '',
              size: inputAbs && fs.existsSync(inputAbs) ? fs.statSync(inputAbs).size : 0,
              webpageUrl: ep.webpageUrl,
              downloadUrl,
              sourceIndex: ep.index,
            };
            jobs = [...jobs, entry];
            done.add(`idx:${ep.index}`);
            if (downloadUrl) done.add(`dl:${downloadUrl}`);
            await this.prisma.ytdlpTransferJob.update({
              where: { id: jobId },
              data: { jobs: jobs as any, transferred: jobs.length },
            });
            continue;
          }

          this.assertTransferDiskHeadroom(uploadDir);
          const downloaded = await this.provider.downloadToFile(
            downloadUrl,
            uploadDir,
            payload.preference,
            ep.playlistIndex,
            this.payloadAuth(payload),
          );
          if (downloaded.size > this.transferFileHardCap) {
            try { fs.unlinkSync(downloaded.absPath); } catch { /* best effort */ }
            throw new BizException(BizCode.BAD_REQUEST, '单集文件超过转存大小上限');
          }
          totalDownloadedBytes += downloaded.size;
          if (totalDownloadedBytes > this.transferTotalHardCap) {
            try { fs.unlinkSync(downloaded.absPath); } catch { /* best effort */ }
            throw new BizException(BizCode.BAD_REQUEST, '任务总文件大小超过转存上限');
          }
          const relativePath = `uploads/${path.basename(downloaded.absPath)}`;
          const absInUploads = this.upload.resolveAbs(relativePath);
          if (path.resolve(downloaded.absPath) !== path.resolve(absInUploads)) {
            fs.copyFileSync(downloaded.absPath, absInUploads);
            try {
              fs.unlinkSync(downloaded.absPath);
            } catch {
              /* ignore */
            }
          }

          const created = await this.episodes.create(
            payload.dramaId,
            {
              title: ep.title || `第 ${episodeNumber} 集`,
              episodeNumber,
              isFree: true,
              originalUrl: relativePath,
              hlsUrl: relativePath,
            },
            actorId,
          );

          // Default episode poster: ffmpeg first frame → permanent covers/ asset.
          const thumbnailUrl = await this.autoEpisodeThumbnailFromVideo(
            relativePath,
            `ep-${created.id}`,
          );

          await this.prisma.episode.update({
            where: { id: BigInt(created.id) },
            data: {
              originalUrl: relativePath,
              hlsUrl: relativePath,
              uploadStatus: 'COMPLETED',
              transcodeStatus: 'PENDING',
              // Provenance only — playback must not re-resolve this into hlsUrl.
              sourcePageUrl: ep.webpageUrl,
              sourceProvider: extractor,
              externalVideoId: ep.id,
              playlistIndex: ep.playlistIndex ?? null,
              resolvedAt: new Date(),
              // Far-future expiry blocks legacy refreshExternalUrlIfNeeded from
              // overwriting hosted paths with third-party m3u8 on play/preview.
              resolvedExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
              ...(ep.durationSec != null ? { durationSec: ep.durationSec } : {}),
              ...(thumbnailUrl ? { thumbnailUrl } : {}),
            },
          });

          if (await this.isTransferCancelRequested(jobId)) {
            await this.markTransferCancelled(jobId);
            return;
          }
          const mediaJob = await this.upload.enqueueTranscode(relativePath, created.id, {
            preferR2: payload.preferR2,
            watermarkEnabled: !!payload.watermarkEnabled,
            watermarkX: payload.watermarkX,
            watermarkY: payload.watermarkY,
            watermarkScale: payload.watermarkScale,
          });
          const entry: YtdlpTransferJobEntry = {
            episodeId: created.id,
            episodeNumber,
            jobId: mediaJob.id,
            filename: path.basename(absInUploads),
            size: downloaded.size,
            webpageUrl: ep.webpageUrl,
            downloadUrl,
            sourceIndex: ep.index,
          };
          jobs = [...jobs, entry];
          done.add(`idx:${ep.index}`);
          if (downloadUrl) done.add(`dl:${downloadUrl}`);
          failedEpisodes = failedEpisodes.filter(
            (f) => f.url !== ep.webpageUrl && f.url !== downloadUrl,
          );

          const previewUrl =
            row.previewUrl || this.signLocalMedia(path.basename(absInUploads));
          await this.prisma.ytdlpTransferJob.update({
            where: { id: jobId },
            data: {
              jobs: jobs as any,
              transferred: jobs.length,
              previewUrl,
              failedEpisodes: failedEpisodes as any,
            },
          });
          if (!row.previewUrl) {
            row.previewUrl = previewUrl;
          }
        } catch (e: any) {
          this.logger.warn(`transfer ep ${ep.index} failed: ${e?.message || e}`);
          failedEpisodes = [
            ...failedEpisodes,
            {
              episodeNumber: ep.index,
              url: downloadUrl,
              error: e?.message || 'download failed',
            },
          ];
          await this.prisma.ytdlpTransferJob.update({
            where: { id: jobId },
            data: { failedEpisodes: failedEpisodes as any },
          });
        }
      }

      if (!jobs.length && !payload.resumeOf) {
        await this.prisma.drama.delete({ where: { id: BigInt(payload.dramaId) } }).catch(() => undefined);
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: `全部分集下载失败（${failedEpisodes.length}）`,
            currentEpisode: null,
            finishedAt: new Date(),
            failedEpisodes: failedEpisodes as any,
            transferred: 0,
            jobs: [] as any,
          },
        });
        return;
      }

      if (!jobs.length && payload.resumeOf) {
        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            error: `续跑分集全部失败（${failedEpisodes.length}）`,
            currentEpisode: null,
            finishedAt: new Date(),
            failedEpisodes: failedEpisodes as any,
            transferred: 0,
            jobs: [] as any,
          },
        });
        return;
      }

      const totalEpisodes = await this.prisma.episode.count({
        where: { dramaId: BigInt(payload.dramaId) },
      });
      await this.prisma.drama
        .update({
          where: { id: BigInt(payload.dramaId) },
          data: { totalEpisodes },
        })
        .catch(() => undefined);

      if (await this.isTransferCancelRequested(jobId)) {
        await this.markTransferCancelled(jobId);
        return;
      }

      await this.prisma.ytdlpTransferJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          currentEpisode: null,
          transferred: jobs.length,
          jobs: jobs as any,
          failedEpisodes: failedEpisodes as any,
          finishedAt: new Date(),
        },
      });
    } catch (e: any) {
      this.logger.error(`transfer job ${jobId} crashed: ${e?.message || e}`);
      const cancelRequested = await this.isTransferCancelRequested(jobId).catch(() => false);
      await this.prisma.ytdlpTransferJob
        .update({
          where: { id: jobId },
          data: {
            status: cancelRequested ? 'CANCELLED' : 'FAILED',
            error: e?.message || 'transfer crashed',
            currentEpisode: null,
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    } finally {
      this.activeRuns.delete(jobId);
    }
  }

  /** Drop oldest completed/failed DB jobs when table grows. */
  private async pruneTransferJobs(maxKeep = 80) {
    const doneCount = await this.prisma.ytdlpTransferJob.count({
      where: { status: { in: ['COMPLETED', 'FAILED'] } },
    });
    if (doneCount <= maxKeep) return;
    const overflow = doneCount - maxKeep;
    const old = await this.prisma.ytdlpTransferJob.findMany({
      where: { status: { in: ['COMPLETED', 'FAILED'] } },
      orderBy: { updatedAt: 'asc' },
      take: overflow,
      select: { id: true },
    });
    if (old.length) {
      await this.prisma.ytdlpTransferJob.deleteMany({
        where: { id: { in: old.map((j) => j.id) } },
      });
    }
  }

  private toPublicState(row: DbTransferRow): YtdlpTransferJobState {
    const statusMap = {
      QUEUED: 'queued',
      RUNNING: 'running',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCEL_REQUESTED: 'cancel_requested',
      CANCELLED: 'cancelled',
    } as const;
    return {
      id: row.id,
      dramaId: row.dramaId.toString(),
      slug: row.slug,
      status: statusMap[row.status],
      target: row.target === 'r2' ? 'r2' : 'local',
      preferR2: row.preferR2,
      total: row.total,
      transferred: row.transferred,
      currentEpisode: row.currentEpisode,
      failedEpisodes: this.parseFailures(row.failedEpisodes),
      jobs: this.parseJobs(row.jobs),
      previewUrl: row.previewUrl || undefined,
      extractor: row.extractor || undefined,
      kind: row.kind === 'playlist' || row.kind === 'single' ? row.kind : undefined,
      externalRef: row.externalRef || undefined,
      sourceType: row.sourceType || undefined,
      error: row.error || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private parseJobs(raw: unknown): YtdlpTransferJobEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean) as YtdlpTransferJobEntry[];
  }

  private parseFailures(raw: unknown): YtdlpEpisodeFailure[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean) as YtdlpEpisodeFailure[];
  }

  /**
   * Capture a permanent episode poster from a local video.
   * Failures are soft — transfer continues without a thumbnail.
   */
  private async autoEpisodeThumbnailFromVideo(
    inputRel: string,
    label: string,
  ): Promise<string | null> {
    try {
      const frame = await this.upload.extractFirstFrame(inputRel);
      const frameAbs = this.upload.resolveAbs(frame.relativePath);
      if (!fs.existsSync(frameAbs)) return null;
      const buffer = fs.readFileSync(frameAbs);
      const saved = await this.upload.saveImage(
        {
          fieldname: 'file',
          originalname: `${label}.jpg`,
          encoding: '7bit',
          mimetype: 'image/jpeg',
          size: buffer.length,
          buffer,
          destination: '',
          filename: '',
          path: '',
          stream: undefined as any,
        } as Express.Multer.File,
        'thumbnail',
      );
      try {
        fs.unlinkSync(frameAbs);
      } catch {
        /* tmp frame cleanup is best-effort */
      }
      return saved.url;
    } catch (e: any) {
      this.logger.warn(`auto episode thumbnail failed (${label}): ${e?.message || e}`);
      return null;
    }
  }

  private signLocalMedia(filename: string): string {
    const rel = `uploads/${filename}`.replace(/^\/+/, '');
    const key = requireSecret(
      'CDN_SIGN_KEY',
      this.config.get<string>('CDN_SIGN_KEY'),
      'dev',
    );
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = signMediaPath(rel, exp, key);
    const encoded = rel.split('/').map(encodeURIComponent).join('/');
    return `/api/v1/media/${encoded}?sig=${sig}&exp=${exp}`;
  }
}
