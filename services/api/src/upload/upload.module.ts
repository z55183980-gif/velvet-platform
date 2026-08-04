import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { AuthModule } from '../auth/auth.module';
import { CreatorModule } from '../creator/creator.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuthModule, CreatorModule, StorageModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
