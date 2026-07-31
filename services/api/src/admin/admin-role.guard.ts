import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { BizException, BizCode } from '../common/biz.exception';

export const ADMIN_ROLES_KEY = 'admin-roles';
export const AdminRoles = (...roles: ('SUPER_ADMIN' | 'OPS')[]) =>
  SetMetadata(ADMIN_ROLES_KEY, roles);

/**
 * 角色守卫：在 AdminGuard 之后运行。
 * 旧开发态（x-admin-token 静态口令）默认视为 SUPER_ADMIN（兼容历史用法）。
 * JWT 登录则按 AdminUser.role 校验。
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ADMIN_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<
      Request & {
        adminId?: bigint;
        adminAuthMode?: 'jwt' | 'legacy';
        adminRole?: string;
      }
    >();
    // 旧开发态（静态 token）默认 SUPER_ADMIN
    if (req.adminAuthMode === 'legacy' && !req.adminRole) {
      req.adminRole = 'SUPER_ADMIN';
    }
    const role = (req.adminRole as string | undefined) || 'SUPER_ADMIN';
    if (required.includes(role)) return true;

    throw new BizException(
      BizCode.FORBIDDEN,
      `Yêu cầu quyền: ${required.join('|')}`,
      HttpStatus.FORBIDDEN,
    );
  }
}
