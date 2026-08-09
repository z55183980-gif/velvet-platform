import { Injectable } from '@nestjs/common';
import { CaptchaService, type CaptchaChallenge } from '../common/captcha.service';

/** Admin-scoped captcha facade (keeps existing call sites). */
@Injectable()
export class AdminCaptchaService {
  constructor(private readonly captcha: CaptchaService) {}

  isDisabled(): boolean {
    return this.captcha.isDisabled('admin');
  }

  issue(): Promise<CaptchaChallenge> {
    return this.captcha.issue('admin');
  }

  verify(captchaId: string, captchaCode: string): Promise<void> {
    return this.captcha.verify('admin', captchaId, captchaCode);
  }
}

export type { CaptchaChallenge };
