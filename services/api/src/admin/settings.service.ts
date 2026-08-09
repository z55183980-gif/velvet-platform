import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { BizException, BizCode } from '../common/biz.exception';
import { isLockAccessMode, LockAccessService } from '../common/lock-access.service';
import { STRIPE_GATEWAY_SETTING_KEY } from '../payments/stripe-gateway.constants';

const DEFAULT_KEYS: {
  key: string;
  value: any;
  labelEn: string;
  labelZh: string;
  type: 'number' | 'boolean' | 'string' | 'json';
}[] = [
  // —— 通用 ——
  {
    key: 'siteName',
    value: 'Velvet',
    labelEn: 'Site name',
    labelZh: '站点名称',
    type: 'string',
  },
  {
    key: 'supportEmail',
    value: 'support@velvetmovie.space',
    labelEn: 'Support email',
    labelZh: '客服邮箱',
    type: 'string',
  },
  {
    key: 'supportUrl',
    value: '',
    labelEn: 'Support URL',
    labelZh: '客服链接',
    type: 'string',
  },
  {
    key: 'termsUrl',
    value: '/terms',
    labelEn: 'Terms of service URL',
    labelZh: '用户协议链接',
    type: 'string',
  },
  {
    key: 'privacyUrl',
    value: '/privacy',
    labelEn: 'Privacy policy URL',
    labelZh: '隐私政策链接',
    type: 'string',
  },
  {
    key: 'maintenanceMode',
    value: false,
    labelEn: 'Maintenance mode',
    labelZh: '维护模式',
    type: 'boolean',
  },
  {
    key: 'maintenanceMessage',
    value: '',
    labelEn: 'Maintenance message',
    labelZh: '维护提示文案',
    type: 'string',
  },
  // —— 商业规则 ——
  {
    key: 'revenueShareDefault',
    value: 0.7,
    labelEn: 'Default creator revenue share',
    labelZh: '默认创作者分成',
    type: 'number',
  },
  {
    key: 'minWithdrawVnd',
    value: 100000,
    labelEn: 'Minimum withdraw amount',
    labelZh: '最低提现金额',
    type: 'number',
  },
  {
    key: 'pitRate',
    value: 0.05,
    labelEn: 'Withdraw PIT rate',
    labelZh: '提现个税税率',
    type: 'number',
  },
  {
    key: 'creatorSettleDays',
    value: 7,
    labelEn: 'Creator earnings settle window (days)',
    labelZh: '创作者收益结算窗口（天）',
    type: 'number',
  },
  // —— 播放策略 ——
  {
    key: 'episodeLockMode',
    value: 'FREE_FIRST_N',
    labelEn: 'Episode lock mode (global)',
    labelZh: '剧集加锁策略（全局）',
    type: 'string',
  },
  {
    key: 'defaultFreeEpisodes',
    value: 3,
    labelEn: 'Default free episode count',
    labelZh: '默认免费集数',
    type: 'number',
  },
  {
    key: 'defaultPreviewSeconds',
    value: 0,
    labelEn: 'Default preview seconds (paid episodes)',
    labelZh: '默认试看秒数（付费集）',
    type: 'number',
  },
  {
    key: 'defaultPriceCredits',
    value: 10,
    labelEn: 'Default credits per paid episode',
    labelZh: '默认单集积分价',
    type: 'number',
  },
  {
    key: 'defaultBuyoutDiscountPercent',
    value: 70,
    labelEn: 'Full-drama buyout discount (1–100%, 0=off)',
    labelZh: '全集买断折扣（1–100%，0=关闭）',
    type: 'number',
  },
];

const ALLOWED_KEYS = new Set(DEFAULT_KEYS.map((d) => d.key));
/** Keys owned by other admin modules — keep in DB, never list in generic settings UI. */
const INTERNAL_SETTING_KEYS = new Set([STRIPE_GATEWAY_SETTING_KEY]);
const PRESERVED_KEYS = new Set([...ALLOWED_KEYS, ...INTERNAL_SETTING_KEYS]);

function clampRate(n: number) {
  return Math.min(1, Math.max(0, n));
}

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lockAccess: LockAccessService,
  ) {}

  async onModuleInit() {
    await this.prisma.systemSetting.deleteMany({
      where: { key: { notIn: [...PRESERVED_KEYS] } },
    });
  }

  async list() {
    const stored = await this.prisma.systemSetting.findMany({
      where: { key: { in: [...ALLOWED_KEYS] } },
    });
    const map = new Map(stored.map((s) => [s.key, s]));
    const items = DEFAULT_KEYS.map((d) => {
      const row = map.get(d.key);
      return {
        key: d.key,
        labelEn: d.labelEn,
        labelZh: d.labelZh,
        type: d.type,
        value: row ? row.value : d.value,
        updatedAt: row?.updatedAt ?? null,
      };
    });
    return { items };
  }

  async update(key: string, value: any, actorId?: bigint) {
    const known = DEFAULT_KEYS.find((d) => d.key === key);
    if (!known) {
      throw new BizException(BizCode.BAD_REQUEST, `Unknown setting key: ${key}`);
    }
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
      case 'string':
        value = String(value ?? '').trim();
        break;
      default:
        break;
    }
    if (key === 'episodeLockMode' && !isLockAccessMode(value)) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        'episodeLockMode must be FREE_FIRST_N | VIP_ALL | ALL_FREE',
      );
    }
    if (
      key === 'defaultFreeEpisodes' ||
      key === 'defaultPreviewSeconds' ||
      key === 'minWithdrawVnd' ||
      key === 'defaultPriceCredits'
    ) {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n < 0) {
        throw new BizException(BizCode.BAD_REQUEST, `${key} must be >= 0`);
      }
      if (key === 'defaultPriceCredits' && n < 1) {
        throw new BizException(BizCode.BAD_REQUEST, 'defaultPriceCredits must be >= 1');
      }
      value = n;
    }
    if (key === 'creatorSettleDays') {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n < 0 || n > 365) {
        throw new BizException(BizCode.BAD_REQUEST, 'creatorSettleDays must be 0–365');
      }
      value = n;
    }
    if (key === 'defaultBuyoutDiscountPercent') {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new BizException(
          BizCode.BAD_REQUEST,
          'defaultBuyoutDiscountPercent must be 0–100 (0 disables buyout)',
        );
      }
      value = n;
    }
    if (key === 'revenueShareDefault' || key === 'pitRate') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new BizException(BizCode.BAD_REQUEST, `${key} must be between 0 and 1`);
      }
      value = clampRate(n);
    }
    if (key === 'supportEmail' && value) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new BizException(BizCode.BAD_REQUEST, 'supportEmail is invalid');
      }
    }
    if ((key === 'siteName' || key === 'maintenanceMessage') && value.length > 200) {
      throw new BizException(BizCode.BAD_REQUEST, `${key} is too long`);
    }
    if (
      (key === 'supportUrl' || key === 'termsUrl' || key === 'privacyUrl') &&
      value.length > 500
    ) {
      throw new BizException(BizCode.BAD_REQUEST, `${key} is too long`);
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

    if (
      key === 'episodeLockMode' ||
      key === 'defaultFreeEpisodes' ||
      key === 'defaultPriceCredits' ||
      key === 'defaultBuyoutDiscountPercent'
    ) {
      await this.cascadeGlobalLockToInheritingDramas();
    }

    return { key: row.key, value: row.value, updatedAt: row.updatedAt };
  }

  /** Keep denormalized freeEpisodeCount + buyoutCredits + episode.isFree in sync for Follow Global dramas. */
  private async cascadeGlobalLockToInheritingDramas() {
    const global = await this.lockAccess.getGlobalPolicy();
    const pricing = await this.prisma.systemSetting.findMany({
      where: { key: { in: ['defaultPriceCredits', 'defaultBuyoutDiscountPercent'] } },
    });
    const priceMap = new Map(pricing.map((r) => [r.key, r.value]));
    const priceCredits = Math.max(1, Math.floor(Number(priceMap.get('defaultPriceCredits')) || 10));
    const discountPercent = Math.min(
      100,
      Math.max(0, Math.floor(Number(priceMap.get('defaultBuyoutDiscountPercent')) || 0)),
    );

    const inheriting = await this.prisma.drama.findMany({
      where: { lockMode: null },
      select: {
        id: true,
        _count: { select: { episodes: true } },
      },
    });
    if (!inheriting.length) return;

    for (const drama of inheriting) {
      const total = drama._count.episodes;
      const freeCount =
        global.mode === 'ALL_FREE'
          ? total
          : global.mode === 'VIP_ALL'
            ? 0
            : Math.min(total, Math.max(0, global.freeCount));
      const paid = Math.max(0, total - freeCount);
      let buyoutCredits: bigint | null = null;
      if (discountPercent >= 1 && paid > 0 && priceCredits > 0) {
        buyoutCredits = BigInt(Math.max(1, Math.ceil((paid * priceCredits * discountPercent) / 100)));
      }

      await this.prisma.drama.update({
        where: { id: drama.id },
        data: {
          freeEpisodeCount: global.freeCount,
          buyoutCredits,
        },
      });
      await this.lockAccess.syncEpisodeAccessFlags(drama.id);
    }
  }
}
