import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { UploadService } from './upload.service';
import {
  TRANSCODE_QUEUE_NAME,
  TranscodeQueueJobData,
  createRedisConnection,
  isWorkerProcess,
  readRedisUrl,
  shouldRunTranscodeWorker,
} from './transcode.queue';

@Injectable()
export class TranscodeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscodeQueueService.name);
  private connection: IORedis | null = null;
  private queue: Queue<TranscodeQueueJobData> | null = null;
  private worker: Worker<TranscodeQueueJobData> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly upload: UploadService,
  ) {}

  mode(): 'bullmq' | 'inline' {
    return this.queue ? 'bullmq' : 'inline';
  }

  workerRunning(): boolean {
    return !!this.worker || this.upload.isInlinePumpEnabled();
  }

  async getJobCounts() {
    if (!this.queue) {
      return {
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
      };
    }
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
    );
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      delayed: counts.delayed || 0,
      failed: counts.failed || 0,
      completed: counts.completed || 0,
    };
  }

  async onModuleInit() {
    const redisUrl = readRedisUrl(this.config);
    if (!redisUrl) {
      this.logger.log('REDIS_URL unset — transcode uses in-process queue');
      this.upload.enableInlinePump(true);
      this.upload.setJobDispatcher(null);
      await this.upload.recoverPendingJobs();
      return;
    }

    this.connection = createRedisConnection(this.config);
    this.queue = new Queue(TRANSCODE_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 1,
      },
    });
    this.upload.setJobDispatcher(async (jobId) => {
      await this.enqueueExisting(jobId);
    });

    if (shouldRunTranscodeWorker(this.config)) {
      this.upload.enableInlinePump(false);
      this.worker = new Worker<TranscodeQueueJobData>(
        TRANSCODE_QUEUE_NAME,
        async (job: Job<TranscodeQueueJobData>) => {
          await this.upload.processTranscodeJob(job.data.jobId);
        },
        {
          connection: this.connection.duplicate(),
          concurrency: Math.max(
            1,
            parseInt(
              this.config.get<string>('TRANSCODE_CONCURRENCY') ||
                process.env.TRANSCODE_CONCURRENCY ||
                '1',
              10,
            ) || 1,
          ),
        },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `bullmq job failed id=${job?.id} data=${job?.data?.jobId}: ${err?.message || err}`,
        );
      });
      this.logger.log(
        `BullMQ worker started queue=${TRANSCODE_QUEUE_NAME} process=${isWorkerProcess() ? 'worker' : 'api-inline'}`,
      );
    } else {
      this.upload.enableInlinePump(false);
      this.logger.log(
        'BullMQ enqueue-only (TRANSCODE_INLINE=false) — ensure velvet-worker is running',
      );
    }

    await this.upload.recoverPendingJobs(async (jobId) => {
      await this.enqueueExisting(jobId);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
    this.worker = null;
    this.queue = null;
    this.connection = null;
  }

  /** Push an already-persisted mediaTranscodeJob id onto BullMQ (or inline pump). */
  async enqueueExisting(jobId: string): Promise<void> {
    if (this.queue) {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'completed' || state === 'failed') {
          await existing.remove().catch(() => undefined);
        } else {
          // already waiting / active / delayed
          return;
        }
      }
      await this.queue.add(
        'transcode',
        { jobId },
        {
          jobId,
          removeOnComplete: 100,
          removeOnFail: 200,
          attempts: 1,
        },
      );
      return;
    }
    this.upload.enqueueInline(jobId);
  }
}
