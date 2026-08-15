import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundedTransferPipeline,
  normalizeTransferJobConcurrency,
  normalizeTransferPipelineDepth,
  shouldAutoPublishTransfer,
} from '../src/admin/transfer-pipeline.util';

test('pipeline depth defaults to two and remains bounded', () => {
  assert.equal(normalizeTransferPipelineDepth(undefined), 2);
  assert.equal(normalizeTransferPipelineDepth('0'), 1);
  assert.equal(normalizeTransferPipelineDepth('3'), 3);
  assert.equal(normalizeTransferPipelineDepth('99'), 4);
  assert.equal(normalizeTransferPipelineDepth('invalid'), 2);
});

test('transfer job concurrency is deliberately capped at two', () => {
  assert.equal(normalizeTransferJobConcurrency(undefined), 1);
  assert.equal(normalizeTransferJobConcurrency('0'), 1);
  assert.equal(normalizeTransferJobConcurrency('2'), 2);
  assert.equal(normalizeTransferJobConcurrency('20'), 2);
  assert.equal(normalizeTransferJobConcurrency('invalid'), 1);
});

test('transfer jobs auto-publish by default and preserve an explicit opt-out', () => {
  assert.equal(shouldAutoPublishTransfer(undefined), true);
  assert.equal(shouldAutoPublishTransfer(true), true);
  assert.equal(shouldAutoPublishTransfer(false), false);
});

test('depth two overlaps one entry and settles in source order', async () => {
  const settled: number[] = [];
  const pipeline = new BoundedTransferPipeline<number, number>(2, async (entry) => {
    settled.push(entry);
    return entry;
  });

  assert.equal(await pipeline.push(1), null);
  assert.deepEqual(settled, []);
  assert.equal(pipeline.pendingCount, 1);

  assert.equal(await pipeline.push(2), 1);
  assert.deepEqual(settled, [1]);
  assert.equal(pipeline.pendingCount, 1);

  assert.equal(await pipeline.push(3), 2);
  assert.deepEqual(await pipeline.drain(), [3]);
  assert.deepEqual(settled, [1, 2, 3]);
  assert.equal(pipeline.pendingCount, 0);
});

test('depth one preserves the previous strict serial behavior', async () => {
  const pipeline = new BoundedTransferPipeline<string, string>(1, async (entry) => entry);
  assert.equal(await pipeline.push('ep1'), 'ep1');
  assert.deepEqual(await pipeline.drain(), []);
});
