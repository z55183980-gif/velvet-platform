import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ok } from '../common/response';
import { AdminGuard } from './admin.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { DashboardService } from './dashboard.service';

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/overview')
  async dashboardOverview(@Query('range') range?: string) {
    return ok(await this.dashboard.overview(range));
  }

  @Get('stats/overview')
  async stats(@Query('range') range?: string) {
    return ok(await this.dashboard.overview(range));
  }
}
