import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { OtpPurpose } from './otp.service';

class SendOtpDto {
  /** 统一字段名 phone；兼容旧客户端 phoneNumber */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[0-9]{9,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone!: string;
}

class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class SendEmailOtpDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty()
  email!: string;

  @IsOptional()
  @IsIn(['login', 'register', 'reset'])
  purpose?: OtpPurpose;
}

class VerifyEmailOtpDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty()
  email!: string;
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class RegisterEmailDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty()
  email!: string;

  /** 登录账号（3–24 位字母数字下划线）；内测必填 */
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_]{3,24}$/, {
    message: 'Tài khoản 3–24 ký tự (chữ/số/_)',
  })
  username!: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu ít nhất 6 ký tự' })
  password!: string;

  /**
   * 公测预留：邮箱验证码激活注册时传入。
   * 内测可不传（直接邮箱+账号+密码注册）。
   */
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  nickname?: string;
}

class LoginPasswordDto {
  /** 账号或邮箱（推荐） */
  @IsOptional()
  @IsString()
  account?: string;

  /** 兼容旧客户端仅传 email */
  @IsOptional()
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email?: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty()
  email!: string;
}

class ResetPasswordDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu mới ít nhất 6 ký tự' })
  password!: string;
}

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 鉴权通道状态（前台按此开关展示；公测时管理员配好 SMTP/SMS 并打开开关即可）。
   * 内测：password 登录/注册；forgot 走邮箱重置码。
   * 公测预留：emailOtp / phoneOtp。
   */
  @SkipThrottle()
  @Get('channels')
  authChannels() {
    return ok(this.auth.getAuthChannels());
  }

  // —— 公测预留：手机 OTP 登录（管理员配置 SMS 并打开 AUTH_PHONE_OTP_ENABLED 后启用）——
  /**
   * 发送手机 OTP：1 分钟 1 次 + 1 小时 10 次
   */
  @Throttle({
    otp: { limit: 1, ttl: 60_000 },
    'otp-hour': { limit: 10, ttl: 3_600_000 },
  })
  @Post('phone-number/send-otp')
  async sendOtp(@Body() body: any) {
    const phone = String(body?.phone || body?.phoneNumber || '').trim();
    const purpose = (body?.purpose || 'login') as OtpPurpose;
    const r = await this.auth.sendPhoneOtp(phone, purpose);
    return ok(r, 'OTP đã gửi');
  }

  @Post('phone-number/verify')
  async verifyOtp(
    @Body() body: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const phone = String(body?.phone || body?.phoneNumber || '').trim();
    const code = String(body?.code || '').trim();
    const purpose = (body?.purpose || 'login') as OtpPurpose;
    const result = await this.auth.verifyPhoneOtp(phone, code, purpose);
    this.setSessionCookie(res, result.token);
    return ok(result, 'Đăng nhập thành công');
  }

  // —— 公测预留：邮箱 OTP（登录/注册激活）；找回密码内测已启用 ——
  @Post('email/send-otp')
  @Throttle({
    otp: { limit: 1, ttl: 60_000 },
    'otp-hour': { limit: 10, ttl: 3_600_000 },
  })
  async sendEmailOtp(@Body() dto: SendEmailOtpDto) {
    const purpose = dto.purpose || 'login';
    const r = await this.auth.sendEmailOtp(dto.email, purpose);
    return ok(
      r,
      r.mailed ? 'OTP đã gửi tới email' : 'OTP đã tạo (SMTP chưa配置，见控制台/devCode)',
    );
  }

  @Post('email/verify')
  async verifyEmailOtp(
    @Body() dto: VerifyEmailOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyEmailOtp(dto.email, dto.code);
    this.setSessionCookie(res, result.token);
    return ok(result, 'Đăng nhập thành công');
  }

  /** 内测：邮箱 + 账号 + 密码（无需验证码）。公测可传 code 做邮箱激活。 */
  @Post('email/register')
  async registerEmail(
    @Body() dto: RegisterEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.registerEmail(dto);
    this.setSessionCookie(res, result.token);
    return ok(result, 'Đăng ký thành công');
  }

  /** 内测：账号或邮箱 + 密码登录 */
  @Post('email/login')
  async loginPassword(
    @Body() dto: LoginPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const account = String(dto.account || dto.email || '').trim();
    const result = await this.auth.loginWithPassword(account, dto.password);
    this.setSessionCookie(res, result.token);
    return ok(result, 'Đăng nhập thành công');
  }

  @Post('email/forgot')
  @Throttle({
    otp: { limit: 1, ttl: 60_000 },
    'otp-hour': { limit: 10, ttl: 3_600_000 },
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const r = await this.auth.forgotPassword(dto.email);
    return ok(
      r,
      r.mailed ? 'Mã đặt lại đã gửi tới email' : 'Mã đặt lại đã tạo (SMTP chưa配置，见控制台/devCode)',
    );
  }

  @Post('email/reset')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.resetPassword(dto);
    this.setSessionCookie(res, result.token);
    return ok(result, 'Đặt lại mật khẩu thành công');
  }

  @Post('sign-out')
  @UseGuards(AuthGuard)
  async signOut(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.signOut(user.userId, (req as any).sessionId);
    res.clearCookie(this.auth.getCookieName(), { path: '/' });
    return ok({ success: true });
  }

  /** 未登录返回 data:null（HTTP 200），避免前端每次打开页面都打红 console */
  @Get('session')
  async session(@Req() req: Request) {
    const token = this.extractToken(req);
    if (!token) return ok(null);
    const payload = this.sessions.verify(token);
    if (!payload) return ok(null);
    const sess = await this.prisma.session.findUnique({ where: { id: payload.sessionId } });
    if (!sess || sess.expiresAt < new Date()) return ok(null);
    const profile = await this.auth.getSession(BigInt(payload.userId));
    return ok(profile);
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(this.auth.getCookieName(), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 3600 * 1000,
      path: '/',
    });
  }

  private extractToken(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    const name = this.auth.getCookieName();
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === name) {
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
    return undefined;
  }
}
