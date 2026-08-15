import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forEachBounded,
  normalizeR2HlsUploadConcurrency,
} from '../src/storage/r2-upload.util';

test('R2 HLS upload concurrency defaults to four and stays bounded', () => {
  assert.equal(normalizeR2HlsUploadConcurrency(undefined), 4);
  assert.equal(normalizeR2HlsUploadConcurrency('0'), 1);
  assert.equal(normalizeR2HlsUploadConcurrency('6'), 6);
  assert.equal(normalizeR2HlsUploadConcurrency('99'), 8);
  assert.equal(normalizeR2HlsUploadConcurrency('invalid'), 4);
});

test('bounded runner never exceeds the requested concurrency', async () => {
  let active = 0;
  let peak = 0;
  const completed: number[] = [];
  await forEachBounded([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    completed.push(item);
    active -= 1;
  });
  assert.equal(peak, 2);
  assert.deepEqual(completed.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});
