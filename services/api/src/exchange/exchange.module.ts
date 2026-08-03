import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { ExchangeController } from './exchange.controller';
import { PackagesService } from '../packages/packages.service';
import { VipPlansService } from '../vip/vip-plans.service';

@Module({
  controllers: [ExchangeController],
  providers: [ExchangeService, PackagesService, VipPlansService],
  exports: [ExchangeService, PackagesService, VipPlansService],
})
export class ExchangeModule {}
