import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { UploadModule } from './upload/upload.module';

/**
 * Lean worker context: BullMQ transcode consumer only.
 * Do NOT import ScheduleModule / ReconcileModule — avoids dual T+7 / reconcile crons with the API process.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    UploadModule,
  ],
})
export class WorkerModule {}
