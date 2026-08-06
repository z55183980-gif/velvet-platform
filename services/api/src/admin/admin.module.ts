import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminCaptchaService } from './admin-captcha.service';
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
import { RedeemModule } from '../redeem/redeem.module';
import { AdminOpsService } from './ops.service';
import { DashboardController } from './dashboard.controller';
import { ContentController } from './content.controller';
import { UsersController } from './users.controller';
import { OrdersController } from './orders.controller';
import { FinanceController } from './finance.controller';
import { CreatorsController } from './creators.controller';
import { OpsController } from './ops.controller';
import { SettingsController } from './settings.controller';
import { AdminNotificationsController } from './notifications.controller';
import { YtdlpProvider } from './ytdlp.provider';
import { YtdlpImportService } from './ytdlp-import.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [WalletModule, ExchangeModule, ReconcileModule, AuthModule, RedeemModule, UploadModule],
  controllers: [
    AdminAuthController,
    AdminAuditController,
    DashboardController,
    ContentController,
    UsersController,
    OrdersController,
    FinanceController,
    CreatorsController,
    OpsController,
    SettingsController,
    AdminNotificationsController,
  ],
  providers: [
    AdminService,
    AdminAuthService,
    AdminCaptchaService,
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
    AdminOpsService,
    YtdlpProvider,
    YtdlpImportService,
  ],
  exports: [
    AdminService,
    AdminAuthService,
    AdminGuard,
    AdminRoleGuard,
    YtdlpProvider,
  ],
})
export class AdminModule {}
