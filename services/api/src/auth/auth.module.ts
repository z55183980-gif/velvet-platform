import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { JwtService } from '../common/jwt.service';
import { AuthGuard } from './auth.guard';
import { MailerService } from '../common/mailer.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, OtpService, SessionService, JwtService, AuthGuard, MailerService],
  exports: [AuthService, SessionService, JwtService, OtpService, AuthGuard, MailerService],
})
export class AuthModule {}