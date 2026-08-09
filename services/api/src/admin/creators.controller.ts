import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { ok } from '../common/response';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminCreatorsService } from './creators.service';
import { KycService } from './kyc.service';

function getActor(req: any): bigint | undefined {
  return req?.adminId as bigint | undefined;
}

class RejectKycDto {
  @IsNotEmpty() @IsString() reason!: string;
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class CreatorsController {
  constructor(
    private readonly admin: AdminService,
    private readonly kyc: KycService,
    private readonly creators: AdminCreatorsService,
  ) {}

  @Get('kyc/list')
  async kycList(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.kyc.list({
      status: (status as any) || 'ALL',
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
  }

  @Get('creators/pending')
  async pendingCreators() {
    return ok(await this.admin.pendingCreators());
  }

  @Post('creators/:id/kyc/approve')
  async approveKyc(@Param('id') id: string, @Req() req: any) {
    return ok(await this.admin.approveKyc(id, getActor(req)));
  }

  @Post('creators/:id/kyc/reject')
  async rejectKyc(@Param('id') id: string, @Body() dto: RejectKycDto, @Req() req: any) {
    return ok(await this.admin.rejectKyc(id, dto.reason, getActor(req)));
  }

  @Get('creators')
  async listCreators(
    @Query('q') q?: string,
    @Query('kyc') kyc?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.creators.list({
      q,
      kyc: (kyc as any) || 'ALL',
      sort: sort as any,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
  }

  @Get('creators/:id')
  async creatorDetail(@Param('id') id: string) {
    return ok(await this.creators.detail(id));
  }

  /** Close creator account → ban linked user (SUPER_ADMIN only, same as user status). */
  @Post('creators/:id/close')
  @AdminRoles('SUPER_ADMIN')
  async closeCreator(@Param('id') id: string, @Req() req: any) {
    return ok(await this.creators.closeAccount(id, getActor(req)));
  }
}
