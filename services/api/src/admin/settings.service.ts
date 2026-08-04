import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { BizException, BizCode } from '../common/biz.exception';
import { isLockAccessMode } from '../common/lock-access.service';

const DEFAULT_KEYS: {
  key: string;
  value: any;
  labelEn: string;
  labelZh: string;
  type: 'number' | 'boolean' | 'string' | 'json';
}[] = [
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
];

const ALLOWED_KEYS = new Set(DEFAULT_KEYS.map((d) => d.key));

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.prisma.systemSetting.deleteMany({
      where: { key: { notIn: [...ALLOWED_KEYS] } },
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
        value = String(value ?? '');
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
    if (key === 'defaultFreeEpisodes') {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n < 0) {
        throw new BizException(BizCode.BAD_REQUEST, `${key} phải >= 0`);
      }
      value = n;
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
