import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptchaService } from '../src/common/captcha.service';

test('captcha storage stays bounded when the process-local cache is full', async () => {
  const service = new CaptchaService({ get: () => undefined } as any);
  const localIds: Set<string> = (service as any).localIds;
  for (let i = 0; i < 10_000; i++) {
    localIds.add(`old-${i}`);
    await (service as any).kv.set(
      `old-${i}`,
      JSON.stringify({ hash: 'x', expiresAt: Date.now() + 60_000, kind: 'web' }),
      60,
    );
  }

  await service.issue('web');
  assert.ok(localIds.size <= 10_000);
  assert.equal(localIds.has('old-0'), false);
});

test('captcha verify consumes challenge once', async () => {
  const prev = process.env.AUTH_WEB_CAPTCHA_DISABLED;
  delete process.env.AUTH_WEB_CAPTCHA_DISABLED;
  try {
    const service = new CaptchaService({
      get: (key: string) => (key === 'AUTH_WEB_CAPTCHA_DISABLED' ? '' : undefined),
    } as any);
    const challenge = await service.issue('web');
    assert.equal(challenge.captchaRequired, true);
    assert.ok(challenge.captchaId);

    // Extract code from SVG text nodes is fragile — re-issue via kv inspect instead.
    const raw = await (service as any).kv.get(challenge.captchaId);
    assert.ok(raw);
    const entry = JSON.parse(raw);
    // Forge a matching code by rewriting the stored hash for a known code.
    const known = 'ABCD';
    const hash = require('crypto')
      .createHash('sha256')
      .update(known)
      .digest('hex');
    await (service as any).kv.set(
      challenge.captchaId,
      JSON.stringify({ ...entry, hash }),
      60,
    );

    await service.verify('web', challenge.captchaId, known);
    await assert.rejects(
      () => service.verify('web', challenge.captchaId, known),
      (err: any) => String(err?.message || err).includes('captcha'),
    );
  } finally {
    if (prev === undefined) delete process.env.AUTH_WEB_CAPTCHA_DISABLED;
    else process.env.AUTH_WEB_CAPTCHA_DISABLED = prev;
  }
});
