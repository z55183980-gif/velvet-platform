import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BizException, BizCode } from './biz.exception';

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

@Injectable()
export class CaptchaService {
  private readonly entries = new Map<string, { hash: string; expiresAt: number; kind: CaptchaKind }>();

  constructor(private readonly config: ConfigService) {}

  isDisabled(kind: CaptchaKind): boolean {
    const key = kind === 'admin' ? 'AUTH_ADMIN_CAPTCHA_DISABLED' : 'AUTH_WEB_CAPTCHA_DISABLED';
    const raw = String(this.config.get<string>(key) || '')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

  issue(kind: CaptchaKind): CaptchaChallenge {
    if (this.isDisabled(kind)) {
      return { captchaId: '', imageSvg: '', captchaRequired: false };
    }
    const code = Array.from({ length: CAPTCHA_LENGTH }, () =>
      CAPTCHA_CHARS[crypto.randomInt(0, CAPTCHA_CHARS.length)],
    ).join('');
    const captchaId = `cap-${kind}-${crypto.randomUUID().replace(/-/g, '')}`;
    const now = Date.now();
    this.prune(now);
    this.enforceCapacity();
    this.entries.set(captchaId, {
      hash: this.hashCode(code),
      expiresAt: now + CAPTCHA_TTL_MS,
      kind,
    });
    return {
      captchaId,
      imageSvg: this.renderSvg(code),
      captchaRequired: true,
    };
  }

  /** One-time verify; consumes the challenge. */
  verify(kind: CaptchaKind, captchaId: string, captchaCode: string): void {
    if (this.isDisabled(kind)) return;

    const id = String(captchaId || '').trim();
    const code = String(captchaCode || '').trim();
    if (!id || !code) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.captchaRequired');
    }

    const now = Date.now();
    this.prune(now);
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (!entry || entry.kind !== kind || entry.expiresAt <= now) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.captchaInvalid');
    }
    if (this.hashCode(code) !== entry.hash) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.captchaInvalid');
    }
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  private prune(now: number) {
    for (const [key, value] of this.entries) {
      if (value.expiresAt <= now) this.entries.delete(key);
    }
  }

  private enforceCapacity() {
    if (this.entries.size < CAPTCHA_MAX_ENTRIES) return;
    const removeCount = Math.max(1, Math.ceil(CAPTCHA_MAX_ENTRIES / 10));
    let removed = 0;
    for (const key of this.entries.keys()) {
      this.entries.delete(key);
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
