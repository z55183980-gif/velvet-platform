import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BizCode, BizException } from './biz.exception';

const TITLE_MAX = 40;

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

/**
 * Thin OpenAI-compatible chat client for admin helpers (title translation).
 * Env: OPENAI_API_KEY, OPENAI_BASE_URL (optional), OPENAI_MODEL (optional).
 */
@Injectable()
export class OpenaiService {
  private readonly logger = new Logger(OpenaiService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey());
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

    const endpoint = this.chatCompletionsUrl();
    const model = this.model();
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text },
          ],
        }),
      });
    } catch (e: unknown) {
      this.logger.warn(`OpenAI request failed: ${e instanceof Error ? e.message : e}`);
      throw new BizException(BizCode.BAD_REQUEST, '翻译服务请求失败，请稍后重试');
    }

    const rawText = await res.text();
    if (!res.ok) {
      this.logger.warn(`OpenAI HTTP ${res.status}: ${rawText.slice(0, 300)}`);
      throw new BizException(
        BizCode.BAD_REQUEST,
        `翻译服务返回错误 (${res.status})`,
      );
    }

    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = JSON.parse(rawText) as typeof data;
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, '翻译服务返回无法解析');
    }

    const out = String(data?.choices?.[0]?.message?.content || '')
      .trim()
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .slice(0, TITLE_MAX);
    if (!out) {
      throw new BizException(BizCode.BAD_REQUEST, '翻译结果为空');
    }
    return out;
  }
}
