import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsNotEmpty, IsString } from 'class-validator';
import { ok } from '../common/response';
import { ReconcileService } from '../reconcile/reconcile.service';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminExportService } from './export.service';
import { AdminOrdersService } from './orders.service';
import { AdminRefundService } from './refund.service';

function getActor(req: any): bigint | undefined {
  return req?.adminId as bigint | undefined;
}

class MarkPaidDto {
  @IsNotEmpty() @IsString() externalRef!: string;
}

class RefundRefuseDto {
  @IsNotEmpty() @IsString() reason!: string;
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class OrdersController {
  constructor(
    private readonly admin: AdminService,
    private readonly orders: AdminOrdersService,
    private readonly refund: AdminRefundService,
    private readonly exportSvc: AdminExportService,
    private readonly reconcile: ReconcileService,
  ) {}

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
    return ok(await this.orders.list({
      type: (type as any) || 'ALL',
      status: (status as any) || 'ALL',
      method,
      userId,
      from,
      to,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
  }

  @Post('orders/:orderNo/mark-paid')
  @AdminRoles('SUPER_ADMIN')
  async markPaid(@Param('orderNo') orderNo: string, @Body() dto: MarkPaidDto, @Req() req: any) {
    return ok(await this.admin.markPaid(orderNo, dto.externalRef, getActor(req)));
  }

  @Get('refunds/requests')
  @AdminRoles('SUPER_ADMIN')
  async refundRequests(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return ok(await this.refund.listRequests({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
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
  async exportWithdrawsCsv(
    @Query('limit') limit?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
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

  @Get('reconciliations')
  async reconciliations(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return ok(await this.admin.listReconciliations(
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 30,
    ));
  }

  @Post('reconciliations/rerun')
  async rerunReconcile(@Query('days') days?: string) {
    const d = days ? Math.max(1, Math.min(30, Number(days) || 1)) : 1;
    const results: {
      date: string;
      provider: string;
      status: string;
      localPaidCnt: number;
      remotePaidCnt: number;
    }[] = [];
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
}
