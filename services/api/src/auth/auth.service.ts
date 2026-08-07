import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService, OtpPurpose } from './otp.service';
import { SessionService } from './session.service';
import { MailerService } from '../common/mailer.service';
import { ConfigService } from '@nestjs/config';
import { BizException, BizCode } from '../common/biz.exception';
import { ClientMeta, enrichClientMeta } from '../common/request-meta';
import * as crypto from 'crypto';

export interface LoginResult {
  token: string;
  user: {
    id: string;
    phone: string | null;
    email: string | null;
    username: string | null;
    nickname: string | null;
    locale: string;
    isCreator: boolean;
    hasPassword: boolean;
  };
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

const MIN_PASSWORD_LEN = 6;

type GoogleOAuthState = {
  origin: string;
  expiresAt: number;
};

@Injectable()
export class AuthService {
  private readonly cookieName = 'dv_session';
  private readonly adminToken: string;
  /** 公测开关：邮箱 OTP 登录/注册激活（找回密码不受此限制） */
  private readonly emailOtpEnabled: boolean;
  /** 公测开关：手机 OTP 登录 */
  private readonly phoneOtpEnabled: boolean;
  private readonly smsConfigured: boolean;
  private readonly googleClientId: string;
  private readonly googleClientSecret: string;
  private readonly googleRedirectUri: string;
  private readonly defaultWebOrigin: string;
  private readonly allowedOrigins: Set<string>;
  /** Short-lived OAuth CSRF states (single-process; OK for current deploy). */
  private readonly googleStates = new Map<string, GoogleOAuthState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly session: SessionService,
    private readonly mailer: MailerService,
    config: ConfigService,
  ) {
    this.adminToken = config.get<string>('ADMIN_TOKEN') || 'dev-admin';
    this.emailOtpEnabled = this.envFlag(config, 'AUTH_EMAIL_OTP_ENABLED', false);
    this.phoneOtpEnabled = this.envFlag(config, 'AUTH_PHONE_OTP_ENABLED', false);
    this.smsConfigured = Boolean(
      String(config.get('SMS_API_KEY') || config.get('SMS_PROVIDER') || '').trim(),
    );
    this.googleClientId = String(config.get('GOOGLE_CLIENT_ID') || '').trim();
    this.googleClientSecret = String(config.get('GOOGLE_CLIENT_SECRET') || '').trim();
    const publicBase = String(config.get('PUBLIC_BASE_URL') || '').trim().replace(/\/$/, '');
    const webBase = String(config.get('WEB_BASE_URL') || '').trim().replace(/\/$/, '');
    // Prefer web origin so Next rewrite / cookie / postMessage stay same-site
    this.googleRedirectUri =
      String(config.get('GOOGLE_REDIRECT_URI') || '').trim() ||
      (webBase ? `${webBase}/api/v1/auth/google/callback` : '') ||
      (publicBase ? `${publicBase}/api/v1/auth/google/callback` : '');
    this.defaultWebOrigin = String(
      config.get('AUTH_WEB_ORIGIN') || config.get('WEB_BASE_URL') || 'https://velvetmovie.space',
    )
      .trim()
      .replace(/\/$/, '');
    this.allowedOrigins = new Set(
      String(config.get('ALLOWED_ORIGINS') || '')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean),
    );
    if (this.defaultWebOrigin) this.allowedOrigins.add(this.defaultWebOrigin);
  }

  /** 前台/管理端读取鉴权通道能力 */
  getAuthChannels() {
    return {
      password: true,
      /** 内测注册不强制邮箱验证码；公测打开 AUTH_EMAIL_OTP_ENABLED 后可要求 code */
      registerRequiresOtp: this.emailOtpEnabled,
      emailOtp: {
        enabled: this.emailOtpEnabled,
        configured: this.mailer.isConfigured(),
        /** 找回密码始终可用（内测也需要） */
        resetAlwaysOn: true,
      },
      phoneOtp: {
        enabled: this.phoneOtpEnabled,
        configured: this.smsConfigured,
      },
      google: {
        enabled: this.isGoogleEnabled(),
      },
    };
  }

  isGoogleEnabled(): boolean {
    return Boolean(this.googleClientId && this.googleClientSecret && this.googleRedirectUri);
  }

  getDefaultWebOrigin(): string {
    return this.defaultWebOrigin;
  }

  /** Build Google authorize URL; `origin` is the opener web origin for postMessage. */
  beginGoogleOAuth(originHint?: string): string {
    if (!this.isGoogleEnabled()) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.googleDisabled');
    }
    const origin = this.resolveOAuthOrigin(originHint);
    this.purgeExpiredGoogleStates();
    const state = crypto.randomBytes(24).toString('hex');
    this.googleStates.set(state, {
      origin,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const params = new URLSearchParams({
      client_id: this.googleClientId,
      redirect_uri: this.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      access_type: 'online',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange code, upsert/bind user, issue session.
   * Returns login result + opener origin for popup postMessage.
   */
  async finishGoogleOAuth(
    opts: { code?: string; state?: string; error?: string },
    meta?: ClientMeta | null,
  ): Promise<{ result: LoginResult; origin: string }> {
    const origin = this.peekGoogleStateOrigin(opts.state) || this.defaultWebOrigin;
    if (opts.error) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.googleExchangeFailed');
    }
    if (!this.isGoogleEnabled()) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.googleDisabled');
    }
    const state = String(opts.state || '').trim();
    const code = String(opts.code || '').trim();
    if (!state || !code) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.googleInvalidState');
    }
    const st = this.googleStates.get(state);
    this.googleStates.delete(state);
    if (!st || st.expiresAt < Date.now()) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.googleInvalidState');
    }

    const profile = await this.fetchGoogleProfile(code);
    const user = await this.upsertUserFromGoogle(profile);
    const result = await this.issueSession(user, meta);
    return { result, origin: st.origin || origin };
  }

  private peekGoogleStateOrigin(state?: string): string | null {
    const st = this.googleStates.get(String(state || '').trim());
    return st?.origin || null;
  }

  private resolveOAuthOrigin(hint?: string): string {
    const raw = String(hint || '').trim().replace(/\/$/, '');
    if (raw) {
      try {
        const u = new URL(raw);
        const origin = u.origin;
        if (this.allowedOrigins.size === 0 || this.allowedOrigins.has(origin)) {
          return origin;
        }
        // Local dev: allow localhost / 127.0.0.1 when configured for one of them
        if (
          (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) &&
          [...this.allowedOrigins].some(
            (o) => o.includes('localhost') || o.includes('127.0.0.1'),
          )
        ) {
          return origin;
        }
        if (process.env.NODE_ENV !== 'production') {
          return origin;
        }
        throw new BizException(BizCode.FORBIDDEN, 'auth.googleOriginDenied');
      } catch (e) {
        if (e instanceof BizException) throw e;
        throw new BizException(BizCode.FORBIDDEN, 'auth.googleOriginDenied');
      }
    }
    return this.defaultWebOrigin;
  }

  private purgeExpiredGoogleStates() {
    const now = Date.now();
    for (const [k, v] of this.googleStates) {
      if (v.expiresAt < now) this.googleStates.delete(k);
    }
  }

  private async fetchGoogleProfile(code: string): Promise<{
    googleId: string;
    email: string | null;
    emailVerified: boolean;
    name: string | null;
    picture: string | null;
  }> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.googleClientId,
        client_secret: this.googleClientSecret,
        redirect_uri: this.googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      // eslint-disable-next-line no-console
      console.error('[google oauth] token exchange failed:', tokenJson?.error || tokenRes.status);
      throw new BizException(BizCode.BAD_REQUEST, 'auth.googleExchangeFailed');
    }

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const info = (await infoRes.json().catch(() => ({}))) as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
      picture?: string;
    };
    if (!infoRes.ok || !info.sub) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.googleExchangeFailed');
    }
    const emailVerified = info.email_verified === true || info.email_verified === 'true';
    return {
      googleId: String(info.sub),
      email: this.normalizeEmail(info.email || '') ,
      emailVerified,
      name: String(info.name || '').trim() || null,
      picture: String(info.picture || '').trim() || null,
    };
  }

  private async upsertUserFromGoogle(profile: {
    googleId: string;
    email: string | null;
    emailVerified: boolean;
    name: string | null;
    picture: string | null;
  }) {
    const byGoogle = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });
    if (byGoogle) {
      const patch: { nickname?: string; avatarUrl?: string; email?: string } = {};
      if (!byGoogle.nickname && profile.name) patch.nickname = profile.name;
      if (!byGoogle.avatarUrl && profile.picture) patch.avatarUrl = profile.picture;
      if (!byGoogle.email && profile.email && profile.emailVerified) patch.email = profile.email;
      if (Object.keys(patch).length) {
        return this.prisma.user.update({ where: { id: byGoogle.id }, data: patch });
      }
      return byGoogle;
    }

    if (profile.email && profile.emailVerified) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        if (byEmail.googleId && byEmail.googleId !== profile.googleId) {
          throw new BizException(BizCode.CONFLICT, 'auth.emailAlreadyRegistered');
        }
        return this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: profile.googleId,
            nickname: byEmail.nickname || profile.name || undefined,
            avatarUrl: byEmail.avatarUrl || profile.picture || undefined,
          },
        });
      }
    } else if (!profile.email) {
      // No email from Google — still allow create by googleId only
    } else if (!profile.emailVerified) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.googleEmailUnverified');
    }

    const nickname =
      profile.name ||
      (profile.email ? profile.email.split('@')[0] : null) ||
      `user_${profile.googleId.slice(0, 8)}`;
    const user = await this.prisma.user.create({
      data: {
        googleId: profile.googleId,
        email: profile.emailVerified ? profile.email : null,
        nickname,
        avatarUrl: profile.picture,
      },
    });
    await this.prisma.wallet.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
    return user;
  }

  /**
   * 公测预留：手机发码。内测默认关闭（AUTH_PHONE_OTP_ENABLED=false）。
   * SMS 网关未接时仍生成 OTP（devCode），便于联调。
   */
  async sendPhoneOtp(phone: string, purpose: OtpPurpose = 'login') {
    if (!this.phoneOtpEnabled) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.phoneOtpDisabled');
    }
    if (!/^\+?[0-9]{9,15}$/.test(phone)) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.invalidPhone');
    }
    const r = this.otp.generate('phone', phone, purpose);
    // TODO(公测): 接入 SMS_PROVIDER 真实发信
    const isDev = process.env.NODE_ENV !== 'production';
    return {
      expiresInSec: r.expiresInSec,
      mailed: false,
      smsConfigured: this.smsConfigured,
      purpose,
      ...(isDev ? { devCode: r.code } : {}),
    };
  }

  async verifyPhoneOtp(
    phone: string,
    code: string,
    purpose: OtpPurpose = 'login',
    meta?: ClientMeta | null,
  ): Promise<LoginResult> {
    if (!this.phoneOtpEnabled) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.phoneOtpDisabled');
    }
    if (!this.otp.verify('phone', phone, code, purpose)) {
      throw new BizException(BizCode.INVALID_OTP, 'auth.invalidOtp');
    }
    const user = await this.upsertUserByPhone(phone);
    return this.issueSession(user, meta);
  }

  /** @deprecated 请用 sendPhoneOtp；保留兼容旧调用 */
  sendOtp(phone: string) {
    if (!/^\+?[0-9]{9,15}$/.test(phone)) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.invalidPhone');
    }
    return this.otp.generate('phone', phone, 'login');
  }

  /** @deprecated 请用 verifyPhoneOtp */
  async verifyOtp(phone: string, code: string): Promise<LoginResult> {
    return this.verifyPhoneOtp(phone, code, 'login');
  }

  async sendEmailOtp(email: string, purpose: OtpPurpose = 'login') {
    const normalized = this.normalizeEmail(email);
    if (!normalized) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.invalidEmail');
    }

    // 登录/注册激活：需打开 AUTH_EMAIL_OTP_ENABLED；reset（找回）始终允许
    if ((purpose === 'login' || purpose === 'register') && !this.emailOtpEnabled) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.emailOtpDisabled');
    }

    if (purpose === 'register') {
      const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
      if (existing?.passwordHash) {
        throw new BizException(BizCode.CONFLICT, 'auth.emailAlreadyRegistered');
      }
    }

    if (purpose === 'reset') {
      const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
      if (!existing) {
        throw new BizException(BizCode.NOT_FOUND, 'auth.emailNotRegistered');
      }
    }

    const r = this.otp.generate('email', normalized, purpose);
    const expiresMinutes = Math.max(1, Math.round(r.expiresInSec / 60));

    if (this.mailer.isConfigured()) {
      try {
        if (purpose === 'register') {
          await this.mailer.sendRegisterOtp(normalized, r.code, expiresMinutes);
        } else if (purpose === 'reset') {
          await this.mailer.sendResetOtp(normalized, r.code, expiresMinutes);
        } else {
          await this.mailer.sendLoginOtp(normalized, r.code, expiresMinutes);
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(`[email OTP/${purpose}] send failed:`, e?.message || e);
      }
    }

    const isDev = process.env.NODE_ENV !== 'production';
    return {
      expiresInSec: r.expiresInSec,
      mailed: this.mailer.isConfigured(),
      purpose,
      ...(isDev ? { devCode: r.code } : {}),
    };
  }

  async verifyEmailOtp(
    email: string,
    code: string,
    meta?: ClientMeta | null,
  ): Promise<LoginResult> {
    if (!this.emailOtpEnabled) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.emailOtpDisabledShort');
    }
    const normalized = this.normalizeEmail(email);
    if (!normalized) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.invalidEmail');
    }
    if (!this.otp.verify('email', normalized, code, 'login')) {
      throw new BizException(BizCode.INVALID_OTP, 'auth.invalidOtp');
    }
    const user = await this.upsertUserByEmail(normalized);
    return this.issueSession(user, meta);
  }

  /**
   * 内测注册：邮箱 + 账号 + 密码（无需验证码）。
   * 公测：打开 AUTH_EMAIL_OTP_ENABLED 后必须传 code。
   */
  async registerEmail(
    opts: {
      email: string;
      password: string;
      username: string;
      code?: string;
      nickname?: string;
    },
    meta?: ClientMeta | null,
  ): Promise<LoginResult> {
    const normalized = this.normalizeEmail(opts.email);
    if (!normalized) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.invalidEmail');
    }
    const username = this.normalizeUsername(opts.username);
    if (!username) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.usernameRules');
    }
    const password = String(opts.password || '');
    if (password.length < MIN_PASSWORD_LEN) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.passwordMinLength', undefined, {
        min: MIN_PASSWORD_LEN,
      });
    }

    const code = String(opts.code || '').trim();
    if (this.emailOtpEnabled) {
      if (!code || !this.otp.verify('email', normalized, code, 'register')) {
        throw new BizException(BizCode.INVALID_OTP, 'auth.invalidOtp');
      }
    } else if (code && !this.otp.verify('email', normalized, code, 'register')) {
      throw new BizException(BizCode.INVALID_OTP, 'auth.invalidOtp');
    }

    const [byEmail, byUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: normalized } }),
      this.prisma.user.findUnique({ where: { username } }),
    ]);
    if (byEmail?.passwordHash) {
      throw new BizException(BizCode.CONFLICT, 'auth.emailAlreadyRegistered');
    }
    if (byUsername && byUsername.id !== byEmail?.id) {
      throw new BizException(BizCode.CONFLICT, 'auth.usernameTaken');
    }

    const nickname =
      String(opts.nickname || '').trim() || username || normalized.split('@')[0] || 'user';
    const passwordHash = this.hashPassword(password);

    let user;
    if (byEmail) {
      user = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          passwordHash,
          username: byEmail.username || username,
          nickname: byEmail.nickname || nickname,
        },
      });
    } else {
      user = await this.prisma.user.create({
        data: {
          email: normalized,
          username,
          nickname,
          passwordHash,
        },
      });
      await this.prisma.wallet.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
      });
    }

    return this.issueSession(user, meta);
  }

  /** 账号或邮箱 + 密码登录 */
  async loginWithPassword(
    account: string,
    password: string,
    meta?: ClientMeta | null,
  ): Promise<LoginResult> {
    const raw = String(account || '').trim();
    if (!raw || !password) {
      throw new BizException(BizCode.UNAUTHORIZED, 'auth.invalidCredentials');
    }

    const email = this.normalizeEmail(raw);
    const user = email
      ? await this.prisma.user.findUnique({ where: { email } })
      : await this.prisma.user.findUnique({
          where: { username: raw.toLowerCase() },
        });

    if (!user || !user.passwordHash) {
      throw new BizException(BizCode.UNAUTHORIZED, 'auth.invalidCredentials');
    }
    if (!this.verifyPassword(password, user.passwordHash)) {
      throw new BizException(BizCode.UNAUTHORIZED, 'auth.invalidCredentials');
    }
    return this.issueSession(user, meta);
  }

  /** 发送找回密码验证码 */
  async forgotPassword(email: string) {
    return this.sendEmailOtp(email, 'reset');
  }

  /** 验证码 + 新密码重置 */
  async resetPassword(
    opts: {
      email: string;
      code: string;
      password: string;
    },
    meta?: ClientMeta | null,
  ): Promise<LoginResult> {
    const normalized = this.normalizeEmail(opts.email);
    if (!normalized) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.invalidEmail');
    }
    const password = String(opts.password || '');
    if (password.length < MIN_PASSWORD_LEN) {
      throw new BizException(BizCode.BAD_REQUEST, 'auth.newPasswordMinLength', undefined, {
        min: MIN_PASSWORD_LEN,
      });
    }
    if (!this.otp.verify('email', normalized, opts.code, 'reset')) {
      throw new BizException(BizCode.INVALID_OTP, 'auth.invalidOtp');
    }

    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      throw new BizException(BizCode.NOT_FOUND, 'auth.emailNotRegistered');
    }

    const passwordHash = this.hashPassword(password);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // 重置后踢掉旧会话
    await this.prisma.session.deleteMany({ where: { userId: user.id } });
    return this.issueSession(updated, meta);
  }

  async getSession(userId: bigint) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { creator: true },
    });
    if (!user) throw new BizException(BizCode.UNAUTHORIZED, 'auth.sessionInvalid');
    return this.toProfile(user);
  }

  async signOut(userId: bigint, sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId, userId } });
    return { success: true };
  }

  getCookieName() {
    return this.cookieName;
  }
  getAdminToken() {
    return this.adminToken;
  }

  private normalizeEmail(email: string): string | null {
    const e = String(email || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
    return e;
  }

  private normalizeUsername(raw: string): string | null {
    const u = String(raw || '')
      .trim()
      .toLowerCase();
    if (!USERNAME_RE.test(u)) return null;
    return u;
  }

  private envFlag(config: ConfigService, key: string, fallback: boolean): boolean {
    const v = config.get<string | boolean | number>(key);
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }

  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    try {
      const computed = crypto.scryptSync(password, salt, 64);
      const expected = Buffer.from(hash, 'hex');
      if (computed.length !== expected.length) return false;
      return crypto.timingSafeEqual(computed, expected);
    } catch {
      return false;
    }
  }

  private async upsertUserByPhone(phone: string) {
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) return existing;
    return this.prisma.user.create({ data: { phone } });
  }

  private async upsertUserByEmail(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;
    const user = await this.prisma.user.create({
      data: { email, nickname: email.split('@')[0] },
    });
    await this.prisma.wallet.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
    return user;
  }

  private async issueSession(
    user: {
      id: bigint;
      phone: string | null;
      email?: string | null;
      locale: string;
    },
    meta?: ClientMeta | null,
  ): Promise<LoginResult> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const geo = meta ? await enrichClientMeta(meta) : null;
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        expiresAt,
        ipAddress: geo?.ipAddress ?? null,
        country: geo?.country ?? null,
        city: geo?.city ?? null,
        userAgent: geo?.userAgent ?? null,
      },
    });
    const token = this.session.sign({
      userId: user.id.toString(),
      phone: user.phone ?? undefined,
      locale: user.locale,
      sessionId,
    });
    const full = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { creator: true },
    });
    return {
      token,
      user: this.toProfile(full!),
    };
  }

  private toProfile(user: any) {
    const vipExpireAt = user.vipExpireAt ? new Date(user.vipExpireAt) : null;
    const isVip = !!(vipExpireAt && vipExpireAt.getTime() > Date.now());
    return {
      id: user.id.toString(),
      phone: user.phone,
      email: user.email ?? null,
      username: user.username ?? null,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl ?? null,
      locale: user.locale,
      isCreator: !!user.creator,
      hasPassword: !!user.passwordHash,
      vipExpireAt: vipExpireAt?.toISOString() ?? null,
      isVip,
    };
  }
}
