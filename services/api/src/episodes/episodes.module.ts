import { Module } from '@nestjs/common';
import { EpisodesService } from './episodes.service';
import { EpisodesController } from './episodes.controller';
import { AdminModule } from '../admin/admin.module';
import { DramasModule } from '../dramas/dramas.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DramasModule, AuthModule, AdminModule],
  controllers: [EpisodesController],
  providers: [EpisodesService],
})
export class EpisodesModule {}
