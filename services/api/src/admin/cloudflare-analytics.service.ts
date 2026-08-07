import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type CfSeriesPoint = {
  timestamp: string;
  requests: number;
  bytes: number;
  cachedRequests?: number;
  cachedBytes?: number;
};

export type CloudflareAnalyticsSnapshot = {
  configured: boolean;
  accountId: string | null;
  zoneId: string | null;
  mediaBucket: string;
  uploadBucket: string;
  rangeHours: number;
  fetchedAt: string;
  error?: string;
  r2: {
    available: boolean;
    storageBytes: number | null;
    objectOps: number;
    bytesIn: number;
    bytesOut: number;
    series: CfSeriesPoint[];
    byAction: Array<{ action: string; requests: number; bytes: number }>;
  };
  cdn: {
    available: boolean;
    requests: number;
    bytes: number;
    cachedRequests: number;
    cachedBytes: number;
    cacheHitRatio: number | null;
    series: CfSeriesPoint[];
  };
};

@Injectable()
export class CloudflareAnalyticsService {
  private readonly logger = new Logger(CloudflareAnalyticsService.name);

  constructor(private readonly config: ConfigService) {}

  /** General Cloudflare token (zone / CDN analytics). */
  private accountToken() {
    return (
      this.config.get<string>('CLOUDFLARE_API_TOKEN') ||
      process.env.CLOUDFLARE_API_TOKEN ||
      ''
    ).trim() || null;
  }

  /** R2-scoped token preferred for bucket ops/storage metrics. */
  private r2Token() {
    return (
      this.config.get<string>('R2_API_TOKEN') ||
      this.config.get<string>('CLOUDFLARE_API_TOKEN') ||
      process.env.R2_API_TOKEN ||
      process.env.CLOUDFLARE_API_TOKEN ||
      ''
    ).trim() || null;
  }

  private accountId() {
    const direct = (
      this.config.get<string>('R2_ACCOUNT_ID') ||
      process.env.R2_ACCOUNT_ID ||
      ''
    ).trim();
    if (direct) return direct;
    const endpoint = (
      this.config.get<string>('R2_ENDPOINT') ||
      process.env.R2_ENDPOINT ||
      ''
    ).trim();
    try {
      const host = new URL(endpoint).hostname;
      const m = /^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/i.exec(host);
      return m?.[1] || null;
    } catch {
      return null;
    }
  }

  private zoneId() {
    return (
      this.config.get<string>('CLOUDFLARE_ZONE_ID') ||
      process.env.CLOUDFLARE_ZONE_ID ||
      ''
    ).trim() || null;
  }

  private bucket(kind: 'media' | 'upload') {
    if (kind === 'media') {
      return (
        this.config.get<string>('R2_MEDIA_BUCKET') ||
        process.env.R2_MEDIA_BUCKET ||
        'velvet-media'
      ).trim();
    }
    return (
      this.config.get<string>('R2_UPLOAD_BUCKET') ||
      process.env.R2_UPLOAD_BUCKET ||
      'velvet-uploads'
    ).trim();
  }

  async getAnalytics(rangeHours = 24): Promise<CloudflareAnalyticsSnapshot> {
    const hours = Math.min(168, Math.max(1, Math.floor(rangeHours) || 24));
    const r2Token = this.r2Token();
    const accountToken = this.accountToken();
    const accountId = this.accountId();
    const zoneId = this.zoneId();
    const mediaBucket = this.bucket('media');
    const uploadBucket = this.bucket('upload');
    const base: CloudflareAnalyticsSnapshot = {
      configured: !!((r2Token || accountToken) && accountId),
      accountId,
      zoneId,
      mediaBucket,
      uploadBucket,
      rangeHours: hours,
      fetchedAt: new Date().toISOString(),
      r2: {
        available: false,
        storageBytes: null,
        objectOps: 0,
        bytesIn: 0,
        bytesOut: 0,
        series: [],
        byAction: [],
      },
      cdn: {
        available: false,
        requests: 0,
        bytes: 0,
        cachedRequests: 0,
        cachedBytes: 0,
        cacheHitRatio: null,
        series: [],
      },
    };

    if ((!r2Token && !accountToken) || !accountId) {
      base.error = 'CLOUDFLARE_API_TOKEN / R2_API_TOKEN / R2_ACCOUNT_ID not configured';
      return base;
    }

    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);

    try {
      // R2 operation traffic requires Account Analytics (cfut).
      // R2 bucket size REST works with R2 token (cfat).
      const analyticsToken = accountToken || r2Token;
      const [r2Media, r2Upload, storageMedia, storageUpload, cdn] = await Promise.all([
        analyticsToken
          ? this.queryR2Operations(accountId, analyticsToken, mediaBucket, start, end)
          : Promise.resolve(null),
        analyticsToken
          ? this.queryR2Operations(accountId, analyticsToken, uploadBucket, start, end)
          : Promise.resolve(null),
        this.queryR2StorageBytes(accountId, r2Token || accountToken, mediaBucket),
        this.queryR2StorageBytes(accountId, r2Token || accountToken, uploadBucket),
        zoneId && accountToken
          ? this.queryCdnHttp(zoneId, accountToken, start, end)
          : Promise.resolve(null),
      ]);

      const seriesMap = new Map<string, CfSeriesPoint>();
      const actionMap = new Map<string, { action: string; requests: number; bytes: number }>();
      for (const pack of [r2Media, r2Upload]) {
        if (!pack) continue;
        base.r2.objectOps += pack.objectOps;
        base.r2.bytesIn += pack.bytesIn;
        base.r2.bytesOut += pack.bytesOut;
        for (const point of pack.series) {
          const prev = seriesMap.get(point.timestamp) || {
            timestamp: point.timestamp,
            requests: 0,
            bytes: 0,
          };
          prev.requests += point.requests;
          prev.bytes += point.bytes;
          seriesMap.set(point.timestamp, prev);
        }
        for (const row of pack.byAction) {
          const prev = actionMap.get(row.action) || {
            action: row.action,
            requests: 0,
            bytes: 0,
          };
          prev.requests += row.requests;
          prev.bytes += row.bytes;
          actionMap.set(row.action, prev);
        }
      }
      base.r2.series = [...seriesMap.values()].sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );
      base.r2.byAction = [...actionMap.values()].sort((a, b) => b.requests - a.requests);
      const storage =
        (storageMedia ?? 0) + (storageUpload ?? 0);
      base.r2.storageBytes =
        storageMedia == null && storageUpload == null ? null : storage;
      base.r2.available = !!(r2Media || r2Upload || storageMedia != null || storageUpload != null);

      if (cdn) {
        base.cdn = { ...cdn, available: true };
      }
    } catch (e: any) {
      base.error = e?.message || String(e);
      this.logger.warn(`cloudflare analytics failed: ${base.error}`);
    }
    return base;
  }

  private async graphql(token: string, query: string, variables: Record<string, unknown>) {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(12_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Cloudflare GraphQL HTTP ${res.status}`);
    }
    if (body?.errors?.length) {
      throw new Error(body.errors[0]?.message || 'Cloudflare GraphQL error');
    }
    return body?.data;
  }

  private async queryR2Operations(
    accountId: string,
    token: string,
    bucket: string,
    start: Date,
    end: Date,
  ) {
    const query = `
      query R2Ops($accountTag: String!, $filter: R2OperationsAdaptiveGroupsFilter_InputObject) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            r2OperationsAdaptiveGroups(limit: 5000, filter: $filter, orderBy: [datetimeHour_ASC]) {
              sum {
                requests
                responseObjectSize
              }
              dimensions {
                datetimeHour
                actionType
              }
            }
          }
        }
      }
    `;
    try {
      const data = await this.graphql(token, query, {
        accountTag: accountId,
        filter: {
          datetime_geq: start.toISOString(),
          datetime_leq: end.toISOString(),
          bucketName: bucket,
        },
      });
      const rows = data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups || [];
      let objectOps = 0;
      let bytesOut = 0;
      const seriesMap = new Map<string, CfSeriesPoint>();
      const actionMap = new Map<string, { action: string; requests: number; bytes: number }>();
      for (const row of rows) {
        const requests = Number(row?.sum?.requests || 0) || 0;
        const out = Number(row?.sum?.responseObjectSize || 0) || 0;
        const ts = String(row?.dimensions?.datetimeHour || '');
        const action = String(row?.dimensions?.actionType || 'unknown');
        objectOps += requests;
        bytesOut += out;
        if (ts) {
          const prev = seriesMap.get(ts) || { timestamp: ts, requests: 0, bytes: 0 };
          prev.requests += requests;
          prev.bytes += out;
          seriesMap.set(ts, prev);
        }
        const a = actionMap.get(action) || { action, requests: 0, bytes: 0 };
        a.requests += requests;
        a.bytes += out;
        actionMap.set(action, a);
      }
      return {
        objectOps,
        bytesIn: 0,
        bytesOut,
        series: [...seriesMap.values()],
        byAction: [...actionMap.values()],
      };
    } catch (e: any) {
      this.logger.warn(`R2 ops query failed bucket=${bucket}: ${e?.message || e}`);
      return null;
    }
  }

  /** Prefer REST /usage (works with R2 token); GraphQL storage is optional fallback. */
  private async queryR2StorageBytes(
    accountId: string | null,
    token: string | null,
    bucket: string,
  ) {
    if (!accountId || !token) return null;
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/usage`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const body: any = await res.json().catch(() => null);
        if (body?.success && body?.result) {
          const payload = Number(body.result.payloadSize ?? 0) || 0;
          const metadata = Number(body.result.metadataSize ?? 0) || 0;
          return payload + metadata;
        }
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  /** Zone HTTP traffic via httpRequests1hGroups (requests/bytes/cache). */
  private async queryCdnHttp(zoneId: string, token: string, start: Date, end: Date) {
    const query = `
      query CdnHttp($zoneTag: String!, $filter: ZoneHttpRequests1hGroupsFilter_InputObject) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequests1hGroups(limit: 5000, filter: $filter, orderBy: [datetime_ASC]) {
              sum {
                requests
                bytes
                cachedRequests
                cachedBytes
              }
              dimensions { datetime }
            }
          }
        }
      }
    `;
    try {
      const data = await this.graphql(token, query, {
        zoneTag: zoneId,
        filter: {
          datetime_geq: start.toISOString(),
          datetime_leq: end.toISOString(),
        },
      });
      const rows = data?.viewer?.zones?.[0]?.httpRequests1hGroups || [];
      let requests = 0;
      let bytes = 0;
      let cachedRequests = 0;
      let cachedBytes = 0;
      const series: CfSeriesPoint[] = [];
      for (const row of rows) {
        const r = Number(row?.sum?.requests || 0) || 0;
        const b = Number(row?.sum?.bytes || 0) || 0;
        const cr = Number(row?.sum?.cachedRequests || 0) || 0;
        const cb = Number(row?.sum?.cachedBytes || 0) || 0;
        const ts = String(row?.dimensions?.datetime || '');
        requests += r;
        bytes += b;
        cachedRequests += cr;
        cachedBytes += cb;
        if (ts) {
          series.push({
            timestamp: ts,
            requests: r,
            bytes: b,
            cachedRequests: cr,
            cachedBytes: cb,
          });
        }
      }
      return {
        available: true,
        requests,
        bytes,
        cachedRequests,
        cachedBytes,
        cacheHitRatio: requests > 0 ? Math.round((cachedRequests / requests) * 1000) / 10 : null,
        series,
      };
    } catch (e: any) {
      this.logger.warn(`CDN http query failed: ${e?.message || e}`);
      return null;
    }
  }
}
