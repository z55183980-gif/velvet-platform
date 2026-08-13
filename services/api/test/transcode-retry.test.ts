import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadService, type TranscodeJob } from '../src/upload/upload.service';

function makeService(attempts: number, maxAttempts = 3) {
  const mediaUpdates: any[] = [];
  const episodeUpdates: any[] = [];
  const prisma = {
    mediaTranscodeJob: {
      findUnique: async () => ({ attempts }),
      update: async (args: any) => {
        mediaUpdates.push(args);
        return args.data;
      },
    },
    episode: {
      update: async (args: any) => {
        episodeUpdates.push(args);
        return args.data;
      },
    },
  };
  const config = {
    get: (key: string) => {
      if (key === 'TRANSCODE_MAX_ATTEMPTS') return String(maxAttempts);
      if (key === 'TRANSCODE_RETRY_BASE_MS') return '1';
      return undefined;
    },
  };
  const service = new UploadService(config as any, prisma as any, {} as any);
  return { service: service as any, mediaUpdates, episodeUpdates };
}

function job(): TranscodeJob {
  return {
    id: 'transcode-1',
    episodeId: '101',
    inputRel: 'uploads/ep-1.mp4',
    status: 'processing',
    createdAt: Date.now(),
  };
}

test('transcode failure stays queued and retries before the final attempt', async () => {
  const { service, mediaUpdates, episodeUpdates } = makeService(1, 3);
  let reruns = 0;
  service.processTranscodeJob = async () => {
    reruns += 1;
  };

  const current = job();
  await service.retryOrFailTranscode(current, 'ffmpeg temporary failure');

  assert.equal(current.status, 'queued');
  assert.equal(reruns, 1);
  assert.equal(mediaUpdates[0].data.status, 'QUEUED');
  assert.equal(episodeUpdates[0].data.transcodeStatus, 'PENDING');
});

test('transcode failure becomes terminal after attempts are exhausted', async () => {
  const { service, mediaUpdates, episodeUpdates } = makeService(3, 3);
  let reruns = 0;
  service.processTranscodeJob = async () => {
    reruns += 1;
  };

  const current = job();
  await service.retryOrFailTranscode(current, 'ffmpeg final failure');

  assert.equal(current.status, 'failed');
  assert.equal(reruns, 0);
  assert.equal(mediaUpdates.at(-1).data.status, 'FAILED');
  assert.equal(episodeUpdates.at(-1).data.transcodeStatus, 'FAILED');
});

test('drama fail-fast skips queued transcodes but leaves processing work alone', async () => {
  const mediaUpdates: any[] = [];
  const episodeUpdates: any[] = [];
  const rows: Array<{
    id: string;
    episodeId: bigint;
    status: string;
    error: string | null;
  }> = [
    { id: 'queued-1', episodeId: 101n, status: 'QUEUED', error: null },
    { id: 'active-2', episodeId: 102n, status: 'PROCESSING', error: null },
  ];
  const prisma = {
    mediaTranscodeJob: {
      findMany: async (args: any) => {
        const statuses = args.where.status?.in || [args.where.status];
        return rows.filter(
          (row) =>
            args.where.id.in.includes(row.id) &&
            statuses.includes(row.status) &&
            (args.where.error == null || args.where.error === row.error),
        );
      },
      updateMany: async (args: any) => {
        mediaUpdates.push(args);
        for (const row of rows) {
          if (args.where.id.in.includes(row.id) && row.status === args.where.status) {
            row.status = args.data.status;
            row.error = args.data.error;
          }
        }
        return { count: 1 };
      },
    },
    episode: {
      updateMany: async (args: any) => {
        episodeUpdates.push(args);
        return { count: args.where.id.in.length };
      },
    },
  };
  const service = new UploadService({ get: () => undefined } as any, prisma as any, {} as any);

  const skipped = await service.skipQueuedTranscodeJobs(
    ['queued-1', 'active-2'],
    'whole drama skipped',
  );

  assert.equal(skipped, 1);
  assert.equal(rows[0].status, 'FAILED');
  assert.equal(rows[1].status, 'PROCESSING');
  assert.equal(mediaUpdates.length, 1);
  assert.deepEqual(episodeUpdates[0].where.id.in, [101n]);
});
