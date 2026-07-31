import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: bigint;
  phone?: string | null;
  locale: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
