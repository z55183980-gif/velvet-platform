import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PUBLIC_KEYS = [
  'siteName',
  'supportEmail',
  'supportUrl',
  'termsUrl',
  'privacyUrl',
  'maintenanceMode',
  'maintenanceMessage',
  'minWithdrawVnd',
] as const;

const COMMERCIAL_KEYS = [
  'revenueShareDefault',
  'minWithdrawVnd',
  'pitRate',
  'creatorSettleDays',
] as const;

@Injectable()
export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadMap(keys: readonly string[]) {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: [...keys] } },
    });
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  private asString(map: Map<string, unknown>, key: string, fallback: string) {
    const raw = map.get(key);
    if (typeof raw === 'string') return raw;
    if (raw == null) return fallback;
    return String(raw);
  }

  private asNumber(map: Map<string, unknown>, key: string, fallback: number) {
    const n = Number(map.get(key));
    return Number.isFinite(n) ? n : fallback;
  }

  private asBoolean(map: Map<string, unknown>, key: string, fallback: boolean) {
    const raw = map.get(key);
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === 'false' || raw === 0 || raw === '0') return false;
    return fallback;
  }

  async getPublicConfig() {
    const map = await this.loadMap(PUBLIC_KEYS);
    return {
      siteName: this.asString(map, 'siteName', 'Velvet'),
      supportEmail: this.asString(map, 'supportEmail', 'support@velvetmovie.space'),
      supportUrl: this.asString(map, 'supportUrl', ''),
      termsUrl: this.asString(map, 'termsUrl', '/terms'),
      privacyUrl: this.asString(map, 'privacyUrl', '/privacy'),
      maintenanceMode: this.asBoolean(map, 'maintenanceMode', false),
      maintenanceMessage: this.asString(map, 'maintenanceMessage', ''),
      minWithdrawVnd: Math.max(0, Math.floor(this.asNumber(map, 'minWithdrawVnd', 100000))),
    };
  }

  async getCommercialConfig() {
    const map = await this.loadMap(COMMERCIAL_KEYS);
    const share = this.asNumber(map, 'revenueShareDefault', 0.7);
    const pit = this.asNumber(map, 'pitRate', 0.05);
    const settleDays = Math.floor(this.asNumber(map, 'creatorSettleDays', 7));
    return {
      revenueShareDefault: Math.min(1, Math.max(0, share)),
      minWithdrawVnd: Math.max(0, Math.floor(this.asNumber(map, 'minWithdrawVnd', 100000))),
      pitRate: Math.min(1, Math.max(0, pit)),
      creatorSettleDays: Math.min(365, Math.max(0, Number.isFinite(settleDays) ? settleDays : 7)),
    };
  }

  async getRevenueShareDefault() {
    return (await this.getCommercialConfig()).revenueShareDefault;
  }

  async getMinWithdrawVnd() {
    return (await this.getCommercialConfig()).minWithdrawVnd;
  }

  async getPitRate(envFallback = 0.05) {
    const map = await this.loadMap(['pitRate']);
    if (!map.has('pitRate')) return envFallback;
    const pit = this.asNumber(map, 'pitRate', envFallback);
    return Math.min(1, Math.max(0, pit));
  }

  /** Days before pending creator earnings become available (default T+7). */
  async getCreatorSettleDays() {
    return (await this.getCommercialConfig()).creatorSettleDays;
  }
}
