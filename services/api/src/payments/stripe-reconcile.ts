/**
 * Stripe T+1 reconciliation helpers — list succeeded Checkout Sessions for a UTC day window.
 * Uses the same STRIPE_SECRET_KEY as checkout (no SDK dependency).
 */

function secretKey(): string | null {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key || key.startsWith('CHANGE_ME')) return null;
  return key;
}

export type StripeDayRemote = {
  paidCnt: number;
  /** Major units summed by currency (e.g. USD: 12.34) */
  amountMajorByCurrency: Record<string, number>;
  error?: string;
};

function toMajor(amountMinor: number, currency: string): number {
  const cur = currency.toUpperCase();
  const zeroDecimal = new Set(['JPY', 'KRW', 'VND']);
  if (zeroDecimal.has(cur)) return amountMinor;
  return amountMinor / 100;
}

/**
 * Paginate Checkout Sessions with payment_status=paid created in [dayStart, dayEnd).
 */
export async function fetchStripePaidCountsForDay(
  dayStart: Date,
  dayEnd: Date,
): Promise<StripeDayRemote> {
  const key = secretKey();
  if (!key) {
    return {
      paidCnt: -1,
      amountMajorByCurrency: {},
      error: 'STRIPE_SECRET_KEY missing',
    };
  }

  const gte = Math.floor(dayStart.getTime() / 1000);
  const lt = Math.floor(dayEnd.getTime() / 1000);
  let paidCnt = 0;
  const amountMajorByCurrency: Record<string, number> = {};
  let startingAfter: string | undefined;

  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams();
    params.set('limit', '100');
    params.set('created[gte]', String(gte));
    params.set('created[lt]', String(lt));
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        paidCnt: -1,
        amountMajorByCurrency: {},
        error: `stripe sessions ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        payment_status?: string;
        amount_total?: number | null;
        currency?: string | null;
      }>;
      has_more?: boolean;
    };
    const rows = json.data || [];
    for (const s of rows) {
      if (String(s.payment_status || '').toLowerCase() !== 'paid') continue;
      paidCnt += 1;
      const cur = String(s.currency || 'usd').toUpperCase();
      const minor = Number(s.amount_total || 0);
      if (Number.isFinite(minor) && minor > 0) {
        amountMajorByCurrency[cur] =
          (amountMajorByCurrency[cur] || 0) + toMajor(minor, cur);
      }
    }
    if (!json.has_more || rows.length === 0) break;
    startingAfter = rows[rows.length - 1]?.id;
    if (!startingAfter) break;
  }

  return { paidCnt, amountMajorByCurrency };
}
