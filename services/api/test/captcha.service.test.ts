import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptchaService } from '../src/common/captcha.service';

test('captcha storage stays bounded when the process-local cache is full', () => {
  const service = new CaptchaService({ get: () => undefined } as any);
  const entries: Map<string, unknown> = (service as any).entries;
  for (let i = 0; i < 10_000; i++) {
    entries.set(`old-${i}`, { hash: 'x', expiresAt: Date.now() + 60_000, kind: 'web' });
  }

  service.issue('web');
  assert.ok(entries.size <= 10_000);
  assert.equal(entries.has('old-0'), false);
});
