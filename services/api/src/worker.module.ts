import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { StorageModule } from './storage/storage.module';
import { UploadModule } from './upload/upload.module';

/**
 * Lean worker context: BullMQ transcode consumer only.
 * Do NOT import ScheduleModule / ReconcileModule — avoids dual T+7 / reconcile crons with the API process.
 * CommonModule is required because UploadModule → CreatorModule depends on global shared services.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    StorageModule,
    UploadModule,
  ],
})
export class WorkerModule {}
