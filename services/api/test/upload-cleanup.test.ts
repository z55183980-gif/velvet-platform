import test from 'node:test';
import assert from 'node:assert/strict';
import { canCleanupUploadedSource } from '../src/upload/upload-cleanup.util';

test('cleanup accepts tenant-owned and server-staged videos only', () => {
  assert.equal(canCleanupUploadedSource('8-1786735401112-288110a57f7f1565.mp4', 8n), true);
  assert.equal(canCleanupUploadedSource('8-1786735401112-288110a57f7f1565.mp4', 7n), false);
  assert.equal(canCleanupUploadedSource('1786735401112-288110a57f7f1565.mp4', 8n), true);
  assert.equal(canCleanupUploadedSource('1786735401112-288110a57f7f1565.exe', 8n), false);
  assert.equal(canCleanupUploadedSource('1786735401112-random-name.mp4', null), false);
});
