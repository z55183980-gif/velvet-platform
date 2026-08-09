import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { ok } from '../common/response';
import { AdminGuard } from './admin.guard';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminFeedbackService } from './feedback.service';

class SetFeedbackStatusDto {
  @IsString()
  @IsIn(['NEW', 'REVIEWING', 'CLOSED'])
  status!: 'NEW' | 'REVIEWING' | 'CLOSED';
}

function getActor(req: any): bigint | undefined {
  const id = req?.admin?.sub ?? req?.admin?.id;
  return id != null ? BigInt(id) : undefined;
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class AdminFeedbackController {
  constructor(private readonly feedback: AdminFeedbackService) {}

  @Get('feedback')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async list(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.feedback.list({
        status: status?.trim().toUpperCase() || 'NEW',
        category: category?.trim().toLowerCase() || undefined,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Post('feedback/:id/status')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async setStatus(@Param('id') id: string, @Body() dto: SetFeedbackStatusDto, @Req() req: any) {
    return ok(await this.feedback.setStatus(id, dto.status, getActor(req)));
  }
}
