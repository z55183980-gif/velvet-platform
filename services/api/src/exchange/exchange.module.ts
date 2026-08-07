import { Module } from '@nestjs/common';
import { ExchangeController } from './exchange.controller';
import { PackagesService } from '../packages/packages.service';
import { VipPlansService } from '../vip/vip-plans.service';

@Module({
  controllers: [ExchangeController],
  providers: [PackagesService, VipPlansService],
  exports: [PackagesService, VipPlansService],
})
export class ExchangeModule {}
