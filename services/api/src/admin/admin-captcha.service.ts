import { Injectable } from '@nestjs/common';
import { CaptchaService, type CaptchaChallenge } from '../common/captcha.service';

/** Admin-scoped captcha facade (keeps existing call sites). */
@Injectable()
export class AdminCaptchaService {
  constructor(private readonly captcha: CaptchaService) {}

  isDisabled(): boolean {
    return this.captcha.isDisabled('admin');
  }

  issue(): CaptchaChallenge {
    return this.captcha.issue('admin');
  }

  verify(captchaId: string, captchaCode: string): void {
    this.captcha.verify('admin', captchaId, captchaCode);
  }
}

export type { CaptchaChallenge };
