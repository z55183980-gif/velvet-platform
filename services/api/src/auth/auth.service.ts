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

@Injectable()
export class AuthService {
  private readonly cookieName = 'dv_session';
  private readonly adminToken: string;
  /** 公测开关：邮箱 OTP 登录/注册激活（找回密码不受此限制） */
  private readonly emailOtpEnabled: boolean;
  /** 公测开关：手机 OTP 登录 */
  private readonly phoneOtpEnabled: boolean;
  private readonly smsConfigured: boolean;

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
    };
  }

  /**
   * 公测预留：手机发码。内测默认关闭（AUTH_PHONE_OTP_ENABLED=false）。
   * SMS 网关未接时仍生成 OTP（devCode），便于联调。
   */
  async sendPhoneOtp(phone: string, purpose: OtpPurpose = 'login') {
    if (!this.phoneOtpEnabled) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Đăng nhập SĐT OTP chưa mở (cấu hình AUTH_PHONE_OTP_ENABLED)',
      );
    }
    if (!/^\+?[0-9]{9,15}$/.test(phone)) {
      throw new BizException(BizCode.BAD_REQUEST, 'Số điện thoại không hợp lệ');
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
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Đăng nhập SĐT OTP chưa mở (cấu hình AUTH_PHONE_OTP_ENABLED)',
      );
    }
    if (!this.otp.verify('phone', phone, code, purpose)) {
      throw new BizException(BizCode.INVALID_OTP, 'Mã OTP không đúng hoặc đã hết hạn');
    }
    const user = await this.upsertUserByPhone(phone);
    return this.issueSession(user, meta);
  }

  /** @deprecated 请用 sendPhoneOtp；保留兼容旧调用 */
  sendOtp(phone: string) {
    if (!/^\+?[0-9]{9,15}$/.test(phone)) {
      throw new BizException(BizCode.BAD_REQUEST, 'Số điện thoại không hợp lệ');
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
      throw new BizException(BizCode.BAD_REQUEST, 'Email không hợp lệ');
    }

    // 登录/注册激活：需打开 AUTH_EMAIL_OTP_ENABLED；reset（找回）始终允许
    if ((purpose === 'login' || purpose === 'register') && !this.emailOtpEnabled) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Email OTP chưa mở (nội bộ dùng mật khẩu; bật AUTH_EMAIL_OTP_ENABLED khi công khai)',
      );
    }

    if (purpose === 'register') {
      const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
      if (existing?.passwordHash) {
        throw new BizException(BizCode.CONFLICT, 'Email đã được đăng ký, vui lòng đăng nhập');
      }
    }

    if (purpose === 'reset') {
      const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
      if (!existing) {
        throw new BizException(BizCode.NOT_FOUND, 'Email chưa đăng ký');
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
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Email OTP chưa mở (nội bộ dùng mật khẩu)',
      );
    }
    const normalized = this.normalizeEmail(email);
    if (!normalized) {
      throw new BizException(BizCode.BAD_REQUEST, 'Email không hợp lệ');
    }
    if (!this.otp.verify('email', normalized, code, 'login')) {
      throw new BizException(BizCode.INVALID_OTP, 'Mã OTP không đúng hoặc đã hết hạn');
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
      throw new BizException(BizCode.BAD_REQUEST, 'Email không hợp lệ');
    }
    const username = this.normalizeUsername(opts.username);
    if (!username) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'Tài khoản 3–24 ký tự (chữ/số/_)',
      );
    }
    const password = String(opts.password || '');
    if (password.length < MIN_PASSWORD_LEN) {
      throw new BizException(BizCode.BAD_REQUEST, `Mật khẩu ít nhất ${MIN_PASSWORD_LEN} ký tự`);
    }

    const code = String(opts.code || '').trim();
    if (this.emailOtpEnabled) {
      if (!code || !this.otp.verify('email', normalized, code, 'register')) {
        throw new BizException(BizCode.INVALID_OTP, 'Mã OTP không đúng hoặc đã hết hạn');
      }
    } else if (code && !this.otp.verify('email', normalized, code, 'register')) {
      throw new BizException(BizCode.INVALID_OTP, 'Mã OTP không đúng hoặc đã hết hạn');
    }

    const [byEmail, byUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: normalized } }),
      this.prisma.user.findUnique({ where: { username } }),
    ]);
    if (byEmail?.passwordHash) {
      throw new BizException(BizCode.CONFLICT, 'Email đã được đăng ký, vui lòng đăng nhập');
    }
    if (byUsername && byUsername.id !== byEmail?.id) {
      throw new BizException(BizCode.CONFLICT, 'Tài khoản đã được sử dụng');
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
      throw new BizException(BizCode.UNAUTHORIZED, 'Tài khoản hoặc mật khẩu không đúng');
    }

    const email = this.normalizeEmail(raw);
    const user = email
      ? await this.prisma.user.findUnique({ where: { email } })
      : await this.prisma.user.findUnique({
          where: { username: raw.toLowerCase() },
        });

    if (!user || !user.passwordHash) {
      throw new BizException(BizCode.UNAUTHORIZED, 'Tài khoản hoặc mật khẩu không đúng');
    }
    if (!this.verifyPassword(password, user.passwordHash)) {
      throw new BizException(BizCode.UNAUTHORIZED, 'Tài khoản hoặc mật khẩu không đúng');
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
      throw new BizException(BizCode.BAD_REQUEST, 'Email không hợp lệ');
    }
    const password = String(opts.password || '');
    if (password.length < MIN_PASSWORD_LEN) {
      throw new BizException(BizCode.BAD_REQUEST, `Mật khẩu mới ít nhất ${MIN_PASSWORD_LEN} ký tự`);
    }
    if (!this.otp.verify('email', normalized, opts.code, 'reset')) {
      throw new BizException(BizCode.INVALID_OTP, 'Mã OTP không đúng hoặc đã hết hạn');
    }

    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      throw new BizException(BizCode.NOT_FOUND, 'Email chưa đăng ký');
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
    if (!user) throw new BizException(BizCode.UNAUTHORIZED, 'Phiên đăng nhập không hợp lệ');
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
