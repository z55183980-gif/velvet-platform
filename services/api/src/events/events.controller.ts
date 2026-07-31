import { Body, Controller, Post, Req } from '@nestjs/common';
import { ok } from '../common/response';
import { StructuredLogger } from '../common/structured-logger.service';

@Controller('v1/events')
export class EventsController {
  constructor(private readonly log: StructuredLogger) {}

  /** 前端埋点上报（可匿名；可选带 Authorization） */
  @Post()
  ingest(@Body() body: any, @Req() req: any) {
    const raw = body?.events ?? (body?.event ? [body] : []);
    const list = Array.isArray(raw) ? raw : [];
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    const ua = req?.headers?.['user-agent'] || null;
    let n = 0;
    for (const e of list.slice(0, 50)) {
      if (!e?.event || typeof e.event !== 'string') continue;
      this.log.log({
        event: `client.${e.event.slice(0, 64)}`,
        ip,
        ua,
        ...(e.props && typeof e.props === 'object' ? e.props : {}),
      });
      n++;
    }
    return ok({ received: n });
  }
}
