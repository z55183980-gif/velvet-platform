import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { DramasService } from './dramas.service';
import { ok } from '../common/response';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';

@Controller('v1')
export class DramasController {
  constructor(
    private readonly dramas: DramasService,
    private readonly auth: AuthService,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('dramas')
  async list(
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('tag') tag?: string,
    @Query('sort') sort?: 'latest' | 'hot',
    @Query('secret') secret?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize || '12', 10) || 12));
    return ok(await this.dramas.listDramas({ category, q, tag, sort, secret: secret === '1', page: p, pageSize: ps }));
  }

  @Get('dramas/featured')
  async featured() {
    return ok(await this.dramas.getFeatured());
  }

  @Get('dramas/hottest')
  async hottest() {
    return ok(await this.dramas.getHottest());
  }

  /** Mobile home vertical feed: ops hottest pins + 7d heat ranking */
  @Get('dramas/feed')
  async feed(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('pinHottest') pinHottest?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize || '20', 10) || 20));
    const pin = Math.min(10, Math.max(0, parseInt(pinHottest || '3', 10) || 3));
    return ok(await this.dramas.getHomeFeed({ page: p, pageSize: ps, pinHottest: pin }));
  }

  @Get('categories')
  async categories() {
    return ok(await this.dramas.listCategories());
  }

  @Get('drama-tags')
  async dramaTags() {
    return ok(await this.dramas.listPublicTags());
  }

  @Get('banners')
  async banners() {
    return ok(await this.dramas.listBanners());
  }

  @Get('dramas/:id')
  async detail(@Param('id') id: string) {
    const drama = await this.dramas.getDrama(id);
    if (!drama) throw new BizException(BizCode.NOT_FOUND, 'common.notFound');
    return ok(drama);
  }

  @Get('dramas/:id/episodes')
  async episodes(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalUserId(req);
    const data = await this.dramas.getEpisodes(id, userId);
    if (!data) throw new BizException(BizCode.NOT_FOUND, 'common.notFound');
    return ok(data);
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
