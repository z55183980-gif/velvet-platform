import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module';
import { BigIntInterceptor } from './common/bigint.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { assertProductionSecrets } from './common/security-config';

async function bootstrap() {
  assertProductionSecrets();
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  expressApp.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  // Behind Cloudflare / nginx so req.ip uses X-Forwarded-For
  expressApp.set('trust proxy', 1);

  app.setGlobalPrefix('api'); // → /api/auth/*, /api/v1/*

  // 支付宝回调为 form-urlencoded；上传走 multipart（multer）。
  // Webhook 路径保留原始 bytes，供 Stripe-Signature HMAC 校验。
  app.use(
    json({
      limit: '2mb',
      verify: (req: any, _res, buf) => {
        const url = String(req.originalUrl || req.url || '');
        if (url.includes('/webhooks/') && Buffer.isBuffer(buf) && buf.length) {
          req.rawBody = buf;
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalInterceptors(new BigIntInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({ origin: origins, credentials: true });

  const port = parseInt(process.env.PORT || '4000', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 Velvet API listening on http://localhost:${port} (prefix /api)`);
}

bootstrap();
