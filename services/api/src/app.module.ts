import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { defaultThrottlerConfig } from './common/throttler-config';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { DramasModule } from './dramas/dramas.module';
import { EpisodesModule } from './episodes/episodes.module';
import { UsersModule } from './users/users.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { CreatorModule } from './creator/creator.module';
import { ReconcileModule } from './reconcile/reconcile.module';
import { MediaModule } from './media/media.module';
import { ExchangeModule } from './exchange/exchange.module';
import { UploadModule } from './upload/upload.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EventsModule } from './events/events.module';
import { FeedbackModule } from './feedback/feedback.module';
import { HealthController } from './health.controller';
import { SiteConfigController } from './site-config.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot(defaultThrottlerConfig),
    PrismaModule,
    CommonModule,
    AuthModule,
    WalletModule,
    DramasModule,
    EpisodesModule,
    UsersModule,
    PaymentsModule,
    AdminModule,
    CreatorModule,
    ReconcileModule,
    MediaModule,
    ExchangeModule,
    UploadModule,
    NotificationsModule,
    EventsModule,
    FeedbackModule,
  ],
  controllers: [HealthController, SiteConfigController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
