import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ok } from '../common/response';
import { PackagesService } from '../packages/packages.service';
import { RedeemService } from '../redeem/redeem.service';
import { VipPlansService } from '../vip/vip-plans.service';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminWalletService } from './wallet.service';
import { AdminWithdrawsService } from './withdraws.service';

function getActor(req: any): bigint | undefined {
  return req?.adminId as bigint | undefined;
}

class ReasonDto {
  @IsOptional() @IsString() reason?: string;
}

class UpsertVipPlanDto {
  @IsNotEmpty() @IsString() nameEn!: string;
  @IsOptional() @IsString() nameZh?: string;
  @IsOptional() @IsString() nameFr?: string;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(1) durationDays!: number;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(0.01) basePrice!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) originalPrice?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional() @IsString() badge?: string;
  @IsNotEmpty() @IsString() descEn!: string;
  @IsOptional() @IsString() descZh?: string;
  @IsOptional() @IsString() descFr?: string;
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      return value
        .split(/\n|,/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    return value;
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  benefits!: string[];
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class PatchVipPlanDto {
  @IsOptional() @IsString() nameEn?: string;
  @IsOptional() @IsString() nameZh?: string;
  @IsOptional() @IsString() nameFr?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) durationDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) basePrice?: number;
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined ? null : value))
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  originalPrice?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional() @IsString() badge?: string;
  @IsOptional() @IsString() descEn?: string;
  @IsOptional() @IsString() descZh?: string;
  @IsOptional() @IsString() descFr?: string;
  @IsOptional()
  @Transform(({ value }) => {
    if (value == null) return value;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      return value
        .split(/\n|,/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    return value;
  })
  @IsArray()
  @IsString({ each: true })
  benefits?: string[];
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class UpsertTopupPackageDto {
  @IsOptional() @IsString() name?: string;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(1) baseCredits!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) bonusCredits?: number;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(0.01) basePrice!: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional() @IsString() badge?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class PatchTopupPackageDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) baseCredits?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) bonusCredits?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) basePrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional() @IsString() badge?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class CreateRedeemBatchDto {
  @IsOptional() @IsString() name?: string;
  @IsNotEmpty() @IsString() type!: 'VIP' | 'CREDITS';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) vipDays?: number;
  @IsOptional() creditsAmount?: number | string;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(1) quantity!: number;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() note?: string;
}

class VoidCodesDto {
  @IsNotEmpty() ids!: string[];
}

class AdjustDto {
  @IsNotEmpty() @Type(() => Number) @IsNumber() deltaCredits!: number;
  @IsNotEmpty() @IsString() reason!: string;
  @IsOptional() @IsString() remark?: string;
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class FinanceController {
  constructor(
    private readonly admin: AdminService,
    private readonly walletAdmin: AdminWalletService,
    private readonly withdraws: AdminWithdrawsService,
    private readonly vipPlans: VipPlansService,
    private readonly packages: PackagesService,
    private readonly redeemSvc: RedeemService,
  ) {}

  @Get('withdraws')
  async withdrawsAlias(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.withdrawsList(status, page, pageSize);
  }

  @Get('withdraws/list')
  async withdrawsList(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.withdraws.list({
      status: (status as any) || 'ALL',
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
  }

  @Get('withdraws/pending')
  async pendingWithdraws(@Query('overdueHours') overdueHours?: string) {
    const hours = overdueHours != null && overdueHours !== ''
      ? Math.max(0, Number(overdueHours))
      : undefined;
    return ok(await this.admin.pendingWithdraws(Number.isFinite(hours as number) ? hours : undefined));
  }

  @Post('withdraws/:id/approve')
  @AdminRoles('SUPER_ADMIN')
  async approveWithdraw(@Param('id') id: string, @Req() req: any) {
    return ok(await this.admin.approveWithdraw(id, getActor(req)));
  }

  @Post('withdraws/:id/reject')
  @AdminRoles('SUPER_ADMIN')
  async rejectWithdraw(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.rejectWithdraw(id, dto.reason, getActor(req)));
  }

  @Get('vip-plans')
  async listVipPlans() {
    return ok(await this.vipPlans.listAdmin());
  }

  @Post('vip-plans')
  @AdminRoles('SUPER_ADMIN')
  async createVipPlan(@Body() dto: UpsertVipPlanDto, @Req() req: any) {
    return ok(await this.vipPlans.create(dto, getActor(req)));
  }

  @Patch('vip-plans/:id')
  @AdminRoles('SUPER_ADMIN')
  async updateVipPlan(@Param('id') id: string, @Body() dto: PatchVipPlanDto, @Req() req: any) {
    return ok(await this.vipPlans.update(BigInt(id), dto, getActor(req)));
  }

  @Delete('vip-plans/:id')
  @AdminRoles('SUPER_ADMIN')
  async deleteVipPlan(@Param('id') id: string, @Req() req: any) {
    return ok(await this.vipPlans.remove(BigInt(id), getActor(req)));
  }

  @Get('topup-packages')
  async listTopupPackages() {
    return ok(await this.packages.listAdmin());
  }

  @Post('topup-packages')
  @AdminRoles('SUPER_ADMIN')
  async createTopupPackage(@Body() dto: UpsertTopupPackageDto, @Req() req: any) {
    return ok(await this.packages.create(dto, getActor(req)));
  }

  @Patch('topup-packages/:id')
  @AdminRoles('SUPER_ADMIN')
  async updateTopupPackage(
    @Param('id') id: string,
    @Body() dto: PatchTopupPackageDto,
    @Req() req: any,
  ) {
    return ok(await this.packages.update(BigInt(id), dto, getActor(req)));
  }

  @Delete('topup-packages/:id')
  @AdminRoles('SUPER_ADMIN')
  async deleteTopupPackage(@Param('id') id: string, @Req() req: any) {
    return ok(await this.packages.remove(BigInt(id), getActor(req)));
  }

  @Get('redeem/batches')
  @AdminRoles('SUPER_ADMIN')
  async listRedeemBatches(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return ok(await this.redeemSvc.listBatches(
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    ));
  }

  @Post('redeem/batches')
  @AdminRoles('SUPER_ADMIN')
  async createRedeemBatch(@Body() dto: CreateRedeemBatchDto, @Req() req: any) {
    return ok(await this.redeemSvc.createBatch(dto, getActor(req)));
  }

  @Post('redeem/batches/:id/void')
  @AdminRoles('SUPER_ADMIN')
  async voidRedeemBatch(@Param('id') id: string, @Req() req: any) {
    return ok(await this.redeemSvc.voidBatch(id, getActor(req)));
  }

  @Get('redeem/batches/:id/export.csv')
  @AdminRoles('SUPER_ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportRedeemBatch(
    @Param('id') id: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const csv = await this.redeemSvc.exportCsv(id);
    res?.setHeader('Content-Disposition', `attachment; filename="redeem-batch-${id}.csv"`);
    return csv;
  }

  @Get('redeem/codes')
  @AdminRoles('SUPER_ADMIN')
  async listRedeemCodes(
    @Query('batchId') batchId?: string,
    @Query('status') status?: string,
    @Query('code') code?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.redeemSvc.listCodes({
      batchId,
      status: (status as any) || 'ALL',
      code,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    }));
  }

  @Post('redeem/codes/void')
  @AdminRoles('SUPER_ADMIN')
  async voidRedeemCodes(@Body() dto: VoidCodesDto, @Req() req: any) {
    return ok(await this.redeemSvc.voidCodes(dto.ids || [], getActor(req)));
  }

  @Get('redeem/redemptions')
  @AdminRoles('SUPER_ADMIN')
  async listRedemptions(
    @Query('batchId') batchId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.redeemSvc.listRedemptions({
      batchId,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
  }

  @Get('wallet/ledger')
  async walletLedger(
    @Query('userId') userId?: string,
    @Query('type') type?: string,
    @Query('usage') usage?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.walletAdmin.listTransactions({
      userId,
      type,
      usage: usage as any,
      from,
      to,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
  }

  @Post('wallet/adjust')
  @AdminRoles('SUPER_ADMIN')
  async walletAdjust(
    @Query('userId') userId: string,
    @Body() dto: AdjustDto,
    @Req() req: any,
  ) {
    return ok(await this.walletAdmin.adjust(userId, dto, getActor(req)));
  }
}
