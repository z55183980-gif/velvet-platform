import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTransferProgress } from '../src/admin/transfer-progress.util';

test('download completion remains running while transcodes are queued or processing', () => {
  const progress = deriveTransferProgress('completed', [
    'completed',
    'queued',
    'processing',
  ]);
  assert.equal(progress.status, 'running');
  assert.equal(progress.phase, 'transcoding');
  assert.deepEqual(progress.transcode, {
    total: 3,
    pending: 0,
    queued: 1,
    processing: 1,
    completed: 1,
    failed: 0,
    settled: false,
  });
});

test('task completes only after every transcode completes', () => {
  const progress = deriveTransferProgress('completed', [
    'completed',
    'completed',
  ]);
  assert.equal(progress.status, 'completed');
  assert.equal(progress.phase, 'completed');
  assert.equal(progress.transcode.settled, true);
});

test('settled transcode failure makes the task fail', () => {
  const progress = deriveTransferProgress('completed', [
    'completed',
    'failed',
  ]);
  assert.equal(progress.status, 'failed');
  assert.equal(progress.phase, 'failed');
  assert.equal(progress.transcode.failed, 1);
});

test('active downloads keep transfer phase even when earlier episodes transcode', () => {
  const progress = deriveTransferProgress('running', [
    'completed',
    'processing',
  ]);
  assert.equal(progress.status, 'running');
  assert.equal(progress.phase, 'transferring');
});
