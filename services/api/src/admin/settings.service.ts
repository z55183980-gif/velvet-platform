import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { BizException, BizCode } from '../common/biz.exception';

const DEFAULT_KEYS: { key: string; value: any; labelVi: string; labelZh: string; type: 'number' | 'boolean' | 'string' | 'json' }[] = [
  { key: 'defaultFreeEpisodes', value: 3, labelVi: 'Số tập miễn phí mặc định', labelZh: '默认免费集数', type: 'number' },
  { key: 'pitRate', value: 0.05, labelVi: 'Thuế TNCN (PIT)', labelZh: '个人所得税率', type: 'number' },
  { key: 't7Days', value: 7, labelVi: 'T+7 解冻天数', labelZh: 'T+7 解冻天数', type: 'number' },
  { key: 'alipayEnabled', value: true, labelVi: '启用支付宝', labelZh: '启用支付宝', type: 'boolean' },
  { key: 'platformFeeRate', value: 0.3, labelVi: '平台分润比例', labelZh: '平台抽成比例', type: 'number' },
  { key: 'wechatEnabled', value: false, labelVi: '启用微信支付', labelZh: '启用微信支付', type: 'boolean' },
  { key: 'stripeEnabled', value: false, labelVi: '启用 Stripe', labelZh: '启用 Stripe', type: 'boolean' },
  { key: 'momoEnabled', value: false, labelVi: '启用 MoMo', labelZh: '启用 MoMo', type: 'boolean' },
  { key: 'zalopayEnabled', value: false, labelVi: '启用 ZaloPay', labelZh: '启用 ZaloPay', type: 'boolean' },
  { key: 'vietqrEnabled', value: true, labelVi: '启用 VietQR', labelZh: '启用 VietQR', type: 'boolean' },
  { key: 'bankTransferEnabled', value: true, labelVi: '启用 Bank Transfer', labelZh: '启用银行转账', type: 'boolean' },
];

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const stored = await this.prisma.systemSetting.findMany();
    const map = new Map(stored.map((s) => [s.key, s]));
    const items = DEFAULT_KEYS.map((d) => {
      const row = map.get(d.key);
      return {
        key: d.key,
        labelVi: d.labelVi,
        labelZh: d.labelZh,
        type: d.type,
        value: row ? row.value : d.value,
        updatedAt: row?.updatedAt ?? null,
      };
    });
    const extras = stored
      .filter((s) => !DEFAULT_KEYS.find((d) => d.key === s.key))
      .map((s) => ({
        key: s.key,
        labelVi: s.key,
        labelZh: s.key,
        type: typeof s.value as any,
        value: s.value,
        updatedAt: s.updatedAt,
      }));
    return { items: [...items, ...extras] };
  }

  async update(key: string, value: any, actorId?: bigint) {
    const known = DEFAULT_KEYS.find((d) => d.key === key);
    if (known) {
      switch (known.type) {
        case 'number': {
          const n = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(n)) {
            throw new BizException(
              BizCode.BAD_REQUEST,
              `Invalid number for ${key}: received ${JSON.stringify(value)}`,
            );
          }
          value = n;
          break;
        }
        case 'boolean':
          value = value === true || value === 'true' || value === 1 || value === '1';
          break;
        default:
          break;
      }
    }
    const prev = await this.prisma.systemSetting.findUnique({ where: { key } });
    const row = await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    await this.audit.write({
      actorId,
      action: 'setting.update',
      targetType: 'systemSetting',
      targetId: key,
      payload: { prev: prev?.value ?? null, next: row.value },
    });
    return { key: row.key, value: row.value, updatedAt: row.updatedAt };
  }
}
