import {
  Body,
  Controller,
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
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { BizCode, BizException } from '../common/biz.exception';
import { ok } from '../common/response';
import { ExchangeService } from '../exchange/exchange.service';
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

class SetRateDto {
  @IsNotEmpty() @IsString() currency!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) cnyToFiat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) buyRate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) sellRate?: number;
}

class UpsertPackageDto {
  @IsOptional() @IsString() name?: string;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(1) credits!: number;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(0.01) basePrice!: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class PatchPackageDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) credits?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) basePrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class UpsertVipPlanDto {
  @IsOptional() @IsString() name?: string;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(1) durationDays!: number;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(0.01) basePrice!: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional() @IsString() badge?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class PatchVipPlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) durationDays?: number;
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
    private readonly exchange: ExchangeService,
    private readonly packages: PackagesService,
    private readonly walletAdmin: AdminWalletService,
    private readonly withdraws: AdminWithdrawsService,
    private readonly vipPlans: VipPlansService,
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

  @Get('exchange-rates')
  async listRates() {
    return ok(await this.exchange.getRates());
  }

  @Post('exchange-rates')
  @AdminRoles('SUPER_ADMIN')
  async setRate(@Body() dto: SetRateDto, @Req() req: any) {
    const cnyToFiat = dto.cnyToFiat ?? dto.buyRate;
    if (cnyToFiat == null) {
      throw new BizException(BizCode.BAD_REQUEST, 'cnyToFiat 必填');
    }
    return ok(await this.exchange.upsertRate({
      currency: dto.currency,
      cnyToFiat,
      sellRate: dto.sellRate ?? cnyToFiat,
    }, getActor(req)));
  }

  @Get('topup-packages')
  async listPackages() {
    return ok(await this.packages.listAdmin());
  }

  @Post('topup-packages')
  @AdminRoles('SUPER_ADMIN')
  async createPackage(@Body() dto: UpsertPackageDto, @Req() req: any) {
    return ok(await this.packages.create(dto, getActor(req)));
  }

  @Patch('topup-packages/:id')
  @AdminRoles('SUPER_ADMIN')
  async updatePackage(@Param('id') id: string, @Body() dto: PatchPackageDto, @Req() req: any) {
    return ok(await this.packages.update(BigInt(id), dto, getActor(req)));
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
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.redeemSvc.listCodes({
      batchId,
      status: (status as any) || 'ALL',
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
  async listRedemptions(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return ok(await this.redeemSvc.listRedemptions(
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    ));
  }

  @Get('wallet/ledger')
  async walletLedger(
    @Query('userId') userId?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.walletAdmin.listTransactions({
      userId,
      type: (type as any) || 'ALL',
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
