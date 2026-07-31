import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { EventsController } from './events.controller';

@Module({
  imports: [CommonModule],
  controllers: [EventsController],
})
export class EventsModule {}
