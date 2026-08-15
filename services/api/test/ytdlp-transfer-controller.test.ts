import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentController } from '../src/admin/content.controller';

test('yt-dlp transfer forwards recognized source tags to the import service', async () => {
  const calls: Array<{ options: Record<string, unknown>; actorId?: bigint }> = [];
  const ytdlp = {
    transferDrama: async (options: Record<string, unknown>, actorId?: bigint) => {
      calls.push({ options, actorId });
      return { id: '2', jobId: 'job-2' };
    },
  };
  const controller = new ContentController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    ytdlp as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const sourceTags = [
    'Female',
    'Drama',
    'Revenge',
    'type:真人短剧',
    'completion:已完结',
  ];

  await controller.ytdlpTransfer(
    {
      url: 'https://www.reelshort.com/movie/example-6836a4b02ef81742260a5219',
      target: 'r2',
      titleEn: 'Regret is the Punishment',
      sourceTags,
      autoPublish: false,
    } as never,
    { adminId: 9n },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.sourceTags, sourceTags);
  assert.equal(calls[0].options.autoPublish, false);
  assert.equal(calls[0].actorId, 9n);
});
