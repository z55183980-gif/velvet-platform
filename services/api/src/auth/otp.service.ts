import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BizException, BizCode } from '../common/biz.exception';
import { EphemeralKv } from '../common/ephemeral-kv';
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
 * Atomic OTP verify via Redis Lua (GET + compare + DEL/SET in one round-trip).
 * Production requires Redis; Map is local/dev only.
 */
const VERIFY_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'missing'} end
local entry = cjson.decode(raw)
local now = tonumber(ARGV[1])
local code = ARGV[2]
local maxFails = tonumber(ARGV[3])
local lockMs = tonumber(ARGV[4])
if entry['lockedUntil'] and tonumber(entry['lockedUntil']) > now then
  return {'locked', tostring(entry['lockedUntil'])}
end
if tonumber(entry['expiresAt']) < now then
  redis.call('DEL', KEYS[1])
  return {'expired'}
end
if tostring(entry['code']) == code then
  redis.call('DEL', KEYS[1])
  return {'ok'}
end
local failCount = tonumber(entry['failCount'] or 0) + 1
entry['failCount'] = failCount
local lockedUntil = tonumber(entry['lockedUntil'] or 0)
if failCount >= maxFails then
  lockedUntil = now + lockMs
  entry['lockedUntil'] = lockedUntil
end
local exp = tonumber(entry['expiresAt'])
local ttlMs = math.max(exp, lockedUntil) - now
local ttl = math.max(1, math.ceil(ttlMs / 1000))
redis.call('SET', KEYS[1], cjson.encode(entry), 'EX', ttl)
if failCount >= maxFails then
  return {'locked_max'}
end
return {'bad'}
`;

@Injectable()
export class OtpService implements OnModuleDestroy {
  private readonly kv: EphemeralKv;
  private readonly ttlMs: number;
  private readonly length: number;
  private readonly maxFails = 5;
  private readonly lockMs = 15 * 60 * 1000;

  constructor(config: ConfigService) {
    this.ttlMs = (config.get<number>('OTP_TTL_SECONDS') || 300) * 1000;
    this.length = config.get<number>('OTP_LENGTH') || 6;
    this.kv = new EphemeralKv(config, 'otp');
  }

  async onModuleDestroy() {
    await this.kv.quit();
  }

  private key(channel: OtpChannel, identity: string, purpose: OtpPurpose = 'login') {
    return `${channel}:${purpose}:${identity.trim().toLowerCase()}`;
  }

  private async read(k: string): Promise<OtpEntry | null> {
    const raw = await this.kv.get(k);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OtpEntry;
    } catch {
      return null;
    }
  }

  private async write(k: string, entry: OtpEntry) {
    const ttlSec = Math.max(
      1,
      Math.ceil(
        (Math.max(entry.expiresAt, entry.lockedUntil || 0) - Date.now()) / 1000,
      ),
    );
    await this.kv.set(k, JSON.stringify(entry), ttlSec);
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
    if (this.kv.backend === 'redis') {
      return this.verifyRedis(k, code);
    }
    return this.verifyMemory(k, code);
  }

  private async verifyRedis(k: string, code: string): Promise<boolean> {
    const result = (await this.kv.eval(VERIFY_LUA, [k], [
      Date.now(),
      String(code),
      this.maxFails,
      this.lockMs,
    ])) as string[];
    const status = result?.[0];
    if (status === 'ok') return true;
    if (status === 'locked' || status === 'locked_max') {
      throw new BizException(
        BizCode.OTP_LOCKED,
        status === 'locked_max' ? 'auth.otpLockedMaxFails' : 'auth.otpLocked',
      );
    }
    return false;
  }

  private async verifyMemory(k: string, code: string): Promise<boolean> {
    // Single-process local only — still delete-on-success before returning.
    const entry = await this.read(k);
    if (!entry) return false;
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
      throw new BizException(BizCode.OTP_LOCKED, 'auth.otpLocked');
    }
    if (Date.now() > entry.expiresAt) {
      await this.kv.del(k);
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
    await this.kv.del(k);
    return true;
  }
}
