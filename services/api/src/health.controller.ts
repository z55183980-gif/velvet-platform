import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { SKIP_ALL_THROTTLES } from './common/throttler-config';

@Controller('health')
@SkipThrottle(SKIP_ALL_THROTTLES)
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    const ok = db === 'ok';
    if (!ok) {
      res.status(503);
    }
    return {
      status: ok ? 'ok' : 'degraded',
      db,
      ts: new Date().toISOString(),
    };
  }
}
