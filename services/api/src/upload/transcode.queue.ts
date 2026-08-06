import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

export const TRANSCODE_QUEUE_NAME = 'velvet-transcode';

export type TranscodeQueueJobData = {
  jobId: string;
};

export function readRedisUrl(config?: ConfigService): string | null {
  const raw =
    config?.get<string>('REDIS_URL') ||
    process.env.REDIS_URL ||
    '';
  const url = String(raw).trim();
  return url || null;
}

/** Separate worker process: `VELVET_PROCESS=worker` (no HTTP). */
export function isWorkerProcess(): boolean {
  return String(process.env.VELVET_PROCESS || '').trim().toLowerCase() === 'worker';
}

/**
 * Run BullMQ Worker in this process?
 * - worker process: always
 * - API process: when REDIS is set and TRANSCODE_INLINE is not "false"/"0"
 *   (default inline so single-process still works; set TRANSCODE_INLINE=false in prod with velvet-worker)
 */
export function shouldRunTranscodeWorker(config?: ConfigService): boolean {
  if (isWorkerProcess()) return true;
  if (!readRedisUrl(config)) return false;
  const inline = (
    config?.get<string>('TRANSCODE_INLINE') ||
    process.env.TRANSCODE_INLINE ||
    'true'
  )
    .trim()
    .toLowerCase();
  return inline !== 'false' && inline !== '0' && inline !== 'no';
}

export function createRedisConnection(config?: ConfigService): IORedis {
  const url = readRedisUrl(config);
  if (!url) {
    throw new Error('REDIS_URL is required for BullMQ');
  }
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
