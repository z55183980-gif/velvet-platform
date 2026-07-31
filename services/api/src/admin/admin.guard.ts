import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { BizException, BizCode } from '../common/biz.exception';
import { AdminAuthService } from './admin-auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly legacyToken: string;

  constructor(
    config: ConfigService,
    private readonly adminAuth: AdminAuthService,
    private readonly prisma: PrismaService,
  ) {
    this.legacyToken = config.get<string>('ADMIN_TOKEN') || 'dev-admin';
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<
      Request & {
        adminId?: bigint;
        adminAuthMode?: 'jwt' | 'legacy';
        adminRole?: string;
      }
    >();

    // 1) 正式管理员 JWT（Authorization Bearer 或 cookie 或 x-admin-token 若为 JWT）
    const jwtToken = this.extractJwt(req);
    if (jwtToken) {
      const payload = this.adminAuth.verifyAdminToken(jwtToken);
      if (payload) {
        const admin = await this.prisma.adminUser.findUnique({
          where: { id: BigInt(payload.adminId) },
        });
        if (admin && admin.status === 'ACTIVE') {
          req.adminId = admin.id;
          req.adminAuthMode = 'jwt';
          req.adminRole = (admin as any).role || 'SUPER_ADMIN';
          try {
            await this.prisma.adminUser.update({
              where: { id: admin.id },
              data: { lastLoginAt: new Date() },
            });
          } catch {
            /* ignore */
          }
          return true;
        }
      }
    }

    // 2) 兼容旧开发态 x-admin-token（静态口令，如 dev-admin）
    const headerToken = req.headers['x-admin-token'];
    const legacy =
      typeof headerToken === 'string'
        ? headerToken
        : Array.isArray(headerToken)
          ? headerToken[0]
          : undefined;
    if (legacy && legacy === this.legacyToken) {
      req.adminAuthMode = 'legacy';
      req.adminRole = 'SUPER_ADMIN';
      return true;
    }

    throw new BizException(
      BizCode.FORBIDDEN,
      'Không có quyền quản trị',
      HttpStatus.FORBIDDEN,
    );
  }

  private extractJwt(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const t = auth.slice(7).trim();
      if (t && t.includes('.')) return t;
    }

    const headerToken = req.headers['x-admin-token'];
    const ht =
      typeof headerToken === 'string'
        ? headerToken
        : Array.isArray(headerToken)
          ? headerToken[0]
          : undefined;
    // JWT 形如 xxx.yyy.zzz
    if (ht && ht.includes('.') && ht.split('.').length === 3) return ht;

    const cookies = (req as any).cookies ?? parseCookies(req.headers.cookie);
    const c = cookies[this.adminAuth.getCookieName()];
    if (c && c.includes('.')) return c;

    return undefined;
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
