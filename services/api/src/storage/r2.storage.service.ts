import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  S3Client,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

/** Thin R2 (S3-compatible) helper. Only uses configured Velvet buckets. */
@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return (this.config.get<string>('STORAGE_BACKEND') || 'local').toLowerCase() === 'r2';
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

  private guessContentType(key: string): string {
    if (key.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (key.endsWith('.ts')) return 'video/mp2t';
    if (key.endsWith('.mp4')) return 'video/mp4';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
    if (key.endsWith('.png')) return 'image/png';
    return 'application/octet-stream';
  }
}
