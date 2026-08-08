import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BizCode, BizException } from './biz.exception';

const TITLE_MAX = 40;
const DESC_MAX = 300;
const HTML_TEXT_MAX = 80_000;

export type TitleCompleteInput = {
  titleZh?: string;
  titleEn?: string;
};

export type TitleCompleteResult = {
  titleZh: string;
  titleEn: string;
  filled: Array<'titleZh' | 'titleEn'>;
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
  required: ['titleZh', 'titleEn', 'coverUrl', 'descriptionZh', 'episodes', 'notes'],
} as const;

/**
 * Thin OpenAI-compatible chat client for admin helpers
 * (title translation + Path B page extract).
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

  async completeTitles(input: TitleCompleteInput): Promise<TitleCompleteResult> {
    if (!this.isConfigured()) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '未配置 OPENAI_API_KEY，无法翻译补全',
      );
    }

    const titleZh = String(input.titleZh || '').trim().slice(0, TITLE_MAX);
    const titleEn = String(input.titleEn || '').trim().slice(0, TITLE_MAX);
    if (!titleZh && !titleEn) {
      throw new BizException(BizCode.BAD_REQUEST, '请至少填写中文或英文标题之一');
    }

    const needZh = !titleZh && !!titleEn;
    const needEn = !titleEn && !!titleZh;
    if (!needZh && !needEn) {
      return {
        titleZh,
        titleEn,
        filled: [],
        model: this.model(),
      };
    }

    const sourceLang = needZh ? 'en' : 'zh';
    const targetLang = needZh ? 'zh' : 'en';
    const source = needZh ? titleEn : titleZh;
    const translated = await this.translateTitle(source, sourceLang, targetLang);

    return {
      titleZh: needZh ? translated : titleZh,
      titleEn: needEn ? translated : titleEn,
      filled: needZh ? ['titleZh'] : ['titleEn'],
      model: this.model(),
    };
  }

  /** Path B: extract bilingual meta + episode URLs from page text. */
  async extractDramaPage(opts: {
    pageUrl: string;
    pageText: string;
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

    const system =
      'Extract short-drama metadata from a source page. ' +
      'Return playable episode media URLs when present (m3u8/mp4/direct video). ' +
      'If only episode page links exist, put those in sourceUrl and explain in notes. ' +
      'Prefer the full episode list over a single trailer when both appear. ' +
      'episodeNumber must be contiguous starting at 1. Use empty string when unknown. ' +
      'titleZh should be Simplified Chinese when possible; titleEn English.';

    const user = `Page URL: ${pageUrl}\n\nPage text:\n${truncated}`;
    const model = this.model();

    let parsed: any;
    try {
      parsed = await this.chatJson({
        model,
        system,
        user,
        useSchema: true,
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

    return {
      titleZh: String(parsed?.titleZh || '').trim().slice(0, TITLE_MAX),
      titleEn: String(parsed?.titleEn || '').trim().slice(0, TITLE_MAX),
      coverUrl: String(parsed?.coverUrl || '').trim(),
      descriptionZh: String(parsed?.descriptionZh || '').trim().slice(0, DESC_MAX),
      episodes,
      notes: String(parsed?.notes || '').trim().slice(0, 500),
      model,
    };
  }

  private async translateTitle(
    text: string,
    from: 'zh' | 'en',
    to: 'zh' | 'en',
  ): Promise<string> {
    const targetLabel = to === 'zh' ? 'Simplified Chinese' : 'English';
    const sourceLabel = from === 'zh' ? 'Chinese' : 'English';
    const system = [
      'You translate short drama / movie titles for a bilingual catalog.',
      `Translate from ${sourceLabel} to ${targetLabel}.`,
      `Return ONLY the translated title, no quotes or explanation.`,
      `Keep it under ${TITLE_MAX} characters.`,
      'Preserve proper nouns when commonly known; otherwise natural localization.',
    ].join(' ');

    const data = await this.chatRaw({
      model: this.model(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
    });

    const out = String(data?.choices?.[0]?.message?.content || '')
      .trim()
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .slice(0, TITLE_MAX);
    if (!out) {
      throw new BizException(BizCode.BAD_REQUEST, '翻译结果为空');
    }
    return out;
  }

  private async chatJson(opts: {
    model: string;
    system: string;
    user: string;
    useSchema: boolean;
  }): Promise<any> {
    const body: Record<string, unknown> = {
      model: opts.model,
      temperature: 0,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    };
    if (opts.useSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'drama_extract',
          strict: true,
          schema: EXTRACT_SCHEMA,
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
