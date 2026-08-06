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
    if (key.endsWith('.ts')) return 'video/mp2t';
    if (key.endsWith('.mp4')) return 'video/mp4';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
    if (key.endsWith('.png')) return 'image/png';
    if (key.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  }
}
