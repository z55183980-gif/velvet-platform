import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { BizException, BizCode } from '../common/biz.exception';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly session: SessionService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: any; sessionId?: string }>();
    const token = this.extractToken(req);
    if (!token) throw new BizException(BizCode.UNAUTHORIZED, 'Chưa đăng nhập');

    const payload = this.session.verify(token);
    if (!payload) throw new BizException(BizCode.UNAUTHORIZED, 'Phiên đăng nhập hết hạn');

    // 校验 session 仍存在且未过期
    const sess = await this.prisma.session.findUnique({ where: { id: payload.sessionId } });
    if (!sess || sess.expiresAt < new Date()) {
      throw new BizException(BizCode.UNAUTHORIZED, 'Phiên đăng nhập hết hạn');
    }

    req.user = {
      userId: BigInt(payload.userId),
      phone: payload.phone,
      locale: payload.locale,
    };
    req.sessionId = payload.sessionId;
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    const name = this.auth.getCookieName();
    const cookies = req.cookies ?? parseCookies(req.headers.cookie);
    return cookies[name];
  }
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
