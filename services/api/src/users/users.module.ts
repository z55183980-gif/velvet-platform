import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [AuthModule, UploadModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
