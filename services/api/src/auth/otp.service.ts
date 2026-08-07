import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import IORedis from 'ioredis';
import { BizException, BizCode } from '../common/biz.exception';
import { createRedisConnection, readRedisUrl } from '../upload/transcode.queue';
import { isProductionEnv } from '../common/security-config';

export type OtpChannel = 'phone' | 'email';
export type OtpPurpose = 'login' | 'register' | 'reset';

interface OtpEntry {
  code: string;
  expiresAt: number;
  failCount: number;
  lockedUntil?: number;
}

/**
 * OTP 存储：有 REDIS_URL 时用 Redis；否则内存 Map（仅本地）。
 * 错码 ≥5 次锁定 15 分钟。生产禁止打印验证码。
 */
@Injectable()
export class OtpService implements OnModuleDestroy {
  private readonly store = new Map<string, OtpEntry>();
  private readonly redis: IORedis | null;
  private readonly ttlMs: number;
  private readonly length: number;
  private readonly maxFails = 5;
  private readonly lockMs = 15 * 60 * 1000;

  constructor(config: ConfigService) {
    this.ttlMs = (config.get<number>('OTP_TTL_SECONDS') || 300) * 1000;
    this.length = config.get<number>('OTP_LENGTH') || 6;
    this.redis = readRedisUrl(config) ? createRedisConnection(config) : null;
    if (isProductionEnv() && !this.redis) {
      // eslint-disable-next-line no-console
      console.warn('[otp] REDIS_URL missing in production — OTP store is process-local');
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        /* ignore */
      }
    }
  }

  private key(channel: OtpChannel, identity: string, purpose: OtpPurpose = 'login') {
    return `otp:${channel}:${purpose}:${identity.trim().toLowerCase()}`;
  }

  private async read(k: string): Promise<OtpEntry | null> {
    if (this.redis) {
      const raw = await this.redis.get(k);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as OtpEntry;
      } catch {
        return null;
      }
    }
    return this.store.get(k) || null;
  }

  private async write(k: string, entry: OtpEntry) {
    if (this.redis) {
      const ttlSec = Math.max(
        1,
        Math.ceil(
          (Math.max(entry.expiresAt, entry.lockedUntil || 0) - Date.now()) / 1000,
        ),
      );
      await this.redis.set(k, JSON.stringify(entry), 'EX', ttlSec);
      return;
    }
    this.store.set(k, entry);
  }

  private async del(k: string) {
    if (this.redis) {
      await this.redis.del(k);
      return;
    }
    this.store.delete(k);
  }

  async generate(
    channel: OtpChannel,
    identity: string,
    purpose: OtpPurpose = 'login',
  ): Promise<{ code: string; expiresInSec: number }> {
    const k = this.key(channel, identity, purpose);
    const existing = await this.read(k);
    if (existing?.lockedUntil && Date.now() < existing.lockedUntil) {
      const remain = Math.ceil((existing.lockedUntil - Date.now()) / 1000);
      throw new BizException(BizCode.OTP_LOCKED, 'auth.otpLockedRetry', undefined, {
        sec: remain,
      });
    }
    const code = Array.from({ length: this.length }, () =>
      crypto.randomInt(0, 10),
    ).join('');
    const entry: OtpEntry = {
      code,
      expiresAt: Date.now() + this.ttlMs,
      failCount: existing?.failCount || 0,
      lockedUntil: existing?.lockedUntil,
    };
    await this.write(k, entry);
    if (!isProductionEnv()) {
      // eslint-disable-next-line no-console
      console.log(`[DEV OTP] ${channel}/${purpose}=${identity} code=${code}`);
    }
    return { code, expiresInSec: this.ttlMs / 1000 };
  }

  async verify(
    channel: OtpChannel,
    identity: string,
    code: string,
    purpose: OtpPurpose = 'login',
  ): Promise<boolean> {
    const k = this.key(channel, identity, purpose);
    const entry = await this.read(k);
    if (!entry) return false;
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
      throw new BizException(BizCode.OTP_LOCKED, 'auth.otpLocked');
    }
    if (Date.now() > entry.expiresAt) {
      await this.del(k);
      return false;
    }
    if (entry.code !== code) {
      entry.failCount += 1;
      if (entry.failCount >= this.maxFails) {
        entry.lockedUntil = Date.now() + this.lockMs;
        await this.write(k, entry);
        throw new BizException(BizCode.OTP_LOCKED, 'auth.otpLockedMaxFails');
      }
      await this.write(k, entry);
      return false;
    }
    await this.del(k);
    return true;
  }
}
