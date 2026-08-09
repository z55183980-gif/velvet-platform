import test from 'node:test';
import assert from 'node:assert/strict';
import { OtpService } from '../src/auth/otp.service';
import { BizCode } from '../src/common/biz.exception';

function makeOtp() {
  return new OtpService({
    get: (key: string) => {
      if (key === 'OTP_TTL_SECONDS') return 300;
      if (key === 'OTP_LENGTH') return 6;
      return undefined;
    },
  } as any);
}

test('OTP verify consumes code on success (memory backend)', async () => {
  const otp = makeOtp();
  const { code } = await otp.generate('email', 'user@example.com', 'login');
  assert.equal(await otp.verify('email', 'user@example.com', code, 'login'), true);
  assert.equal(await otp.verify('email', 'user@example.com', code, 'login'), false);
});

test('OTP wrong code increments toward lock', async () => {
  const otp = makeOtp();
  await otp.generate('email', 'lock@example.com', 'login');
  for (let i = 0; i < 4; i++) {
    assert.equal(await otp.verify('email', 'lock@example.com', '000000', 'login'), false);
  }
  await assert.rejects(
    () => otp.verify('email', 'lock@example.com', '000000', 'login'),
    (err: any) =>
      err?.bizCode === BizCode.OTP_LOCKED || String(err?.message || '').includes('otp'),
  );
});
