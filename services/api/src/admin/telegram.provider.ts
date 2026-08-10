import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BizCode, BizException } from '../common/biz.exception';

export type TelegramProbeMode = 'recent' | 'range';

export type TelegramProbeItem = {
  messageId: number;
  date?: string | null;
  title: string;
  text?: string;
  mediaKind: string;
  hasVideo: boolean;
  size?: number | null;
  duration?: number | null;
  filename?: string | null;
  webpageUrl: string;
};

export type TelegramProbeResult = {
  channel: string;
  count: number;
  items: TelegramProbeItem[];
};

export type TelegramDownloadResult = {
  channel: string;
  messageId: number;
  filename: string;
  absolutePath: string;
  relativePath: string;
  size: number;
  duration?: number | null;
  title?: string;
  webpageUrl: string;
};

export type TelegramHealth = {
  ok: boolean;
  configured: boolean;
  sessionExists: boolean;
  authorized: boolean;
  user?: { id?: number; username?: string | null; phone?: string | null } | null;
  error?: string | null;
  uploadDir?: string;
};

/**
 * HTTP client for the local Telethon sidecar (127.0.0.1 only).
 * Session secrets stay on the sidecar; Nest never sees api_hash / session bytes.
 */
@Injectable()
export class TelegramProvider {
  private readonly logger = new Logger(TelegramProvider.name);

  constructor(private readonly config: ConfigService) {}

  baseUrl(): string {
    return String(this.config.get<string>('TELEGRAM_SIDECAR_URL') || '')
      .trim()
      .replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return !!this.baseUrl();
  }

  async status(): Promise<{
    enabled: boolean;
    sidecarUrl: string | null;
    health: TelegramHealth | null;
  }> {
    const url = this.baseUrl();
    if (!url) {
      return { enabled: false, sidecarUrl: null, health: null };
    }
    try {
      const health = await this.request<TelegramHealth>('GET', '/health');
      return { enabled: true, sidecarUrl: url, health };
    } catch (e: any) {
      return {
        enabled: true,
        sidecarUrl: url,
        health: {
          ok: false,
          configured: false,
          sessionExists: false,
          authorized: false,
          error: e?.message || String(e),
        },
      };
    }
  }

  async probe(opts: {
    channel: string;
    mode?: TelegramProbeMode;
    recentN?: number;
    fromId?: number;
    toId?: number;
    mediaOnly?: boolean;
  }): Promise<TelegramProbeResult> {
    return this.request<TelegramProbeResult>('POST', '/probe', {
      channel: opts.channel,
      mode: opts.mode || 'recent',
      recentN: opts.recentN,
      fromId: opts.fromId,
      toId: opts.toId,
      mediaOnly: opts.mediaOnly !== false,
    });
  }

  async download(opts: {
    channel: string;
    messageId: number;
  }): Promise<TelegramDownloadResult> {
    return this.request<TelegramDownloadResult>('POST', '/download', {
      channel: opts.channel,
      messageId: opts.messageId,
    }, 600_000);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 60_000,
  ): Promise<T> {
    const base = this.baseUrl();
    if (!base) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Telegram sidecar 未配置（TELEGRAM_SIDECAR_URL）',
      );
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: body != null ? { 'content-type': 'application/json' } : undefined,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const detail =
          (json && (json.detail || json.message || json.error)) ||
          text ||
          `HTTP ${res.status}`;
        const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
        if (res.status === 404) throw new BizException(BizCode.NOT_FOUND, msg);
        if (res.status === 403) throw new BizException(BizCode.FORBIDDEN, msg);
        if (res.status === 409) throw new BizException(BizCode.CONFLICT, msg);
        if (res.status === 503) {
          throw new BizException(
            BizCode.BAD_REQUEST,
            `Telegram sidecar 不可用: ${msg}`,
          );
        }
        throw new BizException(BizCode.BAD_REQUEST, msg);
      }
      return json as T;
    } catch (e: any) {
      if (e instanceof BizException) throw e;
      if (e?.name === 'AbortError') {
        throw new BizException(BizCode.BAD_REQUEST, 'Telegram sidecar 请求超时');
      }
      this.logger.warn(`telegram sidecar ${method} ${path}: ${e?.message || e}`);
      throw new BizException(
        BizCode.BAD_REQUEST,
        `Telegram sidecar 调用失败: ${e?.message || e}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
