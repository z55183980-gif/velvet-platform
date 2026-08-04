import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import { WalletService } from './wallet.service';
import { TopupOrderDto, UnlockEpisodeDto, UnlockDramaDto, VipSubOrderDto, RedeemCodeDto, RefundDto } from './wallet.dto';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { RedeemService } from '../redeem/redeem.service';

@Controller('v1')
@UseGuards(AuthGuard)
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
    private readonly redeem: RedeemService,
  ) {}

  @Get('wallet')
  async balance(@CurrentUser() user: AuthUser) {
    return ok(await this.wallet.getBalance(user.userId));
  }

  @Get('wallet/transactions')
  async transactions(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    return ok(await this.wallet.getTransactions(user.userId, p));
  }

  @Post('orders/topup')
  async topup(@Body() dto: TopupOrderDto, @CurrentUser() user: AuthUser) {
    return ok(await this.wallet.createTopupOrder(dto, user.userId));
  }

  @Post('orders/vip-sub')
  async vipSub(@Body() dto: VipSubOrderDto, @CurrentUser() user: AuthUser) {
    return ok(await this.wallet.createVipSubOrder(dto, user.userId));
  }

  @Post('orders/unlock-episode')
  async unlock(@Body() dto: UnlockEpisodeDto, @CurrentUser() user: AuthUser) {
    return ok(await this.wallet.unlockEpisode(dto, user.userId));
  }

  @Post('orders/unlock-drama')
  async unlockDrama(@Body() dto: UnlockDramaDto, @CurrentUser() user: AuthUser) {
    return ok(await this.wallet.unlockDrama(dto, user.userId));
  }

  @Post('redeem')
  async redeemCode(@Body() dto: RedeemCodeDto, @CurrentUser() user: AuthUser) {
    return ok(await this.redeem.redeem(user.userId, dto.code));
  }

  @Post('orders/:orderNo/refund')
  async refund(
    @Param('orderNo') orderNo: string,
    @Body() dto: RefundDto,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.wallet.refundOrder(orderNo, user.userId, dto.reason));
  }

  /** 用户发起退款工单：TOPUP 必须走审批；EPISODE_UNLOCK 也可申请（或继续用自助 /refund） */
  @Post('orders/:orderNo/refund-request')
  async refundRequest(
    @Param('orderNo') orderNo: string,
    @Body() dto: { note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new BizException(BizCode.NOT_FOUND, 'order.notFound');
    if (order.userId !== user.userId) {
      throw new BizException(BizCode.FORBIDDEN, 'common.forbidden');
    }
    if (order.paymentStatus !== 'PAID') {
      throw new BizException(BizCode.ORDER_NOT_PAID, 'order.unpaidCannotRefund');
    }
    if (order.orderType !== 'TOPUP' && order.orderType !== 'EPISODE_UNLOCK') {
      throw new BizException(BizCode.FORBIDDEN, 'order.typeNoRefund');
    }
    if (order.refundStatus === 'REQUESTED') {
      return ok({ alreadyRequested: true, orderNo });
    }
    if (order.refundStatus === 'APPROVED') {
      throw new BizException(BizCode.CONFLICT, 'Đơn đã được xử lý');
    }
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { refundStatus: 'REQUESTED', refundNote: dto?.note || null },
    });
    return ok({ orderNo: updated.orderNo, refundStatus: updated.refundStatus });
  }

  @Get('orders')
  async orders(@CurrentUser() user: AuthUser, @Query('page') page?: string) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    return ok(await this.wallet.myOrders(user.userId, p));
  }
}
