import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ok } from '../common/response';
import { BizCode, BizException } from '../common/biz.exception';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AdminGuard } from './admin.guard';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';

class BroadcastDto {
  @IsNotEmpty() @IsString() titleVi!: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsNotEmpty() @IsString() bodyVi!: string;
  @IsOptional() @IsString() bodyZh?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsBoolean() broadcast?: boolean;
}

function getActor(req: any): bigint | undefined {
  const id = req?.admin?.sub ?? req?.admin?.id;
  return id != null ? BigInt(id) : undefined;
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class AdminNotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('notifications/broadcast')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async broadcast(@Body() dto: BroadcastDto, @Req() req: any) {
    const titleVi = dto.titleVi?.trim();
    const bodyVi = dto.bodyVi?.trim();
    if (!titleVi || !bodyVi) {
      throw new BizException(BizCode.BAD_REQUEST, '标题与正文不能为空');
    }

    let userIds: bigint[] = [];
    if (dto.broadcast) {
      const users = await this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
        take: 5000,
      });
      userIds = users.map((u) => u.id);
    } else if (dto.userId) {
      if (!/^\d+$/.test(dto.userId)) {
        throw new BizException(BizCode.BAD_REQUEST, 'userId 无效');
      }
      const user = await this.prisma.user.findUnique({ where: { id: BigInt(dto.userId) } });
      if (!user) throw new BizException(BizCode.NOT_FOUND, '用户不存在');
      userIds = [user.id];
    } else {
      throw new BizException(BizCode.BAD_REQUEST, '请指定 userId 或开启 broadcast');
    }

    if (!userIds.length) {
      return ok({ created: 0 });
    }

    const data = userIds.map((userId) => ({
      userId,
      type: 'ops.broadcast',
      titleVi,
      titleZh: dto.titleZh?.trim() || null,
      bodyVi,
      bodyZh: dto.bodyZh?.trim() || null,
    }));

    const result = await this.prisma.notification.createMany({ data });
    await this.audit.write({
      actorId: getActor(req),
      action: 'notification.broadcast',
      targetType: 'notification',
      payload: {
        created: result.count,
        broadcast: !!dto.broadcast,
        userId: dto.userId || null,
      },
    });
    return ok({ created: result.count });
  }
}
