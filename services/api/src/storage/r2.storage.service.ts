import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type R2ObjectInfo = {
  key: string;
  size: number;
  lastModified?: string;
};

export type R2PresignPutResult = {
  uploadUrl: string;
  bucket: string;
  key: string;
  contentType: string;
  headers: Record<string, string>;
  expiresIn: number;
  expiresAt: string;
};

export type R2StorageSizeSource = 'cloudflare_usage' | 'cloudflare_graphql' | 'list_approx' | null;

export type R2ConnectivityProbe = {
  ok: boolean;
  skipped: boolean;
  skipReason?: 'r2_disabled' | 'not_configured';
  latencyMs: number | null;
  error: string | null;
  mediaBucket: string;
  uploadBucket: string;
  mediaReachable: boolean | null;
  uploadReachable: boolean | null;
  endpointHost: string | null;
  region: string;
  checkedAt: string;
  /** Sum of media + upload payload (+ metadata when from CF analytics). null when unavailable. */
  storageBytes: number | null;
  mediaBytes: number | null;
  uploadBytes: number | null;
  /** True when size came from a bounded ListObjects scan (may undercount). */
  storageApprox: boolean;
  storageSource: R2StorageSizeSource;
};

const emptyStorageSize = {
  storageBytes: null as number | null,
  mediaBytes: null as number | null,
  uploadBytes: null as number | null,
  storageApprox: false,
  storageSource: null as R2StorageSizeSource,
};

/** Bounded ListObjectsV2 pages when CF metrics token is missing (MaxKeys=1000 each). */
const LIST_SIZE_MAX_PAGES = 3;

/** Thin R2 (S3-compatible) helper. Only uses configured Velvet buckets. */
@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return (this.config.get<string>('STORAGE_BACKEND') || 'local').toLowerCase() === 'r2';
  }

  hasCredentials(): boolean {
    return !!(
      this.config.get<string>('R2_ENDPOINT') &&
      this.config.get<string>('R2_ACCESS_KEY_ID') &&
      this.config.get<string>('R2_SECRET_ACCESS_KEY')
    );
  }

  /** Ready for browser direct PUT (needs credentials; bucket CORS must allow admin origin). */
  canDirectUpload(): boolean {
    return this.hasCredentials();
  }

  mediaBucket(): string {
    return this.config.get<string>('R2_MEDIA_BUCKET') || 'velvet-media';
  }

  uploadBucket(): string {
    return this.config.get<string>('R2_UPLOAD_BUCKET') || 'velvet-uploads';
  }

  cdnBase(): string {
    return (this.config.get<string>('CDN_BASE_URL') || 'https://cdn.velvetmovie.space').replace(
      /\/$/,
      '',
    );
  }

  region(): string {
    return this.config.get<string>('R2_REGION') || 'auto';
  }

  endpointHost(): string | null {
    const endpoint = (this.config.get<string>('R2_ENDPOINT') || '').trim();
    if (!endpoint) return null;
    try {
      return new URL(endpoint).host;
    } catch {
      return endpoint.replace(/^https?:\/\//i, '').split('/')[0] || null;
    }
  }

  /** Prefer R2_ACCOUNT_ID; else parse from R2_ENDPOINT host (`{id}.r2.cloudflarestorage.com`). */
  accountId(): string | null {
    const configured = (this.config.get<string>('R2_ACCOUNT_ID') || '').trim();
    if (configured) return configured;
    const host = this.endpointHost();
    if (!host) return null;
    const m = /^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/i.exec(host);
    return m?.[1] || null;
  }

  /** Prefer R2-scoped token; fall back to general Cloudflare API token. */
  private cloudflareApiToken(): string | null {
    const token = (
      this.config.get<string>('R2_API_TOKEN') ||
      this.config.get<string>('CLOUDFLARE_API_TOKEN') ||
      process.env.R2_API_TOKEN ||
      process.env.CLOUDFLARE_API_TOKEN ||
      ''
    ).trim();
    return token || null;
  }

  /**
   * Light live check: ListObjectsV2 MaxKeys=1 on media + upload buckets,
   * plus best-effort storage size (CF usage/GraphQL, else bounded List).
   */
  async probeConnectivity(): Promise<R2ConnectivityProbe> {
    const mediaBucket = this.mediaBucket();
    const uploadBucket = this.uploadBucket();
    const base = {
      mediaBucket,
      uploadBucket,
      endpointHost: this.endpointHost(),
      region: this.region(),
      checkedAt: new Date().toISOString(),
      ...emptyStorageSize,
    };

    if (!this.isEnabled()) {
      return {
        ok: true,
        skipped: true,
        skipReason: 'r2_disabled',
        latencyMs: null,
        error: null,
        mediaReachable: null,
        uploadReachable: null,
        ...base,
      };
    }

    if (!this.hasCredentials()) {
      return {
        ok: false,
        skipped: true,
        skipReason: 'not_configured',
        latencyMs: null,
        error: 'R2 credentials incomplete',
        mediaReachable: null,
        uploadReachable: null,
        ...base,
      };
    }

    const started = Date.now();
    const [media, upload, cfSize] = await Promise.all([
      this.probeBucket(mediaBucket),
      this.probeBucket(uploadBucket),
      this.fetchStorageSizeViaCloudflare(mediaBucket, uploadBucket).catch((e: any) => {
        this.logger.warn(`R2 size via Cloudflare failed: ${e?.message || e}`);
        return null;
      }),
    ]);
    let size: typeof emptyStorageSize = cfSize ?? { ...emptyStorageSize };
    if (!cfSize && media.ok && upload.ok) {
      try {
        size = await this.fetchStorageSizeViaListApprox(mediaBucket, uploadBucket);
      } catch (e: any) {
        this.logger.warn(`R2 size via ListObjects failed: ${e?.message || e}`);
      }
    }
    const latencyMs = Date.now() - started;
    const ok = media.ok && upload.ok;
    const errors = [media.error, upload.error].filter(Boolean);
    return {
      ok,
      skipped: false,
      latencyMs,
      error: ok ? null : errors.join('; ') || 'R2 unreachable',
      mediaReachable: media.ok,
      uploadReachable: upload.ok,
      ...base,
      ...size,
      checkedAt: new Date().toISOString(),
    };
  }

  private async probeBucket(
    bucket: string,
  ): Promise<{ ok: boolean; error: string | null }> {
    try {
      await this.getClient().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: 1,
        }),
      );
      return { ok: true, error: null };
    } catch (e: any) {
      const name = e?.name || e?.Code || 'Error';
      const message = e?.message || String(e);
      return { ok: false, error: `${bucket}: ${name}: ${message}` };
    }
  }

  /**
   * Best-effort bucket usage for media + upload via Cloudflare analytics.
   * Returns null when token/account missing or APIs fail (caller may List-approx).
   */
  private async fetchStorageSizeViaCloudflare(
    mediaBucket: string,
    uploadBucket: string,
  ): Promise<typeof emptyStorageSize | null> {
    const accountId = this.accountId();
    const token = this.cloudflareApiToken();
    if (!accountId || !token) return null;

    const [mediaViaUsage, uploadViaUsage] = await Promise.all([
      this.fetchBucketUsageRest(accountId, token, mediaBucket),
      this.fetchBucketUsageRest(accountId, token, uploadBucket),
    ]);
    if (mediaViaUsage != null && uploadViaUsage != null) {
      return {
        mediaBytes: mediaViaUsage,
        uploadBytes: uploadViaUsage,
        storageBytes: mediaViaUsage + uploadViaUsage,
        storageApprox: false,
        storageSource: 'cloudflare_usage',
      };
    }

    const [mediaViaGql, uploadViaGql] = await Promise.all([
      mediaViaUsage != null
        ? Promise.resolve(mediaViaUsage)
        : this.fetchBucketSizeGraphQl(accountId, token, mediaBucket),
      uploadViaUsage != null
        ? Promise.resolve(uploadViaUsage)
        : this.fetchBucketSizeGraphQl(accountId, token, uploadBucket),
    ]);
    if (mediaViaGql == null && uploadViaGql == null) return null;
    const partial = mediaViaGql == null || uploadViaGql == null;
    return {
      mediaBytes: mediaViaGql,
      uploadBytes: uploadViaGql,
      storageBytes: (mediaViaGql ?? 0) + (uploadViaGql ?? 0),
      storageApprox: partial,
      storageSource: 'cloudflare_graphql',
    };
  }

  /** GET /accounts/{id}/r2/buckets/{bucket}/usage — payloadSize (+ metadataSize). */
  private async fetchBucketUsageRest(
    accountId: string,
    token: string,
    bucket: string,
  ): Promise<number | null> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/usage`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body: any = await res.json().catch(() => null);
    if (!body?.success || !body?.result) return null;
    const payload = Number(body.result.payloadSize ?? 0);
    const metadata = Number(body.result.metadataSize ?? 0);
    if (!Number.isFinite(payload) && !Number.isFinite(metadata)) return null;
    return (Number.isFinite(payload) ? payload : 0) + (Number.isFinite(metadata) ? metadata : 0);
  }

  /** GraphQL r2StorageAdaptiveGroups — same source as the Cloudflare dashboard. */
  private async fetchBucketSizeGraphQl(
    accountId: string,
    token: string,
    bucket: string,
  ): Promise<number | null> {
    const end = new Date();
    const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);
    const query = `
      query getR2StorageMetrics($accountTag: String, $filter: R2StorageAdaptiveGroupsFilter_InputObject) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            r2StorageAdaptiveGroups(
              limit: 1
              filter: $filter
              orderBy: [datetime_DESC]
            ) {
              max {
                objectCount
                payloadSize
                metadataSize
              }
            }
          }
        }
      }
    `;
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        operationName: 'getR2StorageMetrics',
        variables: {
          accountTag: accountId,
          filter: {
            datetime_geq: start.toISOString(),
            datetime_leq: end.toISOString(),
            bucketName: bucket,
          },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body: any = await res.json().catch(() => null);
    const row = body?.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups?.[0]?.max;
    if (!row) return null;
    const payload = Number(row.payloadSize ?? 0);
    const metadata = Number(row.metadataSize ?? 0);
    if (!Number.isFinite(payload) && !Number.isFinite(metadata)) return null;
    return (Number.isFinite(payload) ? payload : 0) + (Number.isFinite(metadata) ? metadata : 0);
  }

  /**
   * Approximate size via ListObjectsV2: up to LIST_SIZE_MAX_PAGES × 1000 keys per bucket.
   * Marks storageApprox when either bucket is truncated.
   */
  private async fetchStorageSizeViaListApprox(
    mediaBucket: string,
    uploadBucket: string,
  ): Promise<typeof emptyStorageSize> {
    const [media, upload] = await Promise.all([
      this.sumBucketListBytes(mediaBucket),
      this.sumBucketListBytes(uploadBucket),
    ]);
    return {
      mediaBytes: media.bytes,
      uploadBytes: upload.bytes,
      storageBytes: media.bytes + upload.bytes,
      storageApprox: media.truncated || upload.truncated,
      storageSource: 'list_approx',
    };
  }

  private async sumBucketListBytes(
    bucket: string,
  ): Promise<{ bytes: number; truncated: boolean }> {
    let bytes = 0;
    let token: string | undefined;
    let pages = 0;
    let truncated = false;
    do {
      const res = await this.getClient().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const obj of res.Contents || []) {
        bytes += Number(obj.Size || 0);
      }
      pages += 1;
      if (res.IsTruncated && pages >= LIST_SIZE_MAX_PAGES) {
        truncated = true;
        break;
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return { bytes, truncated };
  }

  private getClient(): S3Client {
    if (this.client) return this.client;
    const endpoint = this.config.get<string>('R2_ENDPOINT');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 credentials incomplete');
    }
    this.client = new S3Client({
      region: this.config.get<string>('R2_REGION') || 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    return this.client;
  }

  private safeUploadFilename(name: string): string {
    const base = path.basename(String(name || 'video.mp4')).replace(/[^\w.\u4e00-\u9fff()-]+/g, '_');
    const cleaned = base.replace(/^\.+/, '') || 'video.mp4';
    return cleaned.slice(0, 120);
  }

  /** Build a one-time direct-upload object key under velvet-uploads. */
  buildDirectUploadKey(filename: string, actorId?: string | number | bigint): string {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const day = new Date().toISOString().slice(0, 10);
    const actor = actorId != null ? String(actorId) : 'anon';
    return `direct-uploads/${day}/${actor}/${id}-${this.safeUploadFilename(filename)}`;
  }

  isDirectUploadKey(key: string): boolean {
    const k = String(key || '').replace(/^\/+/, '');
    return (
      k.startsWith('direct-uploads/') &&
      !k.includes('..') &&
      !k.includes('\\') &&
      k.length < 512
    );
  }

  async createPresignedPut(opts: {
    filename: string;
    contentType: string;
    actorId?: string | number | bigint;
    expiresIn?: number;
  }): Promise<R2PresignPutResult> {
    if (!this.hasCredentials()) {
      throw new Error('R2 credentials incomplete');
    }
    const contentType = (opts.contentType || 'application/octet-stream').trim();
    const expiresIn = Math.min(Math.max(opts.expiresIn ?? 3600, 60), 7200);
    const key = this.buildDirectUploadKey(opts.filename, opts.actorId);
    const bucket = this.uploadBucket();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.getClient(), command, { expiresIn });
    return {
      uploadUrl,
      bucket,
      key,
      contentType,
      headers: { 'Content-Type': contentType },
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async headUploadObject(key: string): Promise<{ size: number; contentType?: string }> {
    if (!this.isDirectUploadKey(key)) {
      throw new Error('invalid direct-upload key');
    }
    const res = await this.getClient().send(
      new HeadObjectCommand({ Bucket: this.uploadBucket(), Key: key }),
    );
    return {
      size: Number(res.ContentLength || 0),
      contentType: res.ContentType,
    };
  }

  /** Stream an upload-bucket object to a local absolute path. */
  async downloadUploadObjectToFile(key: string, absPath: string): Promise<{ size: number }> {
    if (!this.isDirectUploadKey(key)) {
      throw new Error('invalid direct-upload key');
    }
    const res = await this.getClient().send(
      new GetObjectCommand({ Bucket: this.uploadBucket(), Key: key }),
    );
    if (!res.Body) throw new Error('empty R2 object body');
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const body = res.Body as Readable;
    await pipeline(body, fs.createWriteStream(absPath));
    const size = fs.statSync(absPath).size;
    return { size };
  }

  async deleteUploadObject(key: string): Promise<void> {
    if (!this.isDirectUploadKey(key)) return;
    try {
      await this.deleteKeys([key], this.uploadBucket());
    } catch (e: any) {
      this.logger.warn(`delete upload object failed ${key}: ${e?.message || e}`);
    }
  }

  async putFile(bucket: string, key: string, absPath: string, contentType?: string) {
    const body = fs.readFileSync(absPath);
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || this.guessContentType(key),
      }),
    );
  }

  async putBuffer(bucket: string, key: string, body: Buffer, contentType?: string) {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || this.guessContentType(key),
      }),
    );
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Read media-bucket object (optional RFC 7233 Range). */
  async getMediaObject(
    key: string,
    opts?: { range?: string },
  ): Promise<{ body: Readable; contentType?: string; contentLength?: number; statusCode: number }> {
    const normalized = String(key || '').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) {
      throw new Error('invalid media key');
    }
    const res = await this.getClient().send(
      new GetObjectCommand({
        Bucket: this.mediaBucket(),
        Key: normalized,
        ...(opts?.range ? { Range: opts.range } : {}),
      }),
    );
    if (!res.Body) throw new Error('empty R2 object body');
    return {
      body: res.Body as Readable,
      contentType: res.ContentType,
      contentLength: res.ContentLength != null ? Number(res.ContentLength) : undefined,
      statusCode: opts?.range ? 206 : 200,
    };
  }

  async headMediaObject(key: string): Promise<{ size: number; contentType?: string } | null> {
    const normalized = String(key || '').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) return null;
    try {
      const res = await this.getClient().send(
        new HeadObjectCommand({ Bucket: this.mediaBucket(), Key: normalized }),
      );
      return {
        size: Number(res.ContentLength || 0),
        contentType: res.ContentType,
      };
    } catch {
      return null;
    }
  }

  /** Upload a local HLS directory (index.m3u8 + segments) under keyPrefix/. */
  async uploadHlsDirectory(localDir: string, keyPrefix: string): Promise<string> {
    const bucket = this.mediaBucket();
    const prefix = keyPrefix.replace(/^\/+|\/+$/g, '');
    const entries = fs.readdirSync(localDir);
    for (const name of entries) {
      const abs = path.join(localDir, name);
      if (!fs.statSync(abs).isFile()) continue;
      if (name === 'source.mp4') continue;
      const key = `${prefix}/${name}`;
      await this.putFile(bucket, key, abs);
      this.logger.log(`r2 put ${bucket}/${key}`);
    }
    return `${this.cdnBase()}/${prefix}/index.m3u8`;
  }

  async listPrefix(prefix: string, bucket?: string): Promise<R2ObjectInfo[]> {
    if (!this.hasCredentials()) return [];
    const b = bucket || this.mediaBucket();
    const normalized = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
    const out: R2ObjectInfo[] = [];
    let token: string | undefined;
    do {
      const res = await this.getClient().send(
        new ListObjectsV2Command({
          Bucket: b,
          Prefix: normalized ? `${normalized}/` : undefined,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const obj of res.Contents || []) {
        if (!obj.Key) continue;
        out.push({
          key: obj.Key,
          size: Number(obj.Size || 0),
          lastModified: obj.LastModified?.toISOString(),
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deleteKeys(keys: string[], bucket?: string): Promise<number> {
    if (!keys.length || !this.hasCredentials()) return 0;
    const b = bucket || this.mediaBucket();
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      const res = await this.getClient().send(
        new DeleteObjectsCommand({
          Bucket: b,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      deleted += res.Deleted?.length ?? chunk.length;
      if (res.Errors?.length) {
        this.logger.warn(
          `r2 delete errors: ${res.Errors.map((e) => `${e.Key}:${e.Message}`).join('; ')}`,
        );
      }
    }
    return deleted;
  }

  async deletePrefix(prefix: string, bucket?: string): Promise<number> {
    const objects = await this.listPrefix(prefix, bucket);
    if (!objects.length) return 0;
    const n = await this.deleteKeys(
      objects.map((o) => o.key),
      bucket,
    );
    this.logger.log(`r2 deleted ${n} object(s) under ${prefix}`);
    return n;
  }

  /**
   * Derive an R2 object-key prefix from a CDN or relative media URL.
   * e.g. https://cdn…/hls/123/index.m3u8 → hls/123
   */
  mediaPrefixFromUrl(url: string | null | undefined): string | null {
    if (!url?.trim()) return null;
    let raw = url.trim();
    try {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        const cdnHost = new URL(this.cdnBase()).host;
        if (
          u.host !== cdnHost &&
          !u.host.endsWith('.r2.dev') &&
          !u.host.includes('r2.cloudflarestorage.com')
        ) {
          return null;
        }
        raw = u.pathname;
      }
    } catch {
      return null;
    }
    raw = raw.replace(/^\/+/, '').split('?')[0].split('#')[0];
    if (!raw) return null;
    if (raw.startsWith('api/v1/media/')) {
      raw = raw.slice('api/v1/media/'.length);
    }
    if (raw.endsWith('/index.m3u8') || raw.endsWith('.m3u8')) {
      return path.posix.dirname(raw);
    }
    if (raw.includes('/')) {
      const dir = path.posix.dirname(raw);
      if (dir === '.' || dir === '/') return raw;
      if (raw.startsWith('covers/') || raw.startsWith('uploads/') || raw.startsWith('docs/')) {
        return raw;
      }
      return dir;
    }
    return raw;
  }

  /** Delete R2 objects referenced by media URLs (CDN/HLS prefixes or single keys). */
  async purgeUrls(urls: Array<string | null | undefined>): Promise<number> {
    if (!this.hasCredentials()) return 0;
    const prefixes = new Set<string>();
    const singleKeys = new Set<string>();
    for (const url of urls) {
      const key = this.mediaPrefixFromUrl(url);
      if (!key) continue;
      const ext = path.posix.extname(key).toLowerCase();
      if (!ext || key.startsWith('hls/')) {
        prefixes.add(key.replace(/\/(index\.m3u8|.*\.m3u8)$/i, '') || key);
      } else if (ext === '.m3u8' || ext === '.ts') {
        prefixes.add(path.posix.dirname(key));
      } else {
        singleKeys.add(key);
      }
    }
    let deleted = 0;
    for (const prefix of prefixes) {
      deleted += await this.deletePrefix(prefix);
    }
    if (singleKeys.size) {
      deleted += await this.deleteKeys([...singleKeys]);
    }
    return deleted;
  }

  private guessContentType(key: string): string {
    if (key.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (key.endsWith('.ts') || key.endsWith('.m2ts') || key.endsWith('.mts')) return 'video/mp2t';
    if (key.endsWith('.mp4') || key.endsWith('.m4v')) return 'video/mp4';
    if (key.endsWith('.webm')) return 'video/webm';
    if (key.endsWith('.mov')) return 'video/quicktime';
    if (key.endsWith('.mkv')) return 'video/x-matroska';
    if (key.endsWith('.avi')) return 'video/x-msvideo';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
    if (key.endsWith('.png')) return 'image/png';
    if (key.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  }
}
