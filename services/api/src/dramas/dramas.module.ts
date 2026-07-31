import { Module } from '@nestjs/common';
import { DramasService } from './dramas.service';
import { DramasController } from './dramas.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DramasController],
  providers: [DramasService],
  exports: [DramasService],
})
export class DramasModule {}
