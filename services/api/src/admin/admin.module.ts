import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { AdminAuditController } from './audit.controller';
import { WalletModule } from '../wallet/wallet.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { ReconcileModule } from '../reconcile/reconcile.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardService } from './dashboard.service';
import { ContentService } from './content.service';
import { AdminUsersService } from './users.service';
import { AdminOrdersService } from './orders.service';
import { AdminWalletService } from './wallet.service';
import { AdminRefundService } from './refund.service';
import { KycService } from './kyc.service';
import { AdminWithdrawsService } from './withdraws.service';
import { AdminCreatorsService } from './creators.service';
import { SettingsService } from './settings.service';
import { AdminEpisodesService } from './episodes.service';
import { AdminsService } from './admins.service';
import { AdminExportService } from './export.service';

@Module({
  imports: [WalletModule, ExchangeModule, ReconcileModule, AuthModule],
  controllers: [AdminAuthController, AdminController, AdminAuditController],
  providers: [
    AdminService,
    AdminAuthService,
    AdminGuard,
    AdminRoleGuard,
    DashboardService,
    ContentService,
    AdminUsersService,
    AdminOrdersService,
    AdminWalletService,
    AdminRefundService,
    KycService,
    AdminWithdrawsService,
    AdminCreatorsService,
    SettingsService,
    AdminEpisodesService,
    AdminsService,
    AdminExportService,
  ],
  exports: [
    AdminService,
    AdminAuthService,
    AdminGuard,
    AdminRoleGuard,
  ],
})
export class AdminModule {}
