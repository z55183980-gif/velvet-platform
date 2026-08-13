import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BizCode, BizException } from './biz.exception';

const TITLE_MAX = 40;
const DESC_MAX = 300;
const HTML_TEXT_MAX = 80_000;

export type TitleCompleteInput = {
  titleZh?: string;
  titleEn?: string;
  titleFr?: string;
};

export type TitleCompleteResult = {
  titleZh: string;
  titleEn: string;
  titleFr: string;
  filled: Array<'titleZh' | 'titleEn' | 'titleFr'>;
  model: string;
};

export type DramaPageExtractEpisode = {
  episodeNumber: number;
  title: string;
  sourceUrl: string;
};

export type DramaPageExtractResult = {
  titleZh: string;
  titleEn: string;
  coverUrl: string;
  descriptionZh: string;
  /** Primary synopsis in page language when preferDescriptionLanguage was set. */
  descriptionEn?: string;
  /** Preferred catalog category slug when the model can choose among allowed ones. */
  categorySlug: string;
  /** Free-form genre/tag labels from the page when present. */
  tags?: string[];
  episodes: DramaPageExtractEpisode[];
  notes: string;
  model: string;
};

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titleZh: { type: 'string' },
    titleEn: { type: 'string' },
    coverUrl: { type: 'string' },
    descriptionZh: { type: 'string' },
    categorySlug: { type: 'string' },
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          episodeNumber: { type: 'integer' },
          title: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
        required: ['episodeNumber', 'title', 'sourceUrl'],
      },
    },
    notes: { type: 'string' },
  },
  required: [
    'titleZh',
    'titleEn',
    'coverUrl',
    'descriptionZh',
    'categorySlug',
    'episodes',
    'notes',
  ],
} as const;

/** Schema used only when preferDescriptionLanguage is set (e.g. DramaBox EN pages). */
const EXTRACT_SCHEMA_LOCALIZED = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titleZh: { type: 'string' },
    titleEn: { type: 'string' },
    coverUrl: { type: 'string' },
    descriptionEn: { type: 'string' },
    descriptionZh: { type: 'string' },
    categorySlug: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          episodeNumber: { type: 'integer' },
          title: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
        required: ['episodeNumber', 'title', 'sourceUrl'],
      },
    },
    notes: { type: 'string' },
  },
  required: [
    'titleZh',
    'titleEn',
    'coverUrl',
    'descriptionEn',
    'descriptionZh',
    'categorySlug',
    'tags',
    'episodes',
    'notes',
  ],
} as const;

const CATEGORY_CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    categorySlug: { type: 'string' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['categorySlug', 'confidence', 'reason'],
} as const;

const TITLE_TRANSLATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titleZh: { type: 'string' },
    titleFr: { type: 'string' },
  },
  required: ['titleZh', 'titleFr'],
} as const;

/**
 * Thin OpenAI-compatible chat client for admin helpers
 * (title translation EN→ZH/FR + Path B page extract).
 * Env: OPENAI_API_KEY, OPENAI_BASE_URL (optional), OPENAI_MODEL (optional).
 */
@Injectable()
export class OpenaiService {
  private readonly logger = new Logger(OpenaiService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey());
  }

  modelName(): string {
    return this.model();
  }

  private apiKey(): string {
    return String(this.config.get('OPENAI_API_KEY') || '').trim();
  }

  private model(): string {
    return String(this.config.get('OPENAI_MODEL') || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
  }

  private chatCompletionsUrl(): string {
    const raw = String(this.config.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1')
      .trim()
      .replace(/\/$/, '');
    return raw.endsWith('/chat/completions') ? raw : `${raw}/chat/completions`;
  }

  /**
   * Translate English title into Simplified Chinese + French.
   * Uses dedicated plain-text calls (more reliable than one JSON blob across gateways).
   */
  async completeTitles(input: TitleCompleteInput): Promise<TitleCompleteResult> {
    if (!this.isConfigured()) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '未配置 OPENAI_API_KEY，无法翻译标题',
      );
    }

    const titleEn = String(input.titleEn || '').trim().slice(0, TITLE_MAX);
    if (!titleEn) {
      throw new BizException(BizCode.BAD_REQUEST, '请先填写英文标题');
    }

    const model = this.model();
    let titleZh = '';
    let titleFr = '';

    try {
      const parsed = await this.chatJson({
        model,
        system: [
          'You translate short drama / movie titles.',
          'Given an English title, return BOTH Simplified Chinese and French.',
          'Respond with JSON only: {"titleZh":"...","titleFr":"..."}.',
          `Each value under ${TITLE_MAX} characters, non-empty.`,
          'titleFr MUST be French wording — never leave it identical to the English title when a natural French title exists.',
        ].join(' '),
        user: `English title:\n${titleEn}`,
        useSchema: true,
        schemaName: 'title_translate',
        schema: TITLE_TRANSLATE_SCHEMA,
      });
      titleZh = this.pickTranslatedTitle(parsed, 'zh');
      titleFr = this.pickTranslatedTitle(parsed, 'fr');
    } catch (e) {
      this.logger.warn(
        `title translate JSON failed, plain fallback: ${e instanceof Error ? e.message : e}`,
      );
    }

    if (!titleZh) {
      titleZh = await this.translatePlain(titleEn, 'Simplified Chinese');
    }
    if (!titleFr || this.sameTitle(titleFr, titleEn)) {
      titleFr = await this.translatePlain(
        titleEn,
        'French',
        'Output MUST be a French title. Do not repeat the English text unchanged.',
      );
    }

    titleZh = this.normalizeTitle(titleZh);
    titleFr = this.normalizeTitle(titleFr);

    if (!titleZh || !titleFr) {
      this.logger.warn(
        `title translate incomplete zh=${JSON.stringify(titleZh)} fr=${JSON.stringify(titleFr)}`,
      );
      throw new BizException(BizCode.BAD_REQUEST, '翻译结果不完整（中文或法语为空）');
    }

    return {
      titleZh,
      titleEn,
      titleFr,
      filled: ['titleZh', 'titleFr'],
      model,
    };
  }

  private pickTranslatedTitle(parsed: any, lang: 'zh' | 'fr'): string {
    if (!parsed || typeof parsed !== 'object') return '';
    const keys =
      lang === 'zh'
        ? ['titleZh', 'zh', 'chinese', 'title_zh', 'zhTitle']
        : ['titleFr', 'fr', 'french', 'title_fr', 'frTitle', 'titreFr', 'titre'];
    for (const key of keys) {
      const v = this.normalizeTitle(parsed[key]);
      if (v) return v;
    }
    return '';
  }

  private sameTitle(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  private async translatePlain(
    text: string,
    targetLanguage: string,
    extraRule?: string,
  ): Promise<string> {
    const system = [
      'You translate short drama / movie titles for a multilingual catalog.',
      `Translate the user title into ${targetLanguage}.`,
      'Return ONLY the translated title — no quotes, no labels, no explanation.',
      `Keep it under ${TITLE_MAX} characters.`,
      'Preserve proper nouns when commonly known; otherwise natural localization.',
      extraRule || '',
    ]
      .filter(Boolean)
      .join(' ');

    const data = await this.chatRaw({
      model: this.model(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
    });

    const out = this.normalizeTitle(data?.choices?.[0]?.message?.content);
    if (!out) {
      throw new BizException(BizCode.BAD_REQUEST, `${targetLanguage} 翻译结果为空`);
    }
    return out;
  }

  private normalizeTitle(raw: unknown): string {
    return String(raw ?? '')
      .trim()
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .slice(0, TITLE_MAX);
  }

  /** Path B: extract bilingual meta + episode URLs from page text. */
  async extractDramaPage(opts: {
    pageUrl: string;
    pageText: string;
    /** When set, ask the model to pick one catalog slug (or empty). */
    allowedCategorySlugs?: string[];
    /**
     * When set (host-specific adapters), synopsis language follows the page.
     * Default/legacy callers omit this and keep descriptionZh-oriented behavior.
     */
    preferDescriptionLanguage?: string;
  }): Promise<DramaPageExtractResult> {
    if (!this.isConfigured()) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '未配置 OPENAI_API_KEY，无法 AI 抽取分集',
      );
    }

    const pageUrl = String(opts.pageUrl || '').trim();
    const truncated = String(opts.pageText || '').slice(0, HTML_TEXT_MAX);
    if (!pageUrl || !truncated.trim()) {
      throw new BizException(BizCode.BAD_REQUEST, '页面内容为空，无法抽取');
    }

    const allowed = (opts.allowedCategorySlugs || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const categoryHint = allowed.length
      ? ` categorySlug must be one of [${allowed.join(', ')}] when genre is clear, else empty string.`
      : ' categorySlug should be empty string when no catalog is provided.';

    const preferLang = String(opts.preferDescriptionLanguage || '')
      .trim()
      .toLowerCase();
    const localized = Boolean(preferLang);
    const langHint = localized
      ? preferLang.startsWith('zh')
        ? ' descriptionEn may be empty; descriptionZh must stay in the page language (Simplified Chinese). Do not invent English when the page is Chinese. tags = genre/label strings from the page.'
        : ' descriptionEn must match the page language (usually English). Do NOT invent a Chinese synopsis when the page introduction is English. descriptionZh and titleZh must be empty; do not translate the source title or synopsis. tags = genre/label strings from the page (e.g. Sweet Love, Revenge).'
      : '';

    const system =
      'Extract short-drama metadata from a source page. ' +
      'Return playable episode media URLs when present (m3u8/mp4/direct video). ' +
      'If only episode page links exist, put those in sourceUrl and explain in notes. ' +
      'Prefer the full episode list over a single trailer when both appear. ' +
      'episodeNumber must be contiguous starting at 1. Use empty string when unknown. ' +
      'titleZh should be Simplified Chinese when possible; titleEn English.' +
      langHint +
      categoryHint;

    const user = `Page URL: ${pageUrl}\n\nPage text:\n${truncated}`;
    const model = this.model();
    const schema = localized ? EXTRACT_SCHEMA_LOCALIZED : EXTRACT_SCHEMA;

    let parsed: any;
    try {
      parsed = await this.chatJson({
        model,
        system,
        user,
        useSchema: true,
        schemaName: localized ? 'drama_extract_localized' : 'drama_extract',
        schema,
      });
    } catch (e) {
      this.logger.warn(
        `extract schema failed, retry plain JSON: ${e instanceof Error ? e.message : e}`,
      );
      parsed = await this.chatJson({
        model,
        system: `${system} Reply with a single JSON object only.`,
        user,
        useSchema: false,
      });
    }

    const episodesRaw = Array.isArray(parsed?.episodes) ? parsed.episodes : [];
    const episodes: DramaPageExtractEpisode[] = episodesRaw
      .map((e: any, i: number) => ({
        episodeNumber: Number(e?.episodeNumber) > 0 ? Number(e.episodeNumber) : i + 1,
        title: String(e?.title || `EP${i + 1}`).trim().slice(0, 80),
        sourceUrl: String(e?.sourceUrl || '').trim(),
      }))
      .filter((e: DramaPageExtractEpisode) => /^https?:\/\//i.test(e.sourceUrl))
      .sort(
        (a: DramaPageExtractEpisode, b: DramaPageExtractEpisode) =>
          a.episodeNumber - b.episodeNumber,
      )
      .map((e: DramaPageExtractEpisode, i: number) => ({
        ...e,
        episodeNumber: i + 1,
      }));

    const tagsRaw = Array.isArray(parsed?.tags) ? parsed.tags : [];
    const tags: string[] = [];
    for (const raw of tagsRaw) {
      const t = String(raw || '').trim();
      if (t && !tags.includes(t)) tags.push(t);
      if (tags.length >= 6) break;
    }

    return {
      titleZh: String(parsed?.titleZh || '').trim().slice(0, TITLE_MAX),
      titleEn: String(parsed?.titleEn || '').trim().slice(0, TITLE_MAX),
      coverUrl: String(parsed?.coverUrl || '').trim(),
      descriptionZh: String(parsed?.descriptionZh || '').trim().slice(0, DESC_MAX),
      descriptionEn: String(parsed?.descriptionEn || '').trim().slice(0, DESC_MAX) || undefined,
      categorySlug: String(parsed?.categorySlug || '').trim(),
      tags: tags.length ? tags : undefined,
      episodes,
      notes: String(parsed?.notes || '').trim().slice(0, 500),
      model,
    };
  }

  /**
   * Pick a single catalog category slug from title/description when heuristics are weak.
   * Returns undefined when the model is unsure or the slug is not allowed.
   */
  async classifyDramaCategory(opts: {
    title?: string;
    description?: string;
    pageLabels?: string[];
    allowedCategorySlugs: string[];
  }): Promise<{ categorySlug?: string; confidence: number; reason: string; model: string }> {
    const allowed = (opts.allowedCategorySlugs || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (!allowed.length || !this.isConfigured()) {
      return { confidence: 0, reason: 'unavailable', model: '' };
    }

    const title = String(opts.title || '').trim().slice(0, TITLE_MAX);
    const description = String(opts.description || '').trim().slice(0, DESC_MAX);
    const labels = (opts.pageLabels || []).map((s) => String(s).trim()).filter(Boolean);
    if (!title && !description && !labels.length) {
      return { confidence: 0, reason: 'empty input', model: '' };
    }

    const model = this.model();
    const system =
      'Classify a short drama into exactly one catalog category. ' +
      `categorySlug must be one of [${allowed.join(', ')}] or empty string if uncertain. ` +
      'confidence is 0..1. Prefer empty when evidence is weak.';
    const user = [
      `Title: ${title || '(none)'}`,
      `Description: ${description || '(none)'}`,
      `Page labels: ${labels.length ? labels.join(', ') : '(none)'}`,
      `Allowed: ${allowed.join(', ')}`,
    ].join('\n');

    let parsed: any;
    try {
      parsed = await this.chatJson({
        model,
        system,
        user,
        useSchema: true,
        schemaName: 'drama_category',
        schema: CATEGORY_CLASSIFY_SCHEMA,
      });
    } catch (e) {
      this.logger.warn(
        `category classify failed: ${e instanceof Error ? e.message : e}`,
      );
      return {
        confidence: 0,
        reason: e instanceof Error ? e.message : String(e),
        model,
      };
    }

    const slug = String(parsed?.categorySlug || '').trim();
    const confidence = Number(parsed?.confidence);
    return {
      categorySlug: allowed.includes(slug) ? slug : undefined,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      reason: String(parsed?.reason || '').trim().slice(0, 200),
      model,
    };
  }

  private async chatJson(opts: {
    model: string;
    system: string;
    user: string;
    useSchema: boolean;
    schemaName?: string;
    schema?: Record<string, unknown>;
  }): Promise<any> {
    const body: Record<string, unknown> = {
      model: opts.model,
      temperature: 0,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    };
    if (opts.useSchema && opts.schema && opts.schemaName) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: opts.schemaName,
          strict: true,
          schema: opts.schema,
        },
      };
    } else {
      body.response_format = { type: 'json_object' };
    }

    const data = await this.chatRaw(body);
    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      throw new BizException(BizCode.BAD_REQUEST, 'AI 返回内容为空');
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, 'AI 返回无法解析为 JSON');
    }
  }

  private async chatRaw(body: Record<string, unknown>): Promise<any> {
    const endpoint = this.chatCompletionsUrl();
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e: unknown) {
      this.logger.warn(`OpenAI request failed: ${e instanceof Error ? e.message : e}`);
      throw new BizException(BizCode.BAD_REQUEST, 'AI 服务请求失败，请稍后重试');
    }

    const rawText = await res.text();
    if (!res.ok) {
      this.logger.warn(`OpenAI HTTP ${res.status}: ${rawText.slice(0, 300)}`);
      throw new BizException(
        BizCode.BAD_REQUEST,
        `AI 服务返回错误 (${res.status})`,
      );
    }

    try {
      return JSON.parse(rawText);
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, 'AI 服务返回无法解析');
    }
  }
}
