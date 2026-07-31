import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ok } from '../common/response';

@Controller('v1/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前用户通知列表（未读优先 + 时间倒序） */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize || '20', 10) || 20));
    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.userId },
        orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.notification.count({ where: { userId: user.userId } }),
      this.prisma.notification.count({
        where: { userId: user.userId, readAt: null },
      }),
    ]);
    return ok({
      rows: rows.map((n) => ({
        id: n.id.toString(),
        type: n.type,
        titleVi: n.titleVi,
        titleZh: n.titleZh,
        bodyVi: n.bodyVi,
        bodyZh: n.bodyZh,
        payload: n.payload,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      total,
      unread,
      page: p,
      pageSize: ps,
    });
  }

  /** 标记单条已读 */
  @Post(':id/read')
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const notif = await this.prisma.notification.findUnique({
      where: { id: BigInt(id) },
    });
    if (!notif || notif.userId !== user.userId) {
      return ok({ ok: true });
    }
    if (!notif.readAt) {
      await this.prisma.notification.update({
        where: { id: notif.id },
        data: { readAt: new Date() },
      });
    }
    return ok({ ok: true });
  }

  /** 全部标记已读 */
  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ updated: result.count });
  }
}