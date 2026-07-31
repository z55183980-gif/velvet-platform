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
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminGuard } from './admin.guard';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminService } from './admin.service';
import { ok } from '../common/response';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min, Allow } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ExchangeService } from '../exchange/exchange.service';
import { PackagesService } from '../packages/packages.service';
import { ReconcileService } from '../reconcile/reconcile.service';
import { AuditService } from '../common/audit.service';
import { BizException, BizCode } from '../common/biz.exception';
import { DashboardService } from './dashboard.service';
import { ContentService } from './content.service';
import { AdminUsersService } from './users.service';
import { AdminOrdersService } from './orders.service';
import { AdminWalletService } from './wallet.service';
import { AdminRefundService } from './refund.service';
import { KycService } from './kyc.service';
import { AdminWithdrawsService } from './withdraws.service';
import { AdminCreatorsService } from './creators.service';
import { SettingsService } from './settings.service';
import { AdminEpisodesService } from './episodes.service';
import { AdminsService } from './admins.service';
import { AdminExportService } from './export.service';

function getActor(req: any): bigint | undefined {
  return req?.adminId as bigint | undefined;
}

class ReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class RejectKycDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}

class LocalImportDto {
  @IsOptional()
  @IsString()
  rootPath?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  dryRun?: boolean;
}

class SetRateDto {
  @IsNotEmpty()
  @IsString()
  currency!: string;

  /** 1 CNY = N 该币种（推荐字段） */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  cnyToFiat?: number;

  /** 兼容旧字段：等同 cnyToFiat */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  buyRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  sellRate?: number;
}

class UpsertPackageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  credits!: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  basePrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class PatchPackageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  credits?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  basePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  active?: boolean;
}

class MarkPaidDto {
  @IsNotEmpty()
  @IsString()
  externalRef!: string;
}

class BannerDto {
  @IsNotEmpty()
  @IsString()
  titleVi!: string;

  @IsOptional()
  @IsString()
  titleZh?: string;

  @IsNotEmpty()
  @IsString()
  imageUrl!: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  @IsOptional()
  @IsString()
  dramaId?: string;

  @IsNotEmpty()
  @IsString()
  startAt!: string;

  @IsNotEmpty()
  @IsString()
  endAt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isActive?: boolean;
}

class CategoryDto {
  @IsNotEmpty()
  @IsString()
  slug!: string;

  @IsNotEmpty()
  @IsString()
  nameVi!: string;

  @IsNotEmpty()
  @IsString()
  nameZh!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isActive?: boolean;
}

class DramaUpdateDto {
  @IsOptional() @IsString() titleVi?: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() descriptionVi?: string;
  @IsOptional() @IsString() descriptionZh?: string;
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @Type(() => Number) @IsNumber() freeEpisodeCount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortWeight?: number;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean() isFeatured?: boolean;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean() isOfficial?: boolean;
}

class AdjustDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  deltaCredits!: number;

  @IsNotEmpty()
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

class RefundRefuseDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}

class UserStatusDto {
  @IsNotEmpty()
  @IsString()
  status!: 'ACTIVE' | 'SUSPENDED' | 'BANNED';

  @IsNotEmpty()
  @IsString()
  reason!: string;
}

class EpisodeUpdateDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean() isFree?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceCredits?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceVnd?: number;
  @IsOptional() @IsString() thumbnailUrl?: string;
  @IsOptional() @IsString() transcodeStatus?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

class ReorderDto {
  @IsNotEmpty()
  ids!: string[];
}

class SettingUpdateDto {
  @IsNotEmpty()
  @IsString()
  key!: string;

  /** whitelist 必须保留；用 Allow 防止 value 被剥掉 */
  @Allow()
  value: any;
}

class AdminRoleDto {
  @IsNotEmpty()
  @IsString()
  role!: 'SUPER_ADMIN' | 'OPS';
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly exchange: ExchangeService,
    private readonly packages: PackagesService,
    private readonly reconcile: ReconcileService,
    private readonly audit: AuditService,
    private readonly dashboard: DashboardService,
    private readonly content: ContentService,
    private readonly users: AdminUsersService,
    private readonly orders: AdminOrdersService,
    private readonly walletAdmin: AdminWalletService,
    private readonly refund: AdminRefundService,
    private readonly kyc: KycService,
    private readonly withdraws: AdminWithdrawsService,
    private readonly creators: AdminCreatorsService,
    private readonly settings: SettingsService,
    private readonly episodes: AdminEpisodesService,
    private readonly admins: AdminsService,
    private readonly exportSvc: AdminExportService,
  ) {}

  // ============ Dashboard ============
  @Get('dashboard/overview')
  async dashboardOverview() {
    return ok(await this.dashboard.overview());
  }

  // 兼容旧路径
  @Get('stats/overview')
  async stats() {
    return ok(await this.dashboard.overview());
  }

  // ============ Dramas ============
  @Get('dramas')
  async listDramas(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('categorySlug') categorySlug?: string,
    @Query('isOfficial') isOfficial?: string,
    @Query('isFeatured') isFeatured?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.content.list({
        q,
        status: (status as any) || 'ALL',
        categorySlug,
        isOfficial: isOfficial as any,
        isFeatured: isFeatured as any,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Get('dramas/pending')
  async pendingDramas() {
    return ok(await this.admin.pendingDramas());
  }

  // static path before :id
  @Get('dramas/ranking')
  async ranking() {
    return ok(await this.content.ranking());
  }

  @Get('dramas/:id')
  async getDrama(@Param('id') id: string) {
    const d = await this.content.detail(id);
    return ok(d);
  }

  @Post('dramas/:id/approve')
  async approveDrama(@Param('id') id: string, @Req() req: any) {
    return ok(await this.admin.approveDrama(id, getActor(req)));
  }

  @Post('dramas/:id/reject')
  async rejectDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.rejectDrama(id, dto.reason, getActor(req)));
  }

  @Post('dramas/:id/update')
  async updateDrama(@Param('id') id: string, @Body() dto: DramaUpdateDto, @Req() req: any) {
    return ok(await this.admin.updateDrama(id, dto, getActor(req)));
  }

  @Post('dramas/:id/offline')
  async offlineDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.offlineDrama(id, dto.reason, getActor(req)));
  }

  @Post('dramas/:id/online')
  async onlineDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.onlineDrama(id, dto.reason, getActor(req)));
  }

  @Post('dramas/:id/featured')
  async setFeatured(@Param('id') id: string, @Body() body: { value: boolean }, @Req() req: any) {
    return ok(await this.content.setFeatured(id, !!body?.value, getActor(req)));
  }

  @Post('dramas/:id/official')
  async setOfficial(@Param('id') id: string, @Body() body: { value: boolean }, @Req() req: any) {
    return ok(await this.content.setOfficial(id, !!body?.value, getActor(req)));
  }

  @Post('dramas/:id/sort-weight')
  async setSortWeight(
    @Param('id') id: string,
    @Body() body: { weight: number },
    @Req() req: any,
  ) {
    return ok(
      await this.content.setSortWeight(id, Number(body?.weight ?? 0), getActor(req)),
    );
  }

  @Post('dramas/:id/delete')
  async deleteDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.deleteDrama(id, dto.reason, getActor(req)));
  }

  // ============ Episodes ============
  @Get('dramas/:id/episodes')
  async dramaEpisodes(@Param('id') id: string) {
    return ok(await this.episodes.listByDrama(id));
  }

  @Post('episodes/:id/update')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async updateEpisode(@Param('id') id: string, @Body() dto: EpisodeUpdateDto, @Req() req: any) {
    return ok(await this.episodes.update(id, dto as any, getActor(req)));
  }

  @Post('dramas/:id/episodes/reorder')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async reorderEpisodes(@Param('id') id: string, @Body() dto: ReorderDto, @Req() req: any) {
    return ok(await this.episodes.reorder(id, dto.ids, getActor(req)));
  }

  @Post('episodes/:id/transcode-retry')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async retryTranscode(@Param('id') id: string, @Req() req: any) {
    return ok(await this.episodes.retryTranscode(id, getActor(req)));
  }

  // ============ KYC ============
  @Get('kyc/list')
  async kycList(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.kyc.list({
        status: (status as any) || 'ALL',
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
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

  // ============ Withdraws ============
  /** 兼容误用 `/admin/withdraws`（正式列表为 withdraws/list） */
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
    return ok(
      await this.withdraws.list({
        status: (status as any) || 'ALL',
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Get('withdraws/pending')
  async pendingWithdraws(@Query('overdueHours') overdueHours?: string) {
    const hours =
      overdueHours != null && overdueHours !== ''
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

  // ============ Orders ============
  @Get('orders')
  async ordersList(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('method') method?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.orders.list({
        type: (type as any) || 'ALL',
        status: (status as any) || 'ALL',
        method,
        userId,
        from,
        to,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  // 财务相关：仅 SUPER_ADMIN
  @Post('orders/:orderNo/mark-paid')
  @AdminRoles('SUPER_ADMIN')
  async markPaid(@Param('orderNo') orderNo: string, @Body() dto: MarkPaidDto, @Req() req: any) {
    return ok(await this.admin.markPaid(orderNo, dto.externalRef, getActor(req)));
  }

  // ============ Refunds ============
  @Get('refunds/requests')
  @AdminRoles('SUPER_ADMIN')
  async refundRequests(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.refund.listRequests({
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Post('refunds/:orderNo/approve')
  @AdminRoles('SUPER_ADMIN')
  async refundApprove(@Param('orderNo') orderNo: string, @Req() req: any) {
    return ok(await this.refund.approve(orderNo, getActor(req)));
  }

  @Post('refunds/:orderNo/refuse')
  @AdminRoles('SUPER_ADMIN')
  async refundRefuse(
    @Param('orderNo') orderNo: string,
    @Body() dto: RefundRefuseDto,
    @Req() req: any,
  ) {
    return ok(await this.refund.refuse(orderNo, dto.reason, getActor(req)));
  }

  // ============ CSV Export ============
  @Get('exports/orders.csv')
  @AdminRoles('SUPER_ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportOrdersCsv(@Query('limit') limit?: string, @Res({ passthrough: true }) res?: Response) {
    const csv = await this.exportSvc.ordersCsv(limit ? Number(limit) : 2000);
    res?.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return new StreamableFile(Buffer.from('\uFEFF' + csv, 'utf8'));
  }

  @Get('exports/withdraws.csv')
  @AdminRoles('SUPER_ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportWithdrawsCsv(@Query('limit') limit?: string, @Res({ passthrough: true }) res?: Response) {
    const csv = await this.exportSvc.withdrawsCsv(limit ? Number(limit) : 2000);
    res?.setHeader('Content-Disposition', 'attachment; filename="withdraws.csv"');
    return new StreamableFile(Buffer.from('\uFEFF' + csv, 'utf8'));
  }

  @Get('exports/reconciliations.csv')
  @AdminRoles('SUPER_ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportReconciliationsCsv(
    @Query('limit') limit?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const csv = await this.exportSvc.reconciliationsCsv(limit ? Number(limit) : 500);
    res?.setHeader('Content-Disposition', 'attachment; filename="reconciliations.csv"');
    return new StreamableFile(Buffer.from('\uFEFF' + csv, 'utf8'));
  }

  // ============ Reconcile ============
  @Get('reconciliations')
  async reconciliations(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.admin.listReconciliations(
        page ? Number(page) : 1,
        pageSize ? Number(pageSize) : 30,
      ),
    );
  }

  @Post('reconciliations/rerun')
  async rerunReconcile(@Query('days') days?: string) {
    const d = days ? Math.max(1, Math.min(30, Number(days) || 1)) : 1;
    const results: { date: string; provider: string; status: string; localPaidCnt: number; remotePaidCnt: number }[] = [];
    for (let i = 0; i < d; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const providers = ['STRIPE', 'WECHAT', 'ALIPAY', 'MOMO', 'ZALOPAY', 'VIETQR', 'BANK_TRANSFER'];
      for (const p of providers) {
        const r: any = await this.reconcile.reconcileProvider(p, date);
        results.push({
          date: date.toISOString().slice(0, 10),
          provider: p,
          status: r.status,
          localPaidCnt: r.localPaidCnt,
          remotePaidCnt: r.remotePaidCnt,
        });
      }
    }
    return ok({ days: d, results });
  }

  @Post('settle-t7')
  @AdminRoles('SUPER_ADMIN')
  async settleT7(@Query('days') days?: string) {
    const parsed = days == null || days === '' ? 7 : parseInt(days, 10);
    const d = Number.isFinite(parsed) ? Math.max(0, parsed) : 7;
    return ok(await this.reconcile.settleNow(d));
  }

  // ============ Exchange Rates (cnyToFiat) ============
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
    return ok(
      await this.exchange.upsertRate(
        {
          currency: dto.currency,
          cnyToFiat,
          sellRate: dto.sellRate ?? cnyToFiat,
        },
        getActor(req),
      ),
    );
  }

  // ============ Topup Packages ============
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
  async updatePackage(
    @Param('id') id: string,
    @Body() dto: PatchPackageDto,
    @Req() req: any,
  ) {
    return ok(await this.packages.update(BigInt(id), dto, getActor(req)));
  }

  // ============ Users CRM ============
  @Get('users')
  async listUsers(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('locale') locale?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.users.list({
        q,
        status: (status as any) || 'ALL',
        locale: locale as any,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Get('users/:id')
  async userDetail(@Param('id') id: string) {
    return ok(await this.users.detail(id));
  }

  @Post('users/:id/status')
  async setUserStatus(
    @Param('id') id: string,
    @Body() dto: UserStatusDto,
    @Req() req: any,
  ) {
    return ok(await this.users.setStatus(id, dto.status, dto.reason, getActor(req)));
  }

  @Post('users/:id/force-logout')
  async forceLogout(@Param('id') id: string, @Req() req: any) {
    return ok(await this.users.forceLogout(id, getActor(req)));
  }

  // ============ Wallet / Ledger ============
  @Get('wallet/ledger')
  async walletLedger(
    @Query('userId') userId?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.walletAdmin.listTransactions({
        userId,
        type: (type as any) || 'ALL',
        from,
        to,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
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

  // ============ Creators (admin) ============
  @Get('creators')
  async listCreators(
    @Query('q') q?: string,
    @Query('kyc') kyc?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      await this.creators.list({
        q,
        kyc: (kyc as any) || 'ALL',
        sort: sort as any,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      }),
    );
  }

  @Get('creators/:id')
  async creatorDetail(@Param('id') id: string) {
    return ok(await this.creators.detail(id));
  }

  // ============ System Settings ============
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

  // ============ Admins (RBAC) ============
  @Get('admins')
  @AdminRoles('SUPER_ADMIN')
  async listAdmins() {
    return ok(await this.admins.list());
  }

  @Post('admins/:id/role')
  @AdminRoles('SUPER_ADMIN')
  async setAdminRole(
    @Param('id') id: string,
    @Body() dto: AdminRoleDto,
    @Req() req: any,
  ) {
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

  // ============ Local import (kept) ============
  @Post('import/local')
  async importLocal(@Body() dto: LocalImportDto) {
    return ok(
      await this.admin.importLocal({
        rootPath: dto.rootPath,
        dryRun: dto.dryRun,
      }),
    );
  }

  @Post('import/upload')
  @UseInterceptors(
    FilesInterceptor('files', 200, {
      storage: memoryStorage(),
      limits: { fileSize: 512 * 1024 * 1024, files: 200 },
    }),
  )
  async importUpload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { relativePaths?: string | string[]; dryRun?: string | boolean },
  ) {
    const raw = body?.relativePaths;
    const relativePaths = Array.isArray(raw)
      ? raw.map(String)
      : raw != null && raw !== ''
        ? [String(raw)]
        : [];
    const dryRun =
      body?.dryRun === true || body?.dryRun === 'true' || body?.dryRun === '1';
    if (!files?.length) {
      throw new BizException(BizCode.BAD_REQUEST, '请选择要导入的文件夹');
    }
    return ok(await this.admin.importUploadedFiles(files, relativePaths, dryRun));
  }

  // ============ Banner CRUD ============
  @Get('banners')
  async listBanners(@Query('all') all?: string) {
    return ok(await this.admin.listBanners(all === '1' || all === 'true'));
  }

  @Post('banners')
  async createBanner(@Body() dto: BannerDto, @Req() req: any) {
    return ok(await this.admin.createBanner(dto, getActor(req)));
  }

  @Post('banners/:id')
  async updateBanner(@Param('id') id: string, @Body() dto: Partial<BannerDto>, @Req() req: any) {
    return ok(await this.admin.updateBanner(id, dto, getActor(req)));
  }

  @Post('banners/:id/delete')
  async deleteBanner(@Param('id') id: string, @Req() req: any) {
    return ok(await this.admin.deleteBanner(id, getActor(req)));
  }

  // ============ Category CRUD ============
  @Get('categories')
  async listCategories(@Query('all') all?: string) {
    return ok(await this.admin.listCategories(all === '1' || all === 'true'));
  }

  @Post('categories')
  async createCategory(@Body() dto: CategoryDto, @Req() req: any) {
    return ok(await this.admin.createCategory(dto, getActor(req)));
  }

  @Post('categories/:slug')
  async updateCategory(@Param('slug') slug: string, @Body() dto: Partial<CategoryDto>, @Req() req: any) {
    return ok(await this.admin.updateCategory(slug, dto, getActor(req)));
  }

  @Post('categories/:slug/delete')
  async deleteCategory(@Param('slug') slug: string, @Req() req: any) {
    return ok(await this.admin.deleteCategory(slug, getActor(req)));
  }
}
