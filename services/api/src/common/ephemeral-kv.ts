import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { createRedisConnection, readRedisUrl } from '../upload/transcode.queue';
import { isProductionEnv } from './security-config';

/**
 * Short-lived KV for OTP / CAPTCHA / OAuth state.
 * Production (and any multi-replica deploy) requires Redis; in-process Map is
 * only for explicit single-process local/dev when REDIS_URL is unset.
 */
export class EphemeralKv {
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();
  readonly redis: IORedis | null;
  readonly backend: 'redis' | 'memory';

  constructor(
    config: ConfigService,
    private readonly namespace: string,
  ) {
    const url = readRedisUrl(config);
    if (url) {
      this.redis = createRedisConnection(config);
      this.backend = 'redis';
      return;
    }
    if (isProductionEnv()) {
      throw new Error(
        `[security] REDIS_URL is required in production for ${namespace} (multi-replica safe store)`,
      );
    }
    this.redis = null;
    this.backend = 'memory';
  }

  async quit() {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch {
      /* ignore */
    }
  }

  private k(key: string) {
    return `${this.namespace}:${key}`;
  }

  private pruneMemory(now = Date.now()) {
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt <= now) this.memory.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    const k = this.k(key);
    if (this.redis) {
      return this.redis.get(k);
    }
    this.pruneMemory();
    const entry = this.memory.get(k);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(k);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    const k = this.k(key);
    const ttl = Math.max(1, Math.ceil(ttlSec));
    if (this.redis) {
      await this.redis.set(k, value, 'EX', ttl);
      return;
    }
    this.pruneMemory();
    this.memory.set(k, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async del(key: string): Promise<void> {
    const k = this.k(key);
    if (this.redis) {
      await this.redis.del(k);
      return;
    }
    this.memory.delete(k);
  }

  /** Atomic get-and-delete (Lua GET+DEL; memory equivalent). */
  async getdel(key: string): Promise<string | null> {
    const k = this.k(key);
    if (this.redis) {
      // Lua works on Redis versions without native GETDEL.
      const result = await this.redis.eval(
        "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
        1,
        k,
      );
      return (result as string | null) ?? null;
    }
    this.pruneMemory();
    const entry = this.memory.get(k);
    if (!entry) return null;
    this.memory.delete(k);
    if (entry.expiresAt <= Date.now()) return null;
    return entry.value;
  }

  /**
   * Run a Lua script against Redis. Throws if backend is memory
   * (callers should branch for local Map path).
   */
  async eval(
    script: string,
    keys: string[],
    args: Array<string | number>,
  ): Promise<unknown> {
    if (!this.redis) {
      throw new Error('EphemeralKv.eval requires Redis backend');
    }
    const fullKeys = keys.map((key) => this.k(key));
    return this.redis.eval(script, fullKeys.length, ...fullKeys, ...args);
  }
}
