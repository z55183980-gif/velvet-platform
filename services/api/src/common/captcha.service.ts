import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BizException, BizCode } from './biz.exception';
import { EphemeralKv } from './ephemeral-kv';

const CAPTCHA_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CAPTCHA_TTL_MS = 300_000;
const CAPTCHA_LENGTH = 4;
const CAPTCHA_MAX_ENTRIES = 10_000;

export type CaptchaKind = 'admin' | 'web';

export type CaptchaChallenge = {
  captchaId: string;
  imageSvg: string;
  captchaRequired: boolean;
};

type CaptchaEntry = { hash: string; expiresAt: number; kind: CaptchaKind };

@Injectable()
export class CaptchaService implements OnModuleDestroy {
  private readonly kv: EphemeralKv;
  /** Local-only capacity bound when Redis is unset. */
  private readonly localIds = new Set<string>();

  constructor(private readonly config: ConfigService) {
    this.kv = new EphemeralKv(config, 'captcha');
  }

  async onModuleDestroy() {
    await this.kv.quit();
  }

  isDisabled(kind: CaptchaKind): boolean {
    const key = kind === 'admin' ? 'AUTH_ADMIN_CAPTCHA_DISABLED' : 'AUTH_WEB_CAPTCHA_DISABLED';
    const raw = String(this.config.get<string>(key) || '')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

  async issue(kind: CaptchaKind): Promise<CaptchaChallenge> {
    if (this.isDisabled(kind)) {
      return { captchaId: '', imageSvg: '', captchaRequired: false };
    }
    const code = Array.from({ length: CAPTCHA_LENGTH }, () =>
      CAPTCHA_CHARS[crypto.randomInt(0, CAPTCHA_CHARS.length)],
    ).join('');
    const captchaId = `cap-${kind}-${crypto.randomUUID().replace(/-/g, '')}`;
    const entry: CaptchaEntry = {
      hash: this.hashCode(code),
      expiresAt: Date.now() + CAPTCHA_TTL_MS,
      kind,
    };
    if (this.kv.backend === 'memory') {
      await this.enforceLocalCapacity();
      this.localIds.add(captchaId);
    }
    await this.kv.set(captchaId, JSON.stringify(entry), CAPTCHA_TTL_MS / 1000);
    return {
      captchaId,
      imageSvg: this.renderSvg(code),
      captchaRequired: true,
    };
  }

  /** One-time verify; consumes the challenge atomically when Redis is available. */
  async verify(kind: CaptchaKind, captchaId: string, captchaCode: string): Promise<void> {
    if (this.isDisabled(kind)) return;

    const id = String(captchaId || '').trim();
    const code = String(captchaCode || '').trim();
    if (!id || !code) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.captchaRequired');
    }

    const raw =
      this.kv.backend === 'redis'
        ? await this.kv.getdel(id)
        : await this.kv.get(id);
    if (this.kv.backend === 'memory') {
      await this.kv.del(id);
      this.localIds.delete(id);
    }
    if (!raw) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.captchaInvalid');
    }
    let entry: CaptchaEntry;
    try {
      entry = JSON.parse(raw) as CaptchaEntry;
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.captchaInvalid');
    }
    if (entry.kind !== kind || entry.expiresAt <= Date.now()) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.captchaInvalid');
    }
    if (this.hashCode(code) !== entry.hash) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.captchaInvalid');
    }
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  private async enforceLocalCapacity() {
    if (this.localIds.size < CAPTCHA_MAX_ENTRIES) return;
    const removeCount = Math.max(1, Math.ceil(CAPTCHA_MAX_ENTRIES / 10));
    let removed = 0;
    for (const id of this.localIds) {
      this.localIds.delete(id);
      await this.kv.del(id);
      removed++;
      if (removed >= removeCount) break;
    }
  }

  private renderSvg(text: string): string {
    const width = 120;
    const height = 40;
    const noise: string[] = [];
    for (let i = 0; i < 5; i++) {
      const x1 = crypto.randomInt(0, width);
      const y1 = crypto.randomInt(0, height);
      const x2 = crypto.randomInt(0, width);
      const y2 = crypto.randomInt(0, height);
      const color = crypto.randomInt(0, 0x999999).toString(16).padStart(6, '0');
      noise.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#${color}" stroke-width="1" opacity="0.35"/>`,
      );
    }

    const glyphs: string[] = [];
    const slotWidth = Math.floor(width / (text.length + 1));
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const x = slotWidth * (index + 1);
      const y = Math.floor(height / 2) + crypto.randomInt(0, 11) - 5;
      const rotate = crypto.randomInt(0, 31) - 15;
      const color = crypto.randomInt(0, 0x555555).toString(16).padStart(6, '0');
      glyphs.push(
        `<text x="${x}" y="${y}" fill="#${color}" font-size="22" ` +
          `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="700" ` +
          `transform="rotate(${rotate} ${x} ${y})">${char}</text>`,
      );
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}">` +
      `<rect width="100%" height="100%" fill="#f8fafc" rx="4"/>` +
      `${noise.join('')}${glyphs.join('')}` +
      `</svg>`
    );
  }
}
