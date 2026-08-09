import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'crypto';
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
  type ExtractedPageEpisode,
} from './online-page-extract.util';
import {
  DEFAULT_CATEGORY_SLUGS,
  inferCategorySlug,
  sanitizeCategorySlug,
} from './drama-category-infer.util';

export type YtdlpImportOptions = {
  url: string;
  /** When empty, inferred from title/description before create. */
  categorySlug?: string;
  titleZh?: string;
  titleEn?: string;
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
  sourceIndex?: number;
};

export type YtdlpTransferJobState = {
  id: string;
  dramaId: string;
  slug: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
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
  authBearer?: string;
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
};

type DbTransferRow = {
  id: string;
  dramaId: bigint;
  slug: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
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
    return this.provider.probe(url, auth);
  }

  /**
   * Path B: fetch public page HTML → deterministic episode href extract (+ OpenAI meta fallback).
   * ReelShort SPA pages put episode lists in HTML/__NEXT_DATA__; stripped text alone is not enough.
   * Also infers categorySlug (page labels → heuristic → optional LLM).
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

    const episodeMap = new Map<number, ExtractedPageEpisode>();
    let bestMeta: {
      title?: string;
      coverUrl?: string;
      description?: string;
      genreLabels?: string[];
    } = {};
    let bestHtml = '';
    let bestHtmlUrl = pageUrl;
    let fetchedOk = 0;
    const fetchErrors: string[] = [];

    for (const candidate of candidates) {
      const headers = this.provider.buildPageFetchHeaders(candidate, auth);
      let pageRes: Response;
      try {
        pageRes = await fetch(candidate, {
          method: 'GET',
          headers,
          redirect: 'follow',
        });
      } catch (e: unknown) {
        fetchErrors.push(
          `${candidate}: ${e instanceof Error ? e.message : String(e)}`,
        );
        continue;
      }
      if (!pageRes.ok) {
        fetchErrors.push(`${candidate}: HTTP ${pageRes.status}`);
        continue;
      }
      fetchedOk += 1;
      const rawHtml = await pageRes.text();
      if (rawHtml.length > bestHtml.length) {
        bestHtml = rawHtml;
        bestHtmlUrl = candidate;
      }

      for (const ep of extractEpisodeLinksFromHtml(rawHtml, candidate)) {
        if (!episodeMap.has(ep.episodeNumber)) episodeMap.set(ep.episodeNumber, ep);
      }

      const { meta, episodes: nextEps } = extractMetaFromNextData(rawHtml);
      if (meta.title && !bestMeta.title) bestMeta.title = meta.title;
      if (meta.coverUrl && !bestMeta.coverUrl) bestMeta.coverUrl = meta.coverUrl;
      if (meta.description && !bestMeta.description) {
        bestMeta.description = meta.description;
      }
      if (meta.genreLabels?.length) {
        bestMeta.genreLabels = [
          ...new Set([...(bestMeta.genreLabels || []), ...meta.genreLabels]),
        ].slice(0, 12);
      }
      for (const ep of nextEps) {
        // Prefer page hrefs (playable ingest via yt-dlp later); keep media URLs if no href.
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
    let descriptionZh = bestMeta.description || '';
    let coverUrl = bestMeta.coverUrl || '';
    let categorySlug = '';

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
        });
        model = extracted.model;
        notes = extracted.notes || '';
        if (extracted.titleZh) titleZh = extracted.titleZh;
        if (extracted.titleEn) titleEn = extracted.titleEn || titleEn;
        if (extracted.coverUrl && /^https?:\/\//i.test(extracted.coverUrl)) {
          coverUrl = extracted.coverUrl;
        }
        if (extracted.descriptionZh) {
          descriptionZh = extracted.descriptionZh || descriptionZh;
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
      notes = `Deterministic extract from ${fetchedOk} page(s); skipped LLM.`;
    }

    if (!categorySlug) {
      const resolved = await this.resolveCategorySlug({
        title: titleZh || titleEn || bestMeta.title,
        description: descriptionZh || bestMeta.description,
        pageLabels: bestMeta.genreLabels,
        allowedSlugs: allowedCategories,
      });
      if (resolved.slug) {
        categorySlug = resolved.slug;
        if (resolved.via === 'llm' && resolved.model) {
          model = model || resolved.model;
        }
        if (resolved.note) {
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
          : '未抽到可用分集链接。请改用剧集主页 /movie/... 或 /full-episodes/...，并确认链接可访问（非 404）',
      );
    }

    const title = (titleEn || titleZh || bestMeta.title || `AI extract`).trim();

    const probe: YtdlpProbeResult & {
      source: 'ai';
      titleZh?: string;
      titleEn?: string;
      categorySlug?: string;
      notes?: string;
      model?: string;
      htmlChars: number;
      textChars: number;
      resolvedFrom?: string[];
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
      notes: notes || undefined,
      model,
      htmlChars: bestHtml.length,
      textChars: bestHtml ? buildExtractContext(bestHtml, bestHtmlUrl).length : 0,
      resolvedFrom: candidates,
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
        ` category=${categorySlug || '-'} (fetched=${fetchedOk})`,
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
   * Batch-resolve episode page URLs via yt-dlp (used after AI extract).
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
    const hardCap = 40;
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
        if (/\.(m3u8|mp4|webm|mkv)(\?|$)/i.test(ep.url)) {
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

  /** Prefer explicit category; if empty, infer from titles/descriptions. */
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
    throw new BizException(BizCode.BAD_REQUEST, '请选择分类');
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

  async importDrama(opts: YtdlpImportOptions, actorId?: bigint) {
    const pageUrl = String(opts.url || '').trim();
    if (!pageUrl) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');
    const categorySlug = await this.requireCategorySlug(opts);

    const auth = this.authFromOpts(opts);
    const probe = await this.provider.probe(pageUrl, auth);
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
        lockMode: 'FREE_FIRST_N',
        freeEpisodeCount: 3,
        // 拉取的第三方内容必须先完成来源/可播审核，不允许直接上线。
        status: 'DRAFT',
        externalRef,
        sourceTags: ['ytdlp', probe.extractor, `ytdlp:${probe.id}`],
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
    const probe = await this.provider.probe(opts.url, auth);
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
      const limit =
        opts.maxEpisodes && opts.maxEpisodes > 0
          ? Math.min(opts.maxEpisodes, explicit.length)
          : explicit.length;
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
      const probe = await this.provider.probe(pageUrl, auth);
      if (!probe.episodes.length) {
        throw new BizException(BizCode.BAD_REQUEST, '未解析到分集，无法转存');
      }
      const limit =
        opts.maxEpisodes && opts.maxEpisodes > 0
          ? Math.min(opts.maxEpisodes, probe.episodes.length)
          : probe.episodes.length;
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
        lockMode,
        freeEpisodeCount,
        buyoutCredits: opts.buyoutCredits,
        status: 'DRAFT',
        sourceType,
        sourceTags: ['ytdlp', 'transfer', target, extractor, `ytdlp:${probeId}`],
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
      authBearer: opts.authBearer?.trim() || undefined,
      watermarkEnabled: !!opts.watermarkEnabled,
      watermarkX: opts.watermarkX,
      watermarkY: opts.watermarkY,
      watermarkScale: opts.watermarkScale,
      selected,
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
      const pending = await this.prisma.ytdlpTransferJob.findMany({
        where: { status: { in: ['QUEUED', 'RUNNING'] } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      if (!pending.length) return;
      for (const job of pending) {
        if (job.status === 'RUNNING') {
          await this.prisma.ytdlpTransferJob.update({
            where: { id: job.id },
            data: { status: 'QUEUED', currentEpisode: null },
          });
        }
        void this.runTransferJob(job.id);
      }
      this.logger.log(`recovered ${pending.length} ytdlp transfer job(s)`);
    } catch (e: any) {
      this.logger.warn(`transfer job recover skipped: ${e?.message || e}`);
    }
  }

  private async runTransferJob(jobId: string) {
    if (this.activeRuns.has(jobId)) return;
    this.activeRuns.add(jobId);

    try {
      const row = await this.prisma.ytdlpTransferJob.findUnique({ where: { id: jobId } });
      if (!row) return;
      if (row.status === 'COMPLETED' || row.status === 'FAILED') return;

      const payload = row.payload as TransferPayload;
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

      await this.prisma.ytdlpTransferJob.update({
        where: { id: jobId },
        data: {
          status: 'RUNNING',
          startedAt: row.startedAt ?? new Date(),
          attempts: { increment: 1 },
        },
      });

      const uploadDir = this.upload.getUploadDir();
      const extractor = row.extractor || 'unknown';
      const actorId = payload.actorId != null ? BigInt(payload.actorId) : undefined;
      let jobs = this.parseJobs(row.jobs);
      let failedEpisodes = this.parseFailures(row.failedEpisodes);
      const doneUrls = new Set(
        jobs.map((j) => j.webpageUrl).filter((u): u is string => !!u),
      );

      for (const ep of payload.selected) {
        const downloadUrl =
          (ep as { downloadUrl?: string }).downloadUrl ||
          ep.sourceUrl ||
          ep.webpageUrl;
        if (doneUrls.has(ep.webpageUrl) || doneUrls.has(downloadUrl)) continue;

        await this.prisma.ytdlpTransferJob.update({
          where: { id: jobId },
          data: { currentEpisode: ep.index },
        });

        try {
          const downloaded = await this.provider.downloadToFile(
            downloadUrl,
            uploadDir,
            payload.preference,
            ep.playlistIndex,
            this.authFromOpts(payload),
          );
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

          // Consecutive episode numbers for successful transfers only.
          const episodeNumber = jobs.length + 1;
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
            sourceIndex: ep.index,
          };
          jobs = [...jobs, entry];
          doneUrls.add(ep.webpageUrl);
          doneUrls.add(downloadUrl);
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

      if (!jobs.length) {
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

      await this.prisma.drama
        .update({
          where: { id: BigInt(payload.dramaId) },
          data: { totalEpisodes: jobs.length },
        })
        .catch(() => undefined);

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
      await this.prisma.ytdlpTransferJob
        .update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
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
