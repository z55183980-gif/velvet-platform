import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { isWorkerProcess, readRedisUrl } from './upload/transcode.queue';

/**
 * Dedicated transcode worker (no HTTP).
 * Start with: VELVET_PROCESS=worker REDIS_URL=redis://... node dist/worker.js
 */
async function bootstrap() {
  process.env.VELVET_PROCESS = process.env.VELVET_PROCESS || 'worker';
  const logger = new Logger('TranscodeWorker');

  if (!readRedisUrl()) {
    logger.error('REDIS_URL is required for velvet-worker');
    process.exit(1);
  }
  if (!isWorkerProcess()) {
    process.env.VELVET_PROCESS = 'worker';
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  logger.log('velvet-worker ready (BullMQ consumer)');

  const shutdown = async (signal: string) => {
    logger.log(`shutting down on ${signal}`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
