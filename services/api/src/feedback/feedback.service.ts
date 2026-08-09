import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { CaptchaService } from '../common/captcha.service';
import { StructuredLogger } from '../common/structured-logger.service';
import type { ClientMeta } from '../common/request-meta';

export const FEEDBACK_BODY_MIN = 10;
export const FEEDBACK_BODY_MAX = 1000;
export const FEEDBACK_EMAIL_MAX = 120;
const MAX_URLS = 3;

export type FeedbackCategory = 'feedback' | 'complaint' | 'suggestion';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly captcha: CaptchaService,
    private readonly log: StructuredLogger,
  ) {}

  async submit(input: {
    category: FeedbackCategory;
    body: string;
    contactEmail: string;
    captchaId?: string;
    captchaCode?: string;
    locale?: string;
    userId?: bigint | null;
    meta: ClientMeta;
  }) {
    await this.captcha.verify('web', input.captchaId || '', input.captchaCode || '');

    const body = sanitizePlainText(input.body, FEEDBACK_BODY_MAX);
    if (body.length < FEEDBACK_BODY_MIN) {
      throw new BizException(BizCode.BAD_REQUEST, 'feedback.bodyTooShort');
    }
    if (countUrls(body) > MAX_URLS) {
      throw new BizException(BizCode.BAD_REQUEST, 'feedback.bodyRejected');
    }

    const contactEmail = sanitizePlainText(String(input.contactEmail || ''), FEEDBACK_EMAIL_MAX).toLowerCase();
    if (!isSimpleEmail(contactEmail)) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.invalidEmail');
    }

    const locale = input.locale
      ? sanitizePlainText(input.locale, 8).toLowerCase() || null
      : null;

    const row = await this.prisma.feedbackSubmission.create({
      data: {
        category: input.category,
        body,
        contactEmail,
        locale,
        userId: input.userId ?? null,
        status: 'NEW',
        ipAddress: input.meta.ipAddress ? input.meta.ipAddress.slice(0, 64) : null,
        userAgent: input.meta.userAgent ? input.meta.userAgent.slice(0, 300) : null,
      },
      select: { id: true, createdAt: true },
    });

    this.log.log({
      event: 'feedback.submitted',
      feedbackId: String(row.id),
      category: input.category,
      userId: input.userId ? String(input.userId) : null,
      ip: input.meta.ipAddress,
    });

    return { id: String(row.id), createdAt: row.createdAt.toISOString() };
  }
}

function sanitizePlainText(raw: string, max: number): string {
  return String(raw || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

function countUrls(text: string): number {
  const matches = text.match(/https?:\/\/|www\./gi);
  return matches ? matches.length : 0;
}

function isSimpleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= FEEDBACK_EMAIL_MAX;
}
