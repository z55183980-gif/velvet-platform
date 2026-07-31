import { ThrottlerModuleOptions, seconds } from '@nestjs/throttler';

/**
 * 全局限流策略（默认 5 分钟 60 次）。
 * - 短突发请求下也够用；
 * - webhook 类接口走专用 Throttle 装饰器覆盖。
 */
export const defaultThrottlerConfig: ThrottlerModuleOptions = [
  {
    name: 'global',
    ttl: seconds(300),
    limit: 60,
  },
];

export const otpThrottlerConfig: ThrottlerModuleOptions = [
  {
    // OTP 发码：1 分钟 1 次 + 1 小时 10 次
    name: 'otp',
    ttl: seconds(60),
    limit: 1,
  },
  {
    name: 'otp-hour',
    ttl: seconds(3600),
    limit: 10,
  },
];

export const webhookThrottlerConfig: ThrottlerModuleOptions = [
  // webhook：单 IP 60 秒内 30 次
  {
    name: 'webhook',
    ttl: seconds(60),
    limit: 30,
  },
];