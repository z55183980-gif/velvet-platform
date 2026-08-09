import { Injectable } from '@nestjs/common';
import { Prisma, TxType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import { toBigInt, genOrderNo } from '../common/money.util';
import { AuditService } from '../common/audit.service';

type UsageKind = 'EPISODE_UNLOCK' | 'DRAMA_BUYOUT' | 'ALL';

@Injectable()
export class AdminWalletService {
  private static readonly ADJUST_RETRY = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 积分使用记录：用户消耗积分解锁单集 / 买断整剧。
   * 以已支付消费订单为主，附带钱包流水余额快照与内容标题。
   */
  async listTransactions(filter: {
    userId?: string;
    /** @deprecated 兼容旧 type=UNLOCK；新前端用 usage */
    type?: string;
    usage?: UsageKind;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Math.floor(filter.pageSize ?? 20)));

    const usage = this.resolveUsageKind(filter.usage ?? filter.type);
    const where: Prisma.OrderWhereInput = {
      paymentStatus: 'PAID',
      amountCredits: { gt: 0 },
      fxSource: { not: 'admin-adjust' },
      orderType:
        usage === 'ALL'
          ? { in: ['EPISODE_UNLOCK', 'DRAMA_BUYOUT'] }
          : usage,
    };

    if (filter.userId) where.userId = BigInt(filter.userId);
    if (filter.from || filter.to) {
      where.paidAt = {};
      if (filter.from) where.paidAt.gte = new Date(filter.from);
      if (filter.to) {
        const end = new Date(filter.to);
        if (!filter.to.includes('T')) end.setHours(23, 59, 59, 999);
        where.paidAt.lte = end;
      }
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: { id: true, email: true, phone: true, nickname: true },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const orderIds = orders.map((o) => o.id);
    const [txs, dramas, episodes] = await Promise.all([
      orderIds.length
        ? this.prisma.walletTransaction.findMany({
            where: {
              orderId: { in: orderIds },
              type: { in: ['UNLOCK', 'REFUND'] },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      (() => {
        const dramaIds = [
          ...new Set(orders.map((o) => o.dramaId).filter((id): id is bigint => id != null)),
        ];
        return dramaIds.length
          ? this.prisma.drama.findMany({
              where: { id: { in: dramaIds } },
              select: { id: true, titleEn: true, titleZh: true, slug: true },
            })
          : Promise.resolve([]);
      })(),
      (() => {
        const episodeIds = [
          ...new Set(orders.map((o) => o.episodeId).filter((id): id is bigint => id != null)),
        ];
        return episodeIds.length
          ? this.prisma.episode.findMany({
              where: { id: { in: episodeIds } },
              select: { id: true, episodeNumber: true, title: true, dramaId: true },
            })
          : Promise.resolve([]);
      })(),
    ]);

    const txByOrder = new Map<string, (typeof txs)[number]>();
    for (const tx of txs) {
      const key = String(tx.orderId);
      // 优先扣款流水；若仅有退款则保留退款
      const prev = txByOrder.get(key);
      if (!prev || (prev.type === 'REFUND' && tx.type === 'UNLOCK')) {
        txByOrder.set(key, tx);
      }
    }
    const dramaMap = new Map(dramas.map((d) => [String(d.id), d] as const));
    const episodeMap = new Map(episodes.map((e) => [String(e.id), e] as const));

    const rows = orders.map((order) => {
      const tx = txByOrder.get(String(order.id));
      const drama = order.dramaId ? dramaMap.get(String(order.dramaId)) ?? null : null;
      const episode = order.episodeId ? episodeMap.get(String(order.episodeId)) ?? null : null;
      return {
        id: tx?.id ?? order.id,
        orderId: order.id,
        orderNo: order.orderNo,
        usageType: order.orderType as 'EPISODE_UNLOCK' | 'DRAMA_BUYOUT',
        amountCredits: tx?.amountCredits ?? -order.amountCredits,
        creditsSpent: order.amountCredits,
        balanceAfter: tx?.balanceAfter ?? null,
        remark: tx?.remark ?? null,
        createdAt: order.paidAt ?? order.createdAt,
        walletUserId: order.userId,
        user: order.user
          ? {
              id: order.user.id.toString(),
              email: order.user.email,
              phone: order.user.phone,
              nickname: order.user.nickname,
            }
          : null,
        drama,
        episode,
      };
    });

    return { rows, total, page, pageSize };
  }

  private resolveUsageKind(raw?: string): UsageKind {
    if (raw === 'EPISODE_UNLOCK' || raw === 'DRAMA_BUYOUT') return raw;
    // 旧筛选 UNLOCK ≈ 全部使用；TOPUP/REFUND/ADJUST 对本页无意义，回落 ALL
    return 'ALL';
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
      throw new BizException(BizCode.BAD_REQUEST, 'validation.deltaCreditsNonZero');
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
          payCurrency: 'USD',
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
            throw new BizException(BizCode.INSUFFICIENT_BALANCE, 'wallet.emptyCannotDebit');
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
