import { ThrottlerModuleOptions, seconds } from '@nestjs/throttler';

/**
 * 仅注册全局桶。OTP/auth/webhook 的更严限额用路由级 @Throttle({ global: {...} }) 覆盖。
 * 切勿把 otp(1/min) 等严桶放进 forRoot——Nest 会对每个路由应用全部命名桶。
 */
export const defaultThrottlerConfig: ThrottlerModuleOptions = [
  {
    name: 'global',
    ttl: seconds(300),
    limit: 60,
  },
];

/** @SkipThrottle 必须显式跳过已注册的命名桶 */
export const SKIP_ALL_THROTTLES = { global: true } as const;
