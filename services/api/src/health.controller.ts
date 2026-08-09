import { Controller, Get, Optional, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { SKIP_ALL_THROTTLES } from './common/throttler-config';
import { isProductionEnv } from './common/security-config';
import {
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_MAX_AGE_MS,
  createRedisConnection,
  readRedisUrl,
  shouldRunTranscodeWorker,
} from './upload/transcode.queue';
import { TranscodeQueueService } from './upload/transcode-queue.service';

type DepStatus = 'ok' | 'error' | 'skipped' | 'missing' | 'stale';

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
    const deps = await this.probeDeps({ failOnCritical: false });
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
   * production). Queue connectivity and worker heartbeat fail readiness when
   * BullMQ dedicated-worker mode is active (TRANSCODE_INLINE=false).
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const deps = await this.probeDeps({ failOnCritical: true });
    const redisRequired = isProductionEnv() || !!readRedisUrl(this.config);
    const redisOk =
      deps.redis === 'ok' || (!redisRequired && deps.redis === 'missing');
    const queueOk = deps.queue !== 'error';
    const workerOk =
      deps.worker === 'ok' ||
      deps.worker === 'skipped' ||
      (!redisRequired && deps.worker === 'missing');
    const ok = deps.db === 'ok' && redisOk && queueOk && workerOk;
    if (!ok) res.status(503);
    return {
      status: ok ? 'ready' : 'not_ready',
      ...deps,
      ts: new Date().toISOString(),
    };
  }

  private async probeDeps(opts: { failOnCritical: boolean }) {
    let db: DepStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }

    let redis: DepStatus = 'missing';
    const redisUrl = readRedisUrl(this.config);
    let redisClient: ReturnType<typeof createRedisConnection> | null = null;
    if (redisUrl) {
      redisClient = createRedisConnection(this.config);
      try {
        const pong = await redisClient.ping();
        redis = pong === 'PONG' ? 'ok' : 'error';
      } catch {
        redis = 'error';
      }
    } else if (opts.failOnCritical && isProductionEnv()) {
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

    // Dedicated worker required when Redis is set and API does not run the consumer.
    let worker: DepStatus = 'skipped';
    const needsExternalWorker =
      !!redisUrl && !shouldRunTranscodeWorker(this.config);
    if (needsExternalWorker) {
      if (redis !== 'ok' || !redisClient) {
        worker = 'error';
      } else {
        try {
          const raw = await redisClient.get(WORKER_HEARTBEAT_KEY);
          const ts = raw ? Number(raw) : NaN;
          if (!Number.isFinite(ts)) {
            worker = 'missing';
          } else if (Date.now() - ts > WORKER_HEARTBEAT_MAX_AGE_MS) {
            worker = 'stale';
          } else {
            worker = 'ok';
          }
        } catch {
          worker = 'error';
        }
      }
    } else if (this.transcodeQueue?.workerRunning()) {
      worker = 'ok';
    }

    if (redisClient) {
      await redisClient.quit().catch(() => undefined);
    }

    return { db, redis, queue, worker };
  }
}
