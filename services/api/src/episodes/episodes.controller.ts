import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import { EpisodesService } from './episodes.service';
import { PrismaService } from '../prisma/prisma.service';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

class ProgressDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  progressSec!: number;
}

@Controller('v1')
export class EpisodesController {
  constructor(
    private readonly episodes: EpisodesService,
    private readonly auth: AuthService,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  /** 登录用户可播已解锁集；未登录仅可播免费集 */
  @Get('episodes/:id/play')
  async play(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalUserId(req);
    return ok(await this.episodes.getPlayUrl(BigInt(id), userId));
  }

  /** 付费预览切片/字节裁剪网关（不返回完整片源） */
  @Get('episodes/:id/preview')
  async preview(
    @Param('id') id: string,
    @Query('sig') sig: string | undefined,
    @Query('exp') exp: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.episodes.streamPreview(BigInt(id), sig, exp, req, res);
  }

  @Post('episodes/:id/progress')
  @UseGuards(AuthGuard)
  async progress(
    @Param('id') id: string,
    @Body() dto: ProgressDto,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.episodes.reportProgress(user.userId, BigInt(id), dto.progressSec));
  }

  private async optionalUserId(req: Request): Promise<bigint | undefined> {
    try {
      const auth = req.headers.authorization;
      let token: string | undefined;
      if (auth?.startsWith('Bearer ')) token = auth.slice(7);
      else {
        const name = this.auth.getCookieName();
        const cookies = parseCookies(req.headers.cookie);
        token = cookies[name];
      }
      if (!token) return undefined;
      const payload = this.session.verify(token);
      if (!payload) return undefined;
      const sess = await this.prisma.session.findUnique({ where: { id: payload.sessionId } });
      if (!sess || sess.expiresAt < new Date()) return undefined;
      const user = await this.prisma.user.findUnique({
        where: { id: BigInt(payload.userId) },
        select: { status: true },
      });
      if (!user || user.status === 'BANNED' || user.status === 'SUSPENDED') return undefined;
      return BigInt(payload.userId);
    } catch {
      return undefined;
    }
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
