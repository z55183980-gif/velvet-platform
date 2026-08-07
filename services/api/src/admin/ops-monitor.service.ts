import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ServerMetricsService } from '../common/server-metrics.service';
import { UploadService } from '../upload/upload.service';
import { TranscodeQueueService } from '../upload/transcode-queue.service';
import { CloudflareAnalyticsService } from './cloudflare-analytics.service';

@Injectable()
export class OpsMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serverMetrics: ServerMetricsService,
    private readonly upload: UploadService,
    private readonly transcodeQueue: TranscodeQueueService,
    private readonly cloudflare: CloudflareAnalyticsService,
  ) {}

  async overview(opts?: { rangeHours?: number }) {
    const rangeHours = opts?.rangeHours ?? 24;
    const [server, storage, cloudflare, transcode, queue] = await Promise.all([
      this.serverMetrics.getSnapshot({ includeProcesses: true }),
      this.upload.storageProbe().catch((e) => ({
        ...this.upload.storageStatus(),
        probe: {
          ok: false,
          error: e?.message || String(e),
          checkedAt: new Date().toISOString(),
        },
      })),
      this.cloudflare.getAnalytics(rangeHours),
      this.transcodeSnapshot(),
      this.queueSnapshot(),
    ]);

    return {
      fetchedAt: new Date().toISOString(),
      rangeHours,
      server,
      storage,
      cloudflare,
      transcode,
      queue,
    };
  }

  private async transcodeSnapshot() {
    const [byEpisode, byJob, recentFailed] = await Promise.all([
      this.prisma.episode.groupBy({
        by: ['transcodeStatus'],
        _count: { _all: true },
      }),
      this.prisma.mediaTranscodeJob.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.mediaTranscodeJob.findMany({
        where: { status: 'FAILED' },
        orderBy: { updatedAt: 'desc' },
        take: 12,
        select: {
          id: true,
          episodeId: true,
          status: true,
          error: true,
          attempts: true,
          createdAt: true,
          updatedAt: true,
          finishedAt: true,
        },
      }),
    ]);

    const episodeCounts: Record<string, number> = {};
    for (const row of byEpisode) {
      episodeCounts[row.transcodeStatus] = row._count._all;
    }
    const jobCounts: Record<string, number> = {};
    for (const row of byJob) {
      jobCounts[row.status] = row._count._all;
    }

    return {
      episodeCounts,
      jobCounts,
      recentFailed: recentFailed.map((row) => ({
        id: row.id,
        episodeId: row.episodeId != null ? row.episodeId.toString() : null,
        status: row.status,
        error: row.error,
        attempts: row.attempts,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
      })),
    };
  }

  private async queueSnapshot() {
    const mode = this.transcodeQueue.mode();
    const workerRunning = this.transcodeQueue.workerRunning();
    try {
      const counts = await this.transcodeQueue.getJobCounts();
      return { mode, workerRunning, ...counts };
    } catch (e: any) {
      return {
        mode,
        workerRunning,
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
        error: e?.message || String(e),
      };
    }
  }
}
