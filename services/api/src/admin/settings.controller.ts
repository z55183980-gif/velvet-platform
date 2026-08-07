import { Allow, ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { BizCode, BizException } from '../common/biz.exception';
import { ok } from '../common/response';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminGuard } from './admin.guard';
import { AdminsService } from './admins.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { SettingsService } from './settings.service';

function getActor(req: any): bigint | undefined {
  return req?.adminId as bigint | undefined;
}

class SettingUpdateDto {
  @IsNotEmpty() @IsString() key!: string;
  @Allow() value: any;
}

class AdminRoleDto {
  @IsNotEmpty() @IsString() role!: 'SUPER_ADMIN' | 'OPS';
}

class StripeGatewayUpdateDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) secret_key?: string;
  @IsOptional() @IsString() @MaxLength(500) webhook_signing_secret?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  enabled_events?: string[];
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly admins: AdminsService,
    private readonly paymentGateways: PaymentGatewayService,
  ) {}

  @Get('settings')
  async listSettings() {
    return ok(await this.settings.list());
  }

  @Post('settings')
  @AdminRoles('SUPER_ADMIN')
  async updateSetting(@Body() dto: SettingUpdateDto, @Req() req: any) {
    if (!dto?.key) {
      throw new BizException(BizCode.BAD_REQUEST, 'key is required');
    }
    return ok(await this.settings.update(String(dto.key), dto.value, getActor(req)));
  }

  @Get('admins')
  @AdminRoles('SUPER_ADMIN')
  async listAdmins() {
    return ok(await this.admins.list());
  }

  @Post('admins/:id/role')
  @AdminRoles('SUPER_ADMIN')
  async setAdminRole(@Param('id') id: string, @Body() dto: AdminRoleDto, @Req() req: any) {
    return ok(await this.admins.setRole(id, dto.role, getActor(req)));
  }

  @Post('admins/:id/status')
  @AdminRoles('SUPER_ADMIN')
  async setAdminStatus(
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
    @Req() req: any,
  ) {
    return ok(await this.admins.setStatus(id, body?.status, getActor(req)));
  }

  @Get('payment-gateways/stripe')
  async getStripePaymentGateway() {
    return ok(await this.paymentGateways.getStripeSettings());
  }

  @Put('payment-gateways/stripe')
  @AdminRoles('SUPER_ADMIN')
  async updateStripePaymentGateway(@Body() dto: StripeGatewayUpdateDto, @Req() req: any) {
    return ok(await this.paymentGateways.updateStripeSettings(dto, getActor(req)));
  }
}
