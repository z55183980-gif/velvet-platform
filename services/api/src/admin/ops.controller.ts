import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ok } from '../common/response';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminGuard } from './admin.guard';
import { AdminOpsService } from './ops.service';

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class OpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('ops/summary')
  @AdminRoles('SUPER_ADMIN')
  async opsSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return ok(await this.ops.summary(from, to));
  }

  @Get('ops/drama-sales')
  @AdminRoles('SUPER_ADMIN')
  async opsDramaSales(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return ok(await this.ops.dramaSales(from, to, limit ? Number(limit) : 50));
  }
}
