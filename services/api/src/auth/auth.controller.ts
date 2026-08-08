import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { SKIP_ALL_THROTTLES } from '../common/throttler-config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import { enrichClientMeta, getClientMeta } from '../common/request-meta';
import { tFromAcceptLanguage } from '../common/i18n/translate';
import { BizException } from '../common/biz.exception';
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
import { CaptchaService } from '../common/captcha.service';

class SendOtpDto {
  /** 统一字段名 phone；兼容旧客户端 phoneNumber */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[0-9]{9,15}$/, { message: 'auth.invalidPhone' })
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
  @IsEmail({}, { message: 'auth.invalidEmail' })
  @IsNotEmpty()
  email!: string;

  @IsOptional()
  @IsIn(['login', 'register', 'reset'])
  purpose?: OtpPurpose;
}

class VerifyEmailOtpDto {
  @IsEmail({}, { message: 'auth.invalidEmail' })
  @IsNotEmpty()
  email!: string;
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class RegisterEmailDto {
  @IsEmail({}, { message: 'auth.invalidEmail' })
  @IsNotEmpty()
  email!: string;

  /**
   * 可选。未传时服务端按邮箱本地部分自动生成唯一 username。
   * 登录推荐使用邮箱；username 仍可用于旧账号密码登录。
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,24}$/, {
    message: 'auth.usernameRules',
  })
  username?: string;

  @IsString()
  @MinLength(6, { message: 'auth.passwordMinLength' })
  password!: string;

  /**
   * 公测预留：邮箱验证码激活注册时传入。
   * 内测可不传（直接邮箱+密码注册）。
   */
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  captchaId?: string;

  @IsOptional()
  @IsString()
  captchaCode?: string;
}

class LoginPasswordDto {
  /** 账号或邮箱（推荐） */
  @IsOptional()
  @IsString()
  account?: string;

  /** 兼容旧客户端仅传 email */
  @IsOptional()
  @IsEmail({}, { message: 'auth.invalidEmail' })
  email?: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsString()
  captchaId?: string;

  @IsOptional()
  @IsString()
  captchaCode?: string;
}

class ForgotPasswordDto {
  @IsEmail({}, { message: 'auth.invalidEmail' })
  @IsNotEmpty()
  email!: string;
}

class ResetPasswordDto {
  @IsEmail({}, { message: 'auth.invalidEmail' })
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @MinLength(6, { message: 'auth.newPasswordMinLength' })
  password!: string;
}

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly captcha: CaptchaService,
  ) {}

  /**
   * 鉴权通道状态（前台按此开关展示；公测时管理员配好 SMTP/SMS 并打开开关即可）。
   * 内测：password 登录/注册；forgot 走邮箱重置码。
   * 公测预留：emailOtp / phoneOtp。
   */
  @SkipThrottle(SKIP_ALL_THROTTLES)
  @Get('channels')
  authChannels() {
    return ok(this.auth.getAuthChannels());
  }

  /** Web 登录/注册图形验证码（对齐管理端 SVG captcha） */
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  @Get('captcha')
  captchaChallenge() {
    return ok(this.captcha.issue('web'));
  }

  /** Google OAuth: open in popup → redirect to Google */
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  @Get('google/start')
  googleStart(
    @Query('origin') origin: string | undefined,
    @Query('mode') mode: string | undefined,
    @Query('returnTo') returnTo: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const url = this.auth.beginGoogleOAuth(origin, { mode, returnTo });
      return res.redirect(302, url);
    } catch (e: any) {
      const key =
        e instanceof BizException ? String(e.message) : 'auth.googleDisabled';
      const isRedirect = String(mode || '').trim().toLowerCase() === 'redirect';
      if (isRedirect) {
        const dest = this.auth.sanitizeReturnTo(returnTo);
        const originSafe = this.auth.getDefaultWebOrigin();
        return res.redirect(
          302,
          `${originSafe}${dest}${dest.includes('?') ? '&' : '?'}google_error=${encodeURIComponent(this.msg(req, key))}`,
        );
      }
      return res
        .status(503)
        .type('html')
        .send(
          this.oauthPopupHtml({
            ok: false,
            error: this.msg(req, key),
            origin: this.auth.getDefaultWebOrigin(),
          }),
        );
    }
  }

  /** Google OAuth callback: set cookie + postMessage (popup) or full-page redirect (mobile) */
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const peeked = this.auth.peekGoogleState(state);
    const fallbackOrigin = peeked?.origin || this.auth.getDefaultWebOrigin();
    const fallbackMode = peeked?.mode || 'popup';
    const fallbackReturnTo = peeked?.returnTo || '/';
    try {
      const { result, origin, mode, returnTo } = await this.auth.finishGoogleOAuth(
        { code, state, error },
        getClientMeta(req),
      );
      this.setSessionCookie(res, result.token);
      if (mode === 'redirect') {
        return res
          .status(200)
          .type('html')
          .send(
            this.oauthRedirectHtml({
              ok: true,
              origin: origin || fallbackOrigin,
              returnTo,
              token: result.token,
            }),
          );
      }
      return res
        .status(200)
        .type('html')
        .send(
          this.oauthPopupHtml({
            ok: true,
            token: result.token,
            user: result.user,
            origin: origin || fallbackOrigin,
          }),
        );
    } catch (e: any) {
      const key =
        e instanceof BizException ? String(e.message) : 'auth.googleExchangeFailed';
      const msg = this.msg(req, key);
      if (fallbackMode === 'redirect') {
        return res
          .status(200)
          .type('html')
          .send(
            this.oauthRedirectHtml({
              ok: false,
              origin: fallbackOrigin,
              returnTo: fallbackReturnTo,
              error: msg,
            }),
          );
      }
      return res
        .status(200)
        .type('html')
        .send(
          this.oauthPopupHtml({
            ok: false,
            error: msg,
            origin: fallbackOrigin,
          }),
        );
    }
  }

  // —— 公测预留：手机 OTP 登录（管理员配置 SMS 并打开 AUTH_PHONE_OTP_ENABLED 后启用）——
  /**
   * 发送手机 OTP：1 分钟 1 次 + 1 小时 10 次
   */
  @Throttle({ global: { limit: 1, ttl: 60_000 } })
  @Post('phone-number/send-otp')
  async sendOtp(@Body() body: any, @Req() req: Request) {
    const phone = String(body?.phone || body?.phoneNumber || '').trim();
    const purpose = (body?.purpose || 'login') as OtpPurpose;
    const r = await this.auth.sendPhoneOtp(phone, purpose);
    return ok(r, this.msg(req, 'auth.otpSent'));
  }

  @Post('phone-number/verify')
  async verifyOtp(
    @Body() body: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const phone = String(body?.phone || body?.phoneNumber || '').trim();
    const code = String(body?.code || '').trim();
    const purpose = (body?.purpose || 'login') as OtpPurpose;
    const result = await this.auth.verifyPhoneOtp(phone, code, purpose, getClientMeta(req));
    this.setSessionCookie(res, result.token);
    return ok(result, this.msg(req, 'auth.loginSuccess'));
  }

  // —— 公测预留：邮箱 OTP（登录/注册激活）；找回密码内测已启用 ——
  @Post('email/send-otp')
  @Throttle({ global: { limit: 1, ttl: 60_000 } })
  async sendEmailOtp(@Body() dto: SendEmailOtpDto, @Req() req: Request) {
    const purpose = dto.purpose || 'login';
    const r = await this.auth.sendEmailOtp(dto.email, purpose);
    return ok(
      r,
      this.msg(req, r.mailed ? 'auth.otpSentEmail' : 'auth.otpCreatedDev'),
    );
  }

  @Post('email/verify')
  async verifyEmailOtp(
    @Body() dto: VerifyEmailOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyEmailOtp(dto.email, dto.code, getClientMeta(req));
    this.setSessionCookie(res, result.token);
    return ok(result, this.msg(req, 'auth.loginSuccess'));
  }

  /** 内测：邮箱 + 账号 + 密码（无需验证码）。公测可传 code 做邮箱激活。 */
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  @Post('email/register')
  async registerEmail(
    @Body() dto: RegisterEmailDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.captcha.verify('web', dto.captchaId || '', dto.captchaCode || '');
    const result = await this.auth.registerEmail(dto, getClientMeta(req));
    this.setSessionCookie(res, result.token);
    return ok(result, this.msg(req, 'auth.registerSuccess'));
  }

  /** 内测：账号或邮箱 + 密码登录 */
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  @Post('email/login')
  async loginPassword(
    @Body() dto: LoginPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.captcha.verify('web', dto.captchaId || '', dto.captchaCode || '');
    const account = String(dto.account || dto.email || '').trim();
    const result = await this.auth.loginWithPassword(account, dto.password, getClientMeta(req));
    this.setSessionCookie(res, result.token);
    return ok(result, this.msg(req, 'auth.loginSuccess'));
  }

  @Post('email/forgot')
  @Throttle({ global: { limit: 1, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const r = await this.auth.forgotPassword(dto.email);
    return ok(
      r,
      this.msg(req, r.mailed ? 'auth.resetSentEmail' : 'auth.resetCreatedDev'),
    );
  }

  @Post('email/reset')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.resetPassword(dto, getClientMeta(req));
    this.setSessionCookie(res, result.token);
    return ok(result, this.msg(req, 'auth.resetSuccess'));
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

    // Backfill geo on older sessions that were created before IP capture
    if (!sess.ipAddress || !sess.country) {
      const geo = await enrichClientMeta(getClientMeta(req));
      if (geo.ipAddress || geo.country || geo.city) {
        await this.prisma.session.update({
          where: { id: sess.id },
          data: {
            ipAddress: sess.ipAddress || geo.ipAddress,
            country: sess.country || geo.country,
            city: sess.city || geo.city,
            userAgent: sess.userAgent || geo.userAgent,
          },
        });
      }
    }

    const profile = await this.auth.getSession(BigInt(payload.userId));
    return ok(profile);
  }

  private msg(req: Request, key: string) {
    return tFromAcceptLanguage(key, req.headers['accept-language']);
  }

  private oauthPopupHtml(payload: {
    ok: boolean;
    origin: string;
    token?: string;
    user?: unknown;
    error?: string;
  }): string {
    const origin = JSON.stringify(payload.origin || '*');
    const body = JSON.stringify({
      type: 'velvet-oauth',
      ok: payload.ok,
      token: payload.token ?? null,
      user: payload.user ?? null,
      error: payload.error ?? null,
    });
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Velvet</title></head><body>
<script>
(function () {
  var payload = ${body};
  var target = ${origin};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, target);
    }
  } catch (e) {}
  setTimeout(function () { window.close(); }, 120);
})();
</script>
<p style="font-family:system-ui,sans-serif;text-align:center;margin-top:40vh;color:#888">
  ${payload.ok ? 'Signed in — you can close this window.' : 'Sign-in failed — you can close this window.'}
</p>
</body></html>`;
  }

  /** Full-page OAuth return (mobile): persist token then navigate back into the app. */
  private oauthRedirectHtml(payload: {
    ok: boolean;
    origin: string;
    returnTo: string;
    token?: string;
    error?: string;
  }): string {
    const returnTo = this.auth.sanitizeReturnTo(payload.returnTo);
    const origin = String(payload.origin || this.auth.getDefaultWebOrigin()).replace(/\/$/, '');
    const url = new URL(returnTo, origin);
    if (payload.ok) {
      url.searchParams.set('google', 'ok');
    } else {
      url.searchParams.set('google_error', payload.error || 'Google sign-in failed');
    }
    const dest = JSON.stringify(url.toString());
    const token = JSON.stringify(payload.token || '');
    const ok = payload.ok ? 'true' : 'false';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Velvet</title></head><body>
<script>
(function () {
  var ok = ${ok};
  var token = ${token};
  var dest = ${dest};
  try {
    if (ok && token) localStorage.setItem('dv_token', token);
  } catch (e) {}
  location.replace(dest);
})();
</script>
<p style="font-family:system-ui,sans-serif;text-align:center;margin-top:40vh;color:#888">Redirecting…</p>
</body></html>`;
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
