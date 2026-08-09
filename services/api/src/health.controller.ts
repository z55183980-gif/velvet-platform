import { Controller, Get, Optional, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { SKIP_ALL_THROTTLES } from './common/throttler-config';
import { isProductionEnv } from './common/security-config';
import { createRedisConnection, readRedisUrl } from './upload/transcode.queue';
import { TranscodeQueueService } from './upload/transcode-queue.service';

type DepStatus = 'ok' | 'error' | 'skipped' | 'missing';

@Controller('health')
@SkipThrottle(SKIP_ALL_THROTTLES)
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly transcodeQueue?: TranscodeQueueService,
  ) {}

  /** Liveness: process up + DB. Redis/queue reported but do not fail liveness. */
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const deps = await this.probeDeps({ failOnRedis: false });
    const ok = deps.db === 'ok';
    if (!ok) res.status(503);
    return {
      status: ok ? 'ok' : 'degraded',
      ...deps,
      ts: new Date().toISOString(),
    };
  }

  /**
   * Readiness: DB required; Redis required when REDIS_URL is set (or always in
   * production). Queue connectivity reported when BullMQ mode is active.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const deps = await this.probeDeps({ failOnRedis: true });
    const redisRequired = isProductionEnv() || !!readRedisUrl(this.config);
    const redisOk =
      deps.redis === 'ok' || (!redisRequired && deps.redis === 'missing');
    const ok = deps.db === 'ok' && redisOk;
    if (!ok) res.status(503);
    return {
      status: ok ? 'ready' : 'not_ready',
      ...deps,
      ts: new Date().toISOString(),
    };
  }

  private async probeDeps(opts: { failOnRedis: boolean }) {
    let db: DepStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }

    let redis: DepStatus = 'missing';
    const redisUrl = readRedisUrl(this.config);
    if (redisUrl) {
      const client = createRedisConnection(this.config);
      try {
        const pong = await client.ping();
        redis = pong === 'PONG' ? 'ok' : 'error';
      } catch {
        redis = 'error';
      } finally {
        await client.quit().catch(() => undefined);
      }
    } else if (opts.failOnRedis && isProductionEnv()) {
      redis = 'missing';
    }

    let queue: DepStatus | { mode: string; counts?: Record<string, number> } =
      'skipped';
    if (this.transcodeQueue) {
      try {
        const mode = this.transcodeQueue.mode();
        if (mode === 'bullmq') {
          const counts = await this.transcodeQueue.getJobCounts();
          queue = { mode, counts };
        } else {
          queue = { mode };
        }
      } catch {
        queue = 'error';
      }
    }

    return { db, redis, queue };
  }
}
