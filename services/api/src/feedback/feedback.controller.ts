import { Body, Controller, Post, Req } from '@nestjs/common';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ok } from '../common/response';
import { getClientMeta } from '../common/request-meta';
import { SessionService } from '../auth/session.service';
import { AuthService } from '../auth/auth.service';
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_BODY_MIN,
  FEEDBACK_EMAIL_MAX,
  FeedbackService,
  type FeedbackCategory,
} from './feedback.service';

class SubmitFeedbackDto {
  @IsString()
  @IsIn(['feedback', 'complaint', 'suggestion'], { message: 'feedback.categoryInvalid' })
  category!: FeedbackCategory;

  @IsString()
  @IsNotEmpty({ message: 'feedback.bodyRequired' })
  @MinLength(FEEDBACK_BODY_MIN, { message: 'feedback.bodyTooShort' })
  @MaxLength(FEEDBACK_BODY_MAX, { message: 'feedback.bodyTooLong' })
  body!: string;

  @IsString()
  @IsNotEmpty({ message: 'auth.invalidEmail' })
  @IsEmail({}, { message: 'auth.invalidEmail' })
  @MaxLength(FEEDBACK_EMAIL_MAX)
  contactEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  captchaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  captchaCode?: string;
}

@Controller('v1/feedback')
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  /** Public help-center form (captcha + throttle; optional signed-in user). */
  @Throttle({ global: { limit: 5, ttl: 60_000 } })
  @Post()
  async submit(@Body() dto: SubmitFeedbackDto, @Req() req: Request) {
    const userId = this.optionalUserId(req);
    const data = await this.feedback.submit({
      category: dto.category,
      body: dto.body,
      contactEmail: dto.contactEmail,
      captchaId: dto.captchaId,
      captchaCode: dto.captchaCode,
      locale: dto.locale,
      userId,
      meta: getClientMeta(req),
    });
    return ok(data);
  }

  private optionalUserId(req: Request): bigint | null {
    try {
      const auth = req.headers.authorization;
      let token: string | undefined;
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        token = auth.slice(7);
      } else {
        const name = this.auth.getCookieName();
        const raw = req.headers.cookie;
        if (raw) {
          for (const part of raw.split(';')) {
            const idx = part.indexOf('=');
            if (idx === -1) continue;
            const k = part.slice(0, idx).trim();
            if (k === name) {
              token = decodeURIComponent(part.slice(idx + 1).trim());
              break;
            }
          }
        }
      }
      if (!token) return null;
      const payload = this.sessions.verify(token);
      if (!payload?.userId) return null;
      return BigInt(payload.userId);
    } catch {
      return null;
    }
  }
}
