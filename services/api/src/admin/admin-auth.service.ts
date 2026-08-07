import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '../common/jwt.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

import { isProductionEnv, isWeakSecret } from '../common/security-config';

const MIN_PASSWORD_LEN = 8;
const MIN_BOOTSTRAP_PASSWORD_LEN = 12;

export interface AdminProfile {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: 'SUPER_ADMIN' | 'OPS';
}

export interface AdminLoginResult {
  token: string;
  admin: AdminProfile;
}

export interface AdminJwtPayload {
  typ: 'admin';
  adminId: string;
  email: string;
  username: string;
  /** Must match AdminUser.tokenVersion or token is revoked */
  tv: number;
}

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly cookieName = 'dv_admin_session';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureBootstrapAdmin();
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('[admin-auth] bootstrap skipped:', e?.message || e);
    }
  }

  getCookieName() {
    return this.cookieName;
  }

  /** 启动时：若配置了 bootstrap 邮箱且库中不存在，则创建 */
  async ensureBootstrapAdmin() {
    const emailRaw = this.config.get<string>('ADMIN_BOOTSTRAP_EMAIL');
    const passwordRaw = this.config.get<string>('ADMIN_BOOTSTRAP_PASSWORD');
    if (isProductionEnv()) {
      if (!emailRaw || !passwordRaw) return null;
      if (passwordRaw.length < MIN_BOOTSTRAP_PASSWORD_LEN || isWeakSecret(passwordRaw)) {
        throw new Error(
          '[admin-auth] ADMIN_BOOTSTRAP_PASSWORD must be strong (≥12 chars) in production',
        );
      }
    }
    const email = this.normalizeEmail(emailRaw || 'admin@velvet.local');
    const password = passwordRaw || (isProductionEnv() ? '' : 'admin');
    const username = (
      this.config.get<string>('ADMIN_BOOTSTRAP_USERNAME') || 'admin'
    )
      .trim()
      .toLowerCase();

    if (!email || password.length < MIN_PASSWORD_LEN) return null;

    const existing = await this.prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      // 本地开发：启动时把 bootstrap 密码同步到已有账号（方便改 .env 立即生效）
      if (!isProductionEnv()) {
        await this.prisma.adminUser.update({
          where: { id: existing.id },
          data: {
            passwordHash: this.hashPassword(password),
            username: existing.username || username,
            role: (existing as any).role || 'SUPER_ADMIN',
          },
        });
      }
      return this.toProfile(existing);
    }

    // username 冲突时追加后缀
    let uname = username || 'admin';
    const taken = await this.prisma.adminUser.findUnique({ where: { username: uname } });
    if (taken) uname = `${uname}_${Date.now().toString(36)}`;

    const admin = await this.prisma.adminUser.create({
      data: {
        email,
        username: uname,
        passwordHash: this.hashPassword(password),
        displayName: 'Admin',
        status: 'ACTIVE',
        role: 'SUPER_ADMIN',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[admin-auth] bootstrap admin created: ${email} / ${uname}`);
    return this.toProfile(admin);
  }

  /** 仅当库中无任何管理员时允许一次性创建 */
  async bootstrap(opts: {
    email: string;
    password: string;
    username?: string;
  }): Promise<AdminLoginResult> {
    if (isProductionEnv()) {
      throw new BizException(BizCode.FORBIDDEN, 'admin.bootstrapDisabledInProduction');
    }
    const count = await this.prisma.adminUser.count();
    if (count > 0) {
      throw new BizException(BizCode.FORBIDDEN, 'admin.bootstrapExists');
    }
    const email = this.normalizeEmail(opts.email);
    if (!email) throw new BizException(BizCode.BAD_REQUEST, 'email.invalid');
    const password = String(opts.password || '');
    if (password.length < MIN_PASSWORD_LEN) {
      throw new BizException(BizCode.BAD_REQUEST, 'admin.passwordMinLength', undefined, {
        min: MIN_PASSWORD_LEN,
      });
    }
    const username = String(opts.username || email.split('@')[0] || 'admin')
      .trim()
      .toLowerCase();
    if (!username) throw new BizException(BizCode.BAD_REQUEST, 'username.invalid');

    const admin = await this.prisma.adminUser.create({
      data: {
        email,
        username,
        passwordHash: this.hashPassword(password),
        displayName: username,
        status: 'ACTIVE',
      },
    });
    return this.issueToken(admin);
  }

  async login(account: string, password: string): Promise<AdminLoginResult> {
    const raw = String(account || '').trim();
    if (!raw || !password) {
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.badCredentials');
    }

    const email = this.normalizeEmail(raw);
    const admin = email
      ? await this.prisma.adminUser.findUnique({ where: { email } })
      : await this.prisma.adminUser.findUnique({
          where: { username: raw.toLowerCase() },
        });

    if (!admin || admin.status !== 'ACTIVE' || !admin.passwordHash) {
      await this.audit.write({
        action: 'admin.login',
        targetType: 'admin',
        targetId: admin?.id?.toString() ?? raw,
        result: 'fail',
        message: '账号不存在 / 已停用',
      });
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.badCredentials');
    }
    if (!this.verifyPassword(password, admin.passwordHash)) {
      await this.audit.write({
        actorId: admin.id,
        action: 'admin.login',
        targetType: 'admin',
        targetId: admin.id.toString(),
        result: 'fail',
        message: '密码错误',
      });
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.badCredentials');
    }
    await this.audit.write({
      actorId: admin.id,
      action: 'admin.login',
      targetType: 'admin',
      targetId: admin.id.toString(),
      result: 'ok',
    });
    return this.issueToken(admin);
  }

  async me(adminId: bigint): Promise<AdminProfile> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin || admin.status !== 'ACTIVE') {
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.sessionInvalid');
    }
    return this.toProfile(admin);
  }

  async updateProfile(
    adminId: bigint,
    opts: { email?: string; username?: string; displayName?: string },
  ): Promise<AdminProfile> {
    const admin = await this.requireActive(adminId);
    const data: { email?: string; username?: string; displayName?: string | null } = {};

    if (opts.email !== undefined) {
      const email = this.normalizeEmail(opts.email);
      if (!email) throw new BizException(BizCode.BAD_REQUEST, 'email.invalid');
      if (email !== admin.email) {
        const clash = await this.prisma.adminUser.findUnique({ where: { email } });
        if (clash) throw new BizException(BizCode.CONFLICT, 'admin.emailTaken');
        data.email = email;
      }
    }

    if (opts.username !== undefined) {
      const username = String(opts.username || '')
        .trim()
        .toLowerCase();
      if (!username || username.length < 2) {
        throw new BizException(BizCode.BAD_REQUEST, 'username.invalid');
      }
      if (username !== admin.username) {
        const clash = await this.prisma.adminUser.findUnique({ where: { username } });
        if (clash) throw new BizException(BizCode.CONFLICT, 'admin.usernameTaken');
        data.username = username;
      }
    }

    if (opts.displayName !== undefined) {
      data.displayName = String(opts.displayName || '').trim() || null;
    }

    const updated = await this.prisma.adminUser.update({
      where: { id: adminId },
      data,
    });
    return this.toProfile(updated);
  }

  async changePassword(
    adminId: bigint,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    const admin = await this.requireActive(adminId);
    if (!this.verifyPassword(oldPassword, admin.passwordHash)) {
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.oldPasswordWrong');
    }
    if (String(newPassword || '').length < MIN_PASSWORD_LEN) {
      throw new BizException(BizCode.BAD_REQUEST, 'admin.newPasswordMinLength', undefined, {
        min: MIN_PASSWORD_LEN,
      });
    }
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: {
        passwordHash: this.hashPassword(newPassword),
        tokenVersion: { increment: 1 },
      },
    });
    return { success: true };
  }

  /** Invalidate all JWTs for this admin (logout / disable). */
  async revokeAllTokens(adminId: bigint): Promise<{ success: true }> {
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { success: true };
  }

  verifyAdminToken(token: string): AdminJwtPayload | null {
    const payload = this.jwt.verify<AdminJwtPayload & { typ?: string }>(token);
    if (!payload || payload.typ !== 'admin' || !payload.adminId) return null;
    if (typeof payload.tv !== 'number') return null;
    return payload as AdminJwtPayload;
  }

  private async requireActive(adminId: bigint) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin || admin.status !== 'ACTIVE') {
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.sessionInvalid');
    }
    return admin;
  }

  private issueToken(admin: {
    id: bigint;
    email: string;
    username: string;
    displayName: string | null;
    role?: string | null;
    tokenVersion?: number;
  }): AdminLoginResult {
    const payload: AdminJwtPayload & { role?: string } = {
      typ: 'admin',
      adminId: admin.id.toString(),
      email: admin.email,
      username: admin.username,
      tv: admin.tokenVersion ?? 0,
      role: admin.role || 'SUPER_ADMIN',
    };
    return {
      token: this.jwt.sign(payload as any),
      admin: this.toProfile(admin),
    };
  }

  private toProfile(admin: {
    id: bigint;
    email: string;
    username: string;
    displayName: string | null;
    role?: string | null;
  }): AdminProfile {
    const role: 'SUPER_ADMIN' | 'OPS' =
      admin.role === 'OPS' ? 'OPS' : 'SUPER_ADMIN';
    return {
      id: admin.id.toString(),
      email: admin.email,
      username: admin.username,
      displayName: admin.displayName,
      role,
    };
  }

  private normalizeEmail(email: string): string | null {
    const e = String(email || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
    return e;
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
}
