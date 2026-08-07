import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ok } from '../common/response';
import { StructuredLogger } from '../common/structured-logger.service';

@Controller('v1/events')
export class EventsController {
  constructor(private readonly log: StructuredLogger) {}

  /** 前端埋点上报（可匿名；可选带 Authorization） */
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  @Post()
  ingest(@Body() body: any, @Req() req: any) { // override: 30/min vs default 60/5min
    const raw = body?.events ?? (body?.event ? [body] : []);
    const list = Array.isArray(raw) ? raw : [];
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    const ua = req?.headers?.['user-agent'] || null;
    let n = 0;
    for (const e of list.slice(0, 50)) {
      if (!e?.event || typeof e.event !== 'string') continue;
      const props =
        e.props && typeof e.props === 'object' && !Array.isArray(e.props)
          ? Object.fromEntries(
              Object.entries(e.props as Record<string, unknown>)
                .slice(0, 20)
                .map(([k, v]) => [
                  String(k).slice(0, 40),
                  typeof v === 'string' ? v.slice(0, 200) : typeof v === 'number' || typeof v === 'boolean' ? v : undefined,
                ])
                .filter(([, v]) => v !== undefined),
            )
          : undefined;
      this.log.log({
        event: `client.${e.event.slice(0, 64)}`,
        ip,
        ua: typeof ua === 'string' ? ua.slice(0, 200) : ua,
        props,
      });
      n++;
    }
    return ok({ received: n });
  }
}
