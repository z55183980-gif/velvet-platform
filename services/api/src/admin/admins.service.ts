import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { AuditService } from '../common/audit.service';

@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.adminUser.findMany({
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
