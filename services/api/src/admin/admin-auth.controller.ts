import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { AdminAuthService } from './admin-auth.service';
import { AdminCaptchaService } from './admin-captcha.service';
import { AdminGuard } from './admin.guard';
import { ok } from '../common/response';
import { BizException, BizCode } from '../common/biz.exception';

class LoginDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  username?: string;

  /** 邮箱或用户名（二选一，与 email/username 兼容） */
  @IsOptional()
  @IsString()
  account?: string;

  @IsNotEmpty()
  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  captchaId?: string;

  @IsOptional()
  @IsString()
  captchaCode?: string;
}

class BootstrapDto {
  @IsNotEmpty()
  @IsString()
  email!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  password!: string;

  @IsOptional()
  @IsString()
  username?: string;
}

class PasswordDto {
  @IsNotEmpty()
  @IsString()
  oldPassword!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  newPassword!: string;
}

class ProfileDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

@Controller('v1/admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly captcha: AdminCaptchaService,
  ) {}

  @Get('captcha')
  async captchaChallenge() {
    return ok(this.captcha.issue());
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    this.captcha.verify(dto.captchaId || '', dto.captchaCode || '');
    const account = dto.account || dto.email || dto.username || '';
    const result = await this.auth.login(account, dto.password);
    this.setCookie(res, result.token);
    return ok(result);
  }

  @Post('bootstrap')
  async bootstrap(@Body() dto: BootstrapDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.bootstrap({
      email: dto.email,
      password: dto.password,
      username: dto.username,
    });
    this.setCookie(res, result.token);
    return ok(result);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  async me(@Req() req: any) {
    const adminId = req.adminId as bigint | undefined;
    if (!adminId) {
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.loginRequired');
    }
    return ok(await this.auth.me(adminId));
  }

  @Post('logout')
  @UseGuards(AdminGuard)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(this.auth.getCookieName(), { path: '/' });
    return ok({ success: true });
  }

  @Patch('password')
  @UseGuards(AdminGuard)
  async password(@Req() req: any, @Body() dto: PasswordDto) {
    const adminId = req.adminId as bigint | undefined;
    if (!adminId) {
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.loginRequired');
    }
    return ok(await this.auth.changePassword(adminId, dto.oldPassword, dto.newPassword));
  }

  @Patch('profile')
  @UseGuards(AdminGuard)
  async profile(@Req() req: any, @Body() dto: ProfileDto) {
    const adminId = req.adminId as bigint | undefined;
    if (!adminId) {
      throw new BizException(BizCode.UNAUTHORIZED, 'admin.loginRequired');
    }
    return ok(
      await this.auth.updateProfile(adminId, {
        email: dto.email,
        username: dto.username,
        displayName: dto.displayName,
      }),
    );
  }

  private setCookie(res: Response, token: string) {
    res.cookie(this.auth.getCookieName(), token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600 * 1000,
    });
  }
}
