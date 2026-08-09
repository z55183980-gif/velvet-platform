import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service';
import { BizException, BizCode } from '../src/common/biz.exception';
import {
  assertProductionAuthConfig,
  assertProductionSecrets,
} from '../src/common/security-config';

type UserRow = {
  id: bigint;
  email: string | null;
  username: string | null;
  nickname: string | null;
  passwordHash: string | null;
  googleId: string | null;
  phone: string | null;
  locale: string;
  status: string;
  avatarUrl: string | null;
  vipExpireAt: Date | null;
  creator?: null;
};

function hashLike(password: string): string {
  // AuthService uses salt:hash; for mocks we only need a non-empty stored value
  // when testing conflict on existing password accounts (verify path tested separately).
  return `salt:${Buffer.from(password).toString('hex')}`;
}

function makeConfig(flags: Record<string, string | boolean | undefined> = {}) {
  const map: Record<string, string | boolean | undefined> = {
    AUTH_EMAIL_OTP_ENABLED: false,
    AUTH_PHONE_OTP_ENABLED: false,
    AUTH_WEB_CAPTCHA_DISABLED: false,
    ...flags,
  };
  return {
    get: (key: string) => map[key],
  };
}

function makeAuth(opts: {
  users?: UserRow[];
  emailOtpEnabled?: boolean;
  otpVerify?: boolean;
}) {
  const users = [...(opts.users || [])];
  const wallets = new Set<string>();
  const sessions: unknown[] = [];

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.email != null) {
          return users.find((u) => u.email === where.email) || null;
        }
        if (where.username != null) {
          return users.find((u) => u.username === where.username) || null;
        }
        if (where.id != null) {
          return users.find((u) => u.id === where.id) || null;
        }
        return null;
      },
      create: async ({ data }: { data: Partial<UserRow> }) => {
        const row: UserRow = {
          id: BigInt(users.length + 1),
          email: data.email ?? null,
          username: data.username ?? null,
          nickname: data.nickname ?? null,
          passwordHash: data.passwordHash ?? null,
          googleId: data.googleId ?? null,
          phone: data.phone ?? null,
          locale: data.locale || 'en',
          status: data.status || 'ACTIVE',
          avatarUrl: data.avatarUrl ?? null,
          vipExpireAt: null,
          creator: null,
        };
        users.push(row);
        return row;
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: bigint };
        data: Partial<UserRow>;
        include?: { creator?: boolean };
      }) => {
        const idx = users.findIndex((u) => u.id === where.id);
        if (idx < 0) throw new Error('user missing');
        users[idx] = { ...users[idx], ...data };
        if (include?.creator) return { ...users[idx], creator: null };
        return users[idx];
      },
    },
    wallet: {
      upsert: async ({ where }: { where: { userId: bigint } }) => {
        wallets.add(String(where.userId));
        return { userId: where.userId };
      },
    },
    session: {
      create: async ({ data }: { data: unknown }) => {
        sessions.push(data);
        return data;
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };

  const otp = {
    verify: async () => opts.otpVerify !== false,
    generate: async () => ({ code: '123456', expiresInSec: 300 }),
  };

  const session = {
    sign: () => 'test-token',
  };

  const mailer = {
    isConfigured: () => false,
    sendMail: async () => undefined,
  };

  const auth = new AuthService(
    prisma as any,
    otp as any,
    session as any,
    mailer as any,
    makeConfig({
      AUTH_EMAIL_OTP_ENABLED: opts.emailOtpEnabled ? 'true' : 'false',
    }) as any,
  );

  return { auth, users, wallets, sessions, prisma };
}

const googleUser = (): UserRow => ({
  id: 10n,
  email: 'victim@example.com',
  username: null,
  nickname: 'Victim',
  passwordHash: null,
  googleId: 'google-sub-1',
  phone: null,
  locale: 'en',
  status: 'ACTIVE',
  avatarUrl: null,
  vipExpireAt: null,
  creator: null,
});

const passwordlessUser = (): UserRow => ({
  id: 11n,
  email: 'otpuser@example.com',
  username: null,
  nickname: 'OtpUser',
  passwordHash: null,
  googleId: null,
  phone: null,
  locale: 'en',
  status: 'ACTIVE',
  avatarUrl: null,
  vipExpireAt: null,
  creator: null,
});

const passwordUser = (): UserRow => ({
  id: 12n,
  email: 'pass@example.com',
  username: 'passuser',
  nickname: 'Pass',
  passwordHash: hashLike('secret12'),
  googleId: null,
  phone: null,
  locale: 'en',
  status: 'ACTIVE',
  avatarUrl: null,
  vipExpireAt: null,
  creator: null,
});

test('registerEmail: Google account email always conflicts (OTP off)', async () => {
  const { auth, users } = makeAuth({ users: [googleUser()], emailOtpEnabled: false });
  await assert.rejects(
    () =>
      auth.registerEmail({
        email: 'victim@example.com',
        password: 'attacker1',
      }),
    (err: unknown) =>
      err instanceof BizException &&
      err.bizCode === BizCode.CONFLICT &&
      err.message === 'auth.emailAlreadyRegistered',
  );
  assert.equal(users[0].passwordHash, null);
});

test('registerEmail: passwordless email account always conflicts (OTP off)', async () => {
  const { auth, users } = makeAuth({ users: [passwordlessUser()], emailOtpEnabled: false });
  await assert.rejects(
    () =>
      auth.registerEmail({
        email: 'otpuser@example.com',
        password: 'attacker1',
      }),
    (err: unknown) => err instanceof BizException && err.bizCode === BizCode.CONFLICT,
  );
  assert.equal(users[0].passwordHash, null);
});

test('registerEmail: password account always conflicts', async () => {
  const { auth } = makeAuth({ users: [passwordUser()], emailOtpEnabled: false });
  await assert.rejects(
    () =>
      auth.registerEmail({
        email: 'pass@example.com',
        password: 'attacker1',
      }),
    (err: unknown) => err instanceof BizException && err.bizCode === BizCode.CONFLICT,
  );
});

test('registerEmail: Google account still conflicts when OTP on + valid code', async () => {
  const { auth, users } = makeAuth({
    users: [googleUser()],
    emailOtpEnabled: true,
    otpVerify: true,
  });
  await assert.rejects(
    () =>
      auth.registerEmail({
        email: 'victim@example.com',
        password: 'attacker1',
        code: '123456',
      }),
    (err: unknown) => err instanceof BizException && err.bizCode === BizCode.CONFLICT,
  );
  assert.equal(users[0].passwordHash, null);
});

test('registerEmail: fresh email creates account when OTP off', async () => {
  const { auth, users, wallets, sessions } = makeAuth({ emailOtpEnabled: false });
  const result = await auth.registerEmail({
    email: 'new@example.com',
    password: 'goodpass',
  });
  assert.equal(result.token, 'test-token');
  assert.equal(users.length, 1);
  assert.equal(users[0].email, 'new@example.com');
  assert.ok(users[0].passwordHash);
  assert.equal(wallets.has('1'), true);
  assert.equal(sessions.length, 1);
});

test('registerEmail: fresh email requires OTP when enabled', async () => {
  const { auth } = makeAuth({ emailOtpEnabled: true, otpVerify: false });
  await assert.rejects(
    () =>
      auth.registerEmail({
        email: 'new2@example.com',
        password: 'goodpass',
        code: '000000',
      }),
    (err: unknown) => err instanceof BizException && err.bizCode === BizCode.INVALID_OTP,
  );
});

test('sendEmailOtp(register): conflicts for Google / passwordless / password emails', async () => {
  for (const u of [googleUser(), passwordlessUser(), passwordUser()]) {
    const { auth } = makeAuth({ users: [u], emailOtpEnabled: true });
    await assert.rejects(
      () => auth.sendEmailOtp(u.email!, 'register'),
      (err: unknown) => err instanceof BizException && err.bizCode === BizCode.CONFLICT,
    );
  }
});

test('bindPassword: Google user can set password with authenticated session', async () => {
  const { auth, users } = makeAuth({ users: [googleUser()] });
  const profile = await auth.bindPassword(10n, { password: 'newpass1' });
  assert.equal(profile.hasPassword, true);
  assert.ok(users[0].passwordHash);
});

test('bindPassword: existing password requires currentPassword re-auth', async () => {
  const { auth, users } = makeAuth({ emailOtpEnabled: false });
  await auth.registerEmail({ email: 'chg@example.com', password: 'oldpass1' });
  const id = users[0].id;

  await assert.rejects(
    () => auth.bindPassword(id, { password: 'newpass1' }),
    (err: unknown) =>
      err instanceof BizException && err.bizCode === BizCode.UNAUTHORIZED,
  );
  await assert.rejects(
    () => auth.bindPassword(id, { password: 'newpass1', currentPassword: 'wrong' }),
    (err: unknown) =>
      err instanceof BizException && err.bizCode === BizCode.UNAUTHORIZED,
  );

  const profile = await auth.bindPassword(id, {
    password: 'newpass1',
    currentPassword: 'oldpass1',
  });
  assert.equal(profile.hasPassword, true);
});

test('bindPassword: passwordless user can bind with session alone', async () => {
  const { auth, users } = makeAuth({ users: [passwordlessUser()] });
  const profile = await auth.bindPassword(11n, { password: 'boundpass' });
  assert.equal(profile.hasPassword, true);
  assert.ok(users[0].passwordHash);
});

test('resetPassword: verified OTP can bind password on Google account', async () => {
  const { auth, users } = makeAuth({ users: [googleUser()], otpVerify: true });
  const result = await auth.resetPassword({
    email: 'victim@example.com',
    code: '123456',
    password: 'resetpass',
  });
  assert.equal(result.token, 'test-token');
  assert.ok(users[0].passwordHash);
});

test('production auth config: OTP off fails startup assert', () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_EMAIL_OTP_ENABLED: process.env.AUTH_EMAIL_OTP_ENABLED,
    AUTH_WEB_CAPTCHA_DISABLED: process.env.AUTH_WEB_CAPTCHA_DISABLED,
    JWT_SECRET: process.env.JWT_SECRET,
    CDN_SIGN_KEY: process.env.CDN_SIGN_KEY,
    ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    REDIS_URL: process.env.REDIS_URL,
  };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    process.env.AUTH_EMAIL_OTP_ENABLED = 'false';
    process.env.AUTH_WEB_CAPTCHA_DISABLED = 'false';
    assert.throws(
      () => assertProductionAuthConfig(),
      /AUTH_EMAIL_OTP_ENABLED must be true/,
    );

    process.env.AUTH_EMAIL_OTP_ENABLED = 'true';
    process.env.AUTH_WEB_CAPTCHA_DISABLED = 'true';
    assert.throws(
      () => assertProductionAuthConfig(),
      /AUTH_WEB_CAPTCHA_DISABLED/,
    );

    process.env.AUTH_EMAIL_OTP_ENABLED = 'true';
    process.env.AUTH_WEB_CAPTCHA_DISABLED = 'false';
    process.env.JWT_SECRET = 'production-jwt-secret-key-32b';
    process.env.CDN_SIGN_KEY = 'production-cdn-sign-key-32b';
    delete process.env.REDIS_URL;
    assert.throws(() => assertProductionSecrets(), /REDIS_URL is required/);

    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    assert.doesNotThrow(() => assertProductionSecrets());
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
