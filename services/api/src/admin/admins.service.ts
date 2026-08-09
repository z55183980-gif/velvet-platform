import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

const MIN_PASSWORD_LEN = 8;

@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.adminUser.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        status: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      id: row.id.toString(),
    }));
  }

  async create(
    dto: {
      email: string;
      password: string;
      username?: string;
      displayName?: string;
      role?: 'SUPER_ADMIN' | 'OPS';
    },
    actorId?: bigint,
  ) {
    const email = this.normalizeEmail(dto.email);
    if (!email) throw new BizException(BizCode.BAD_REQUEST, 'email.invalid');

    const password = String(dto.password || '');
    if (password.length < MIN_PASSWORD_LEN) {
      throw new BizException(BizCode.BAD_REQUEST, 'admin.passwordMinLength', undefined, {
        min: MIN_PASSWORD_LEN,
      });
    }

    const role: 'SUPER_ADMIN' | 'OPS' = dto.role === 'OPS' ? 'OPS' : 'SUPER_ADMIN';
    let username = String(dto.username || email.split('@')[0] || 'admin')
      .trim()
      .toLowerCase();
    if (!username || !/^[a-z0-9_]{3,32}$/.test(username)) {
      throw new BizException(BizCode.BAD_REQUEST, 'username.invalid');
    }

    const displayName =
      String(dto.displayName || '').trim() || username;

    const emailTaken = await this.prisma.adminUser.findUnique({ where: { email } });
    if (emailTaken) {
      throw new BizException(BizCode.CONFLICT, 'admin.emailTaken');
    }
    const usernameTaken = await this.prisma.adminUser.findUnique({ where: { username } });
    if (usernameTaken) {
      throw new BizException(BizCode.CONFLICT, 'admin.usernameTaken');
    }

    const admin = await this.prisma.adminUser.create({
      data: {
        email,
        username,
        passwordHash: this.hashPassword(password),
        displayName,
        status: 'ACTIVE',
        role,
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        status: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    await this.audit.write({
      actorId,
      action: 'admin.create',
      targetType: 'admin',
      targetId: admin.id.toString(),
      payload: { email: admin.email, username: admin.username, role: admin.role },
    });

    return { ...admin, id: admin.id.toString() };
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

  async setRole(adminId: string, role: 'SUPER_ADMIN' | 'OPS', actorId?: bigint) {
    if (role !== 'SUPER_ADMIN' && role !== 'OPS') {
      throw new BizException(BizCode.BAD_REQUEST, 'role 不合法');
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { id: BigInt(adminId) } });
    if (!admin) throw new BizException(BizCode.NOT_FOUND, 'admin.notFound');
    if (admin.role === role) {
      return { id: admin.id.toString(), role: admin.role };
    }
    const updated = await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { role },
    });
    await this.audit.write({
      actorId,
      action: 'admin.role.update',
      targetType: 'admin',
      targetId: adminId,
      payload: { from: admin.role, to: role },
    });
    return { id: updated.id.toString(), role: updated.role };
  }

  async setStatus(adminId: string, status: 'ACTIVE' | 'DISABLED', actorId?: bigint) {
    const data: { status: string; tokenVersion?: { increment: number } } = { status };
    if (status === 'DISABLED') {
      data.tokenVersion = { increment: 1 };
    }
    const updated = await this.prisma.adminUser.update({
      where: { id: BigInt(adminId) },
      data,
    });
    await this.audit.write({
      actorId,
      action: 'admin.status.update',
      targetType: 'admin',
      targetId: adminId,
      payload: { status },
    });
    return { id: updated.id.toString(), status: updated.status };
  }
}
