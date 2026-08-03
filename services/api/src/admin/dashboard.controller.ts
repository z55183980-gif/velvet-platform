import { Controller, Get, UseGuards } from '@nestjs/common';
import { ok } from '../common/response';
import { AdminGuard } from './admin.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { DashboardService } from './dashboard.service';

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/overview')
  async dashboardOverview() {
    return ok(await this.dashboard.overview());
  }

  @Get('stats/overview')
  async stats() {
    return ok(await this.dashboard.overview());
  }
}
