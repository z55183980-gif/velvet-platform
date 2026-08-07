import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ok } from './common/response';
import { PlatformSettingsService } from './common/platform-settings.service';
import { SKIP_ALL_THROTTLES } from './common/throttler-config';

@Controller('v1')
export class SiteConfigController {
  constructor(private readonly platformSettings: PlatformSettingsService) {}

  @Get('site-config')
  @SkipThrottle(SKIP_ALL_THROTTLES)
  async getSiteConfig() {
    return ok(await this.platformSettings.getPublicConfig());
  }
}
