import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { ExchangeController } from './exchange.controller';
import { PackagesService } from '../packages/packages.service';

@Module({
  controllers: [ExchangeController],
  providers: [ExchangeService, PackagesService],
  exports: [ExchangeService, PackagesService],
})
export class ExchangeModule {}
