import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { AuthModule } from '../auth/auth.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { RedeemModule } from '../redeem/redeem.module';

@Module({
  imports: [AuthModule, ExchangeModule, RedeemModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
