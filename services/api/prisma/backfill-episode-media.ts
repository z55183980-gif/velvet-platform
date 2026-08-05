import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

function compactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/g, '<media-url>')
    .split(/\r?\n/)
    .find(Boolean)
    ?.slice(0, 240) || 'unknown error';
}

type EpisodeRow = {
  id: bigint;
  hlsUrl: string | null;
  originalUrl: string | null;
};

type MediaDimensions = {
  width: number;
  height: number;
  orientation: 'LANDSCAPE' | 'PORTRAIT' | 'SQUARE';
};

function ffprobeBin() {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  return ffmpeg.replace(/ffmpeg(?=\.exe$|$)/i, 'ffprobe');
}

function r2Client() {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    endpoint,
    region: process.env.R2_REGION || 'auto',
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function getR2Bytes(client: S3Client, key: string) {
  const bucket = process.env.R2_MEDIA_BUCKET;
  if (!bucket) throw new Error('R2_MEDIA_BUCKET is missing');
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`empty R2 object: ${key}`);
  return Buffer.from(await response.Body.transformToByteArray());
}

function firstMediaUri(playlist: string) {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variant = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF'));
  if (variant >= 0) {
    const uri = lines.slice(variant + 1).find((line) => !line.startsWith('#'));
    if (uri) return { uri, playlist: true };
  }
  const uri = lines.find((line) => !line.startsWith('#'));
  return uri ? { uri, playlist: /\.m3u8(?:\?|$)/i.test(uri) } : null;
}

async function r2ProbeInput(client: S3Client, initialKey: string, tempDir: string): Promise<string> {
  let key = initialKey.replace(/^\/+/, '');
  for (let depth = 0; depth < 4 && /\.m3u8(?:\?|$)/i.test(key); depth += 1) {
    const playlist = (await getR2Bytes(client, key)).toString('utf8');
    const next = firstMediaUri(playlist);
    if (!next) throw new Error(`playlist has no media: ${key}`);
    const cleanUri = next.uri.split('?')[0];
    key = path.posix.normalize(path.posix.join(path.posix.dirname(key), cleanUri));
  }
  const bytes = await getR2Bytes(client, key);
  const extension = path.posix.extname(key) || '.bin';
  const target = path.join(tempDir, `probe${extension}`);
  await fs.writeFile(target, bytes);
  return target;
}

async function localProbeInput(initialPath: string): Promise<string> {
  let target = initialPath;
  for (let depth = 0; depth < 4 && /\.m3u8(?:\?|$)/i.test(target); depth += 1) {
    const playlist = await fs.readFile(target, 'utf8');
    const next = firstMediaUri(playlist);
    if (!next) throw new Error(`playlist has no media: ${target}`);
    target = path.resolve(path.dirname(target), next.uri.split('?')[0]);
  }
  return target;
}

async function resolveProbeInput(row: EpisodeRow, tempDir: string, client: S3Client | null) {
  const source = row.hlsUrl || row.originalUrl;
  if (!source) throw new Error('episode has no media URL');
  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    const ownCdn = process.env.CDN_BASE_URL ? new URL(process.env.CDN_BASE_URL).host : '';
    if (client && (url.host === ownCdn || url.host === 'cdn.velvetmovie.space')) {
      return r2ProbeInput(client, decodeURIComponent(url.pathname), tempDir);
    }
    return source;
  }
  const storageRoot = path.resolve(process.env.STORAGE_ROOT || './storage');
  return localProbeInput(path.resolve(storageRoot, source.replace(/^\/+/, '')));
}

async function probeDimensions(input: string): Promise<MediaDimensions> {
  const { stdout } = await execFileAsync(
    ffprobeBin(),
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_streams',
      '-of',
      'json',
      input,
    ],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const stream = JSON.parse(String(stdout))?.streams?.[0];
  let width = Number(stream?.width || 0);
  let height = Number(stream?.height || 0);
  if (width <= 0 || height <= 0) throw new Error('video dimensions unavailable');
  const sar = String(stream?.sample_aspect_ratio || '').match(/^(\d+):(\d+)$/);
  if (sar && Number(sar[2]) > 0) width = Math.round((width * Number(sar[1])) / Number(sar[2]));
  const rotation = Number(stream?.tags?.rotate ?? stream?.side_data_list?.[0]?.rotation ?? 0);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  return {
    width,
    height,
    orientation: width === height ? 'SQUARE' : width > height ? 'LANDSCAPE' : 'PORTRAIT',
  };
}

async function main() {
  const rows = await prisma.$queryRawUnsafe<EpisodeRow[]>(
    'SELECT "id", "hlsUrl", "originalUrl" FROM "episodes" WHERE "mediaWidth" IS NULL OR "mediaHeight" IS NULL OR "mediaOrientation" IS NULL ORDER BY "id"',
  );
  const client = r2Client();
  let updated = 0;
  const failed: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velvet-media-probe-'));
    try {
      const input = await resolveProbeInput(row, tempDir, client);
      const media = await probeDimensions(input);
      if (!dryRun) {
        await prisma.$executeRawUnsafe(
          'UPDATE "episodes" SET "mediaWidth" = $1, "mediaHeight" = $2, "mediaOrientation" = $3::"MediaOrientation", "updatedAt" = NOW() WHERE "id" = $4',
          media.width,
          media.height,
          media.orientation,
          row.id,
        );
      }
      updated += 1;
      console.log(`episode=${row.id.toString()} ${media.width}x${media.height} ${media.orientation}${dryRun ? ' dry-run' : ''}`);
    } catch (error: any) {
      failed.push({ id: row.id.toString(), error: compactError(error) });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  console.log(JSON.stringify({ scanned: rows.length, updated, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
