import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BizException, BizCode } from '../common/biz.exception';

export type OtpChannel = 'phone' | 'email';
export type OtpPurpose = 'login' | 'register' | 'reset';

interface OtpEntry {
  code: string;
  expiresAt: number;
  failCount: number;
  lockedUntil?: number;
}

/**
 * OTP 存储（开发态：内存）。
 * 键：channel:purpose:identity
 * 生产：短信/邮件网关 + Redis，TTL 由 OTP_TTL_SECONDS 控制。
 * 错码 ≥5 次锁定 15 分钟。
 */
@Injectable()
export class OtpService {
  private readonly store = new Map<string, OtpEntry>();
  private readonly ttl: number;
  private readonly length: number;
  private readonly maxFails = 5;
  private readonly lockMs = 15 * 60 * 1000;

  constructor(config: ConfigService) {
    this.ttl = (config.get<number>('OTP_TTL_SECONDS') || 300) * 1000;
    this.length = config.get<number>('OTP_LENGTH') || 6;
  }

  private key(channel: OtpChannel, identity: string, purpose: OtpPurpose = 'login') {
    return `${channel}:${purpose}:${identity.trim().toLowerCase()}`;
  }

  generate(
    channel: OtpChannel,
    identity: string,
    purpose: OtpPurpose = 'login',
  ): { code: string; expiresInSec: number } {
    const k = this.key(channel, identity, purpose);
    const existing = this.store.get(k);
    if (existing?.lockedUntil && Date.now() < existing.lockedUntil) {
      const remain = Math.ceil((existing.lockedUntil - Date.now()) / 1000);
      throw new BizException(BizCode.OTP_LOCKED, 'auth.otpLockedRetry', undefined, {
        sec: remain,
      });
    }
    const code = Array.from({ length: this.length }, () =>
      Math.floor(Math.random() * 10),
    ).join('');
    this.store.set(k, {
      code,
      expiresAt: Date.now() + this.ttl,
      failCount: existing?.failCount || 0,
      lockedUntil: existing?.lockedUntil,
    });
    // eslint-disable-next-line no-console
    console.log(`[DEV OTP] ${channel}/${purpose}=${identity} code=${code}`);
    return { code, expiresInSec: this.ttl / 1000 };
  }

  verify(
    channel: OtpChannel,
    identity: string,
    code: string,
    purpose: OtpPurpose = 'login',
  ): boolean {
    const k = this.key(channel, identity, purpose);
    const entry = this.store.get(k);
    if (!entry) return false;
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
      throw new BizException(BizCode.OTP_LOCKED, 'auth.otpLocked');
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(k);
      return false;
    }
    if (entry.code !== code) {
      entry.failCount += 1;
      if (entry.failCount >= this.maxFails) {
        entry.lockedUntil = Date.now() + this.lockMs;
        this.store.set(k, entry);
        throw new BizException(BizCode.OTP_LOCKED, 'auth.otpLockedMaxFails');
      }
      this.store.set(k, entry);
      return false;
    }
    this.store.delete(k);
    return true;
  }
}
