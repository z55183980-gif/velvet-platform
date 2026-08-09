import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ok } from '../common/response';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminGuard } from './admin.guard';
import { AdminUsersService } from './users.service';

function getActor(req: any): bigint | undefined {
  return req?.adminId as bigint | undefined;
}

class UserStatusDto {
  @IsNotEmpty() @IsString() status!: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  @IsNotEmpty() @IsString() reason!: string;
}

class SetUserVipDto {
  @IsOptional() vipExpireAt?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) extendDays?: number;
}

class ResetUserPasswordDto {
  @IsNotEmpty() @IsString() @MinLength(6) password!: string;
}

class CreateUserDto {
  @IsNotEmpty() @IsString() email!: string;
  @IsNotEmpty() @IsString() @MinLength(6) password!: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() nickname?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() locale?: string;
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class UsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users/statistics/overview')
  async userStatisticsOverview(
    @Query('range') range?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return ok(await this.users.statisticsOverview({ range, startDate, endDate }));
  }

  @Get('users')
  async listUsers(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('locale') locale?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.users.list({
      q,
      status: (status as any) || 'ALL',
      locale: locale as any,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
  }

  @Post('users')
  @AdminRoles('SUPER_ADMIN')
  async createUser(@Body() dto: CreateUserDto, @Req() req: any) {
    return ok(await this.users.create(dto, getActor(req)));
  }

  @Get('users/:id')
  async userDetail(@Param('id') id: string) {
    return ok(await this.users.detail(id));
  }

  @Post('users/:id/status')
  @AdminRoles('SUPER_ADMIN')
  async setUserStatus(
    @Param('id') id: string,
    @Body() dto: UserStatusDto,
    @Req() req: any,
  ) {
    return ok(await this.users.setStatus(id, dto.status, dto.reason, getActor(req)));
  }

  @Post('users/:id/force-logout')
  @AdminRoles('SUPER_ADMIN')
  async forceLogout(@Param('id') id: string, @Req() req: any) {
    return ok(await this.users.forceLogout(id, getActor(req)));
  }

  @Post('users/:id/password')
  @AdminRoles('SUPER_ADMIN')
  async resetUserPassword(
    @Param('id') id: string,
    @Body() dto: ResetUserPasswordDto,
    @Req() req: any,
  ) {
    return ok(await this.users.resetPassword(id, dto.password, getActor(req)));
  }

  @Post('users/:id/vip')
  @AdminRoles('SUPER_ADMIN')
  async setUserVip(@Param('id') id: string, @Body() dto: SetUserVipDto, @Req() req: any) {
    return ok(await this.users.setVip(id, dto, getActor(req)));
  }

  @Post('users/:id/delete')
  @AdminRoles('SUPER_ADMIN')
  async deleteUser(@Param('id') id: string, @Req() req: any) {
    return ok(await this.users.deleteUser(id, getActor(req)));
  }
}
