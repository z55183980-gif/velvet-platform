import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadService } from '../src/upload/upload.service';
import { BizException } from '../src/common/biz.exception';

test('collectReferencedUploadBasenames paginates beyond a single page', async () => {
  const pages: any[][] = [
    Array.from({ length: 2 }, (_, i) => ({
      id: BigInt(i + 1),
      originalUrl: `uploads/${i + 1}-a.mp4`,
      hlsUrl: null,
    })),
    [
      {
        id: 3n,
        originalUrl: 'uploads/3-b.mp4',
        hlsUrl: 'uploads/3-b-hls.mp4',
      },
    ],
  ];
  let call = 0;
  const prisma: any = {
    episode: {
      findMany: async ({ take }: { take: number }) => {
        // Emulate cursor pages smaller than service pageSize by returning
        // successive chunks until empty — first call returns 2, second 1, third 0.
        const page = pages[call] || [];
        call += 1;
        assert.ok(take >= 1);
        return page;
      },
    },
  };
  const svc = new UploadService({} as any, prisma, {} as any);
  const set = await svc.collectReferencedUploadBasenames({ pageSize: 2 });
  assert.equal(call, 2);
  assert.equal(set.has('1-a.mp4'), true);
  assert.equal(set.has('2-a.mp4'), true);
  assert.equal(set.has('3-b.mp4'), true);
  assert.equal(set.has('3-b-hls.mp4'), true);
});

test('assertCallerOwnsMediaPath allows own uploads prefix and bound episode path', () => {
  const svc = new UploadService({} as any, {} as any, {} as any);
  const ep = {
    originalUrl: 'uploads/9-old.mp4',
    hlsUrl: 'hls/job1/index.m3u8',
  };
  assert.doesNotThrow(() =>
    svc.assertCallerOwnsMediaPath(9n, 'uploads/9-new.mp4', ep),
  );
  assert.doesNotThrow(() =>
    svc.assertCallerOwnsMediaPath(9n, 'uploads/9-old.mp4', ep),
  );
  assert.doesNotThrow(() =>
    svc.assertCallerOwnsMediaPath(9n, 'hls/job1/index.m3u8', ep),
  );
});

test('assertCallerOwnsMediaPath rejects cross-tenant uploads and unbound hls', () => {
  const svc = new UploadService({} as any, {} as any, {} as any);
  const ep = { originalUrl: null, hlsUrl: null };
  assert.throws(
    () => svc.assertCallerOwnsMediaPath(9n, 'uploads/42-stolen.mp4', ep),
    (e: any) => e instanceof BizException && e.message === 'upload.mediaNotOwned',
  );
  assert.throws(
    () => svc.assertCallerOwnsMediaPath(9n, 'hls/other/index.m3u8', ep),
    (e: any) => e instanceof BizException && e.message === 'upload.mediaNotOwned',
  );
});

test('assertCallerOwnsMediaPath rejects already-bound foreign uploads path', () => {
  const svc = new UploadService({} as any, {} as any, {} as any);
  const ep = { originalUrl: 'uploads/42-stolen.mp4', hlsUrl: null };
  assert.throws(
    () => svc.assertCallerOwnsMediaPath(9n, 'uploads/42-stolen.mp4', ep),
    (e: any) => e instanceof BizException && e.message === 'upload.mediaNotOwned',
  );
});
