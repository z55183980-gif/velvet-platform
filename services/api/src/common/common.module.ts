import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { StructuredLogger } from './structured-logger.service';
import { LockAccessService } from './lock-access.service';

/**
 * 跨模块共享的服务（审计、结构化日志、限流等）
 * 全局化避免每个 module 都重新 import / provide。
 */
@Global()
@Module({
  providers: [AuditService, StructuredLogger, LockAccessService],
  exports: [AuditService, StructuredLogger, LockAccessService],
})
export class CommonModule {}
