import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ok } from '../common/response';
import { AdminGuard } from './admin.guard';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { OpsMonitorService } from './ops-monitor.service';

@Controller('v1/admin/ops-monitor')
@UseGuards(AdminGuard, AdminRoleGuard)
@AdminRoles('SUPER_ADMIN', 'OPS')
export class OpsMonitorController {
  constructor(private readonly ops: OpsMonitorService) {}

  @Get()
  async overview(@Query('hours') hours?: string) {
    const rangeHours = Math.min(168, Math.max(1, Number(hours) || 24));
    return ok(await this.ops.overview({ rangeHours }));
  }
}
