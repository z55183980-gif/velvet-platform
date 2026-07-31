import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ok } from '../common/response';
import { AuditService } from '../common/audit.service';
import { AdminGuard } from './admin.guard';

@Controller('v1/admin/audit-logs')
@UseGuards(AdminGuard)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('actorId') actorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return ok(
      await this.audit.list({
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 30,
        action,
        targetType,
        actorId: actorId ? BigInt(actorId) : undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      }),
    );
  }
}