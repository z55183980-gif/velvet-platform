import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

@Injectable()
export class AdminExportService {
  constructor(private readonly prisma: PrismaService) {}

  async ordersCsv(limit = 2000): Promise<string> {
    const take = Math.min(5000, Math.max(1, Math.floor(limit)));
    const rows = await this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { email: true, phone: true } } },
    });
    return toCsv(
      [
        'orderNo',
        'orderType',
        'paymentStatus',
        'paymentMethod',
        'amountVnd',
        'amountCredits',
        'userEmail',
        'userPhone',
        'refundStatus',
        'paidAt',
        'createdAt',
      ],
      rows.map((r) => [
        r.orderNo,
        r.orderType,
        r.paymentStatus,
        r.paymentMethod,
        r.amountVnd?.toString(),
        r.amountCredits?.toString(),
        r.user?.email,
        r.user?.phone,
        r.refundStatus,
        r.paidAt?.toISOString() ?? '',
        r.createdAt.toISOString(),
      ]),
    );
  }

  async withdrawsCsv(limit = 2000): Promise<string> {
    const take = Math.min(5000, Math.max(1, Math.floor(limit)));
    const rows = await this.prisma.withdrawRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { creator: { select: { displayName: true, taxCode: true } } },
    });
    return toCsv(
      [
        'requestNo',
        'status',
        'creator',
        'amountVnd',
        'pitVnd',
        'netVnd',
        'taxCode',
        'createdAt',
        'paidAt',
      ],
      rows.map((r) => [
        r.requestNo,
        r.status,
        r.creator?.displayName,
        r.amountVnd?.toString(),
        r.pitVnd?.toString() ?? '',
        r.netVnd?.toString() ?? '',
        r.creator?.taxCode,
        r.createdAt.toISOString(),
        r.paidAt?.toISOString() ?? '',
      ]),
    );
  }

  async reconciliationsCsv(limit = 500): Promise<string> {
    const take = Math.min(2000, Math.max(1, Math.floor(limit)));
    const rows = await this.prisma.paymentReconciliation.findMany({
      orderBy: { date: 'desc' },
      take,
    });
    return toCsv(
      ['date', 'provider', 'status', 'localPaidCnt', 'remotePaidCnt', 'createdAt'],
      rows.map((r) => [
        r.date.toISOString().slice(0, 10),
        r.provider,
        r.status,
        r.localPaidCnt,
        r.remotePaidCnt,
        r.createdAt.toISOString(),
      ]),
    );
  }
}
