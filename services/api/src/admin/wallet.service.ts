import { Injectable } from '@nestjs/common';
import { Prisma, TxType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { toBigInt, genOrderNo } from '../common/money.util';
import { AuditService } from '../common/audit.service';

@Injectable()
export class AdminWalletService {
  private static readonly ADJUST_RETRY = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listTransactions(filter: {
    userId?: string;
    type?: 'TOPUP' | 'UNLOCK' | 'REFUND' | 'ADJUST' | 'ALL';
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));
    const where: any = {};
    if (filter.userId) where.walletUserId = BigInt(filter.userId);
    if (filter.type && filter.type !== 'ALL') {
      // 注：当前 TxType 未含 ADJUST（prisma enum 沿用），实际生产会迁移 schema
      where.type = filter.type as any;
    }
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) (where.createdAt as any).gte = new Date(filter.from);
      if (filter.to) (where.createdAt as any).lte = new Date(filter.to);
    }
    const [rows, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  /** 管理员人工加减积分（生成一次性订单，orderType=TOPUP/amountCredits 负值记 ADJUST 类记账） */
  async adjust(
    userId: string,
    input: { deltaCredits: number | string; reason: string; remark?: string },
    actorId?: bigint,
  ) {
    if (!input?.reason || !String(input.reason).trim()) {
      throw new BizException(BizCode.BAD_REQUEST, 'common.reasonRequired');
    }
    const delta = toBigInt(input.deltaCredits);
    if (delta === 0n) {
      throw new BizException(BizCode.BAD_REQUEST, 'deltaCredits không được = 0');
    }

    const user = await this.prisma.user.findUnique({ where: { id: BigInt(userId) } });
    if (!user) throw new BizException(BizCode.NOT_FOUND, 'user.notFound');

    const result = await this.prisma.$transaction(async (tx) => {
      // 创建一个 ADJUST 占位订单，方便 audit / 幂等
      const idem = `adjust:${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const orderType = delta > 0n ? 'TOPUP' : 'EPISODE_UNLOCK';
      const order = await tx.order.create({
        data: {
          orderNo: genOrderNo('ADJ'),
          idempotencyKey: idem,
          userId: user.id,
          orderType: orderType as any,
          amountVnd: 0n,
          amountCredits: delta,
          creatorIncomeVnd: 0n,
          platformFeeVnd: 0n,
          payCurrency: 'VND',
          payAmount: new Prisma.Decimal(0),
          fxRate: new Prisma.Decimal(1),
          fxSource: 'admin-adjust',
          paymentMethod: 'WALLET',
          paymentStatus: 'PAID',
          paidAt: new Date(),
        },
      });

      let balanceAfter: bigint | null = null;
      for (let attempt = 0; attempt < AdminWalletService.ADJUST_RETRY; attempt++) {
        const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
        if (!wallet) {
          // 自动建空钱包
          if (delta < 0n) {
            throw new BizException(BizCode.INSUFFICIENT_BALANCE, 'Ví rỗng, không thể trừ');
          }
          const newBalance = delta;
          await tx.wallet.create({
            data: {
              userId: user.id,
              balanceCredits: newBalance,
              totalRechargedCredits: delta > 0n ? delta : 0n,
            },
          });
          balanceAfter = newBalance;
          break;
        }
        const newBalance = wallet.balanceCredits + delta;
        if (newBalance < 0n) {
          throw new BizException(BizCode.INSUFFICIENT_BALANCE, 'wallet.insufficientBalance');
        }
        const res = await tx.wallet.updateMany({
          where: { userId: user.id, version: wallet.version },
          data: {
            balanceCredits: newBalance,
            ...(delta > 0n
              ? { totalRechargedCredits: { increment: delta } }
              : { totalSpentCredits: { increment: -delta } }),
            version: { increment: 1 },
          },
        });
        if (res.count === 1) {
          balanceAfter = newBalance;
          break;
        }
      }
      if (balanceAfter == null) {
        throw new BizException(BizCode.CONFLICT, 'wallet.updateFailed');
      }

      // 记一笔流水（UNLOCK + 负号、TOPUP + 正号可区分方向；用 remark 表明是 ADJUST）
      const txType: TxType = delta > 0n ? 'TOPUP' : 'UNLOCK';
      await tx.walletTransaction.create({
        data: {
          walletUserId: user.id,
          type: txType,
          amountCredits: delta,
          orderId: order.id,
          balanceAfter,
          remark: `ADMIN ADJUST: ${input.reason}${input.remark ? ` · ${input.remark}` : ''}`,
        },
      });
      return { orderNo: order.orderNo, balanceAfter: balanceAfter.toString() };
    });

    await this.audit.write({
      actorId,
      action: 'wallet.adjust',
      targetType: 'user',
      targetId: userId,
      payload: {
        deltaCredits: delta.toString(),
        reason: input.reason,
        remark: input.remark,
        balanceAfter: result.balanceAfter,
      },
    });

    return result;
  }
}
