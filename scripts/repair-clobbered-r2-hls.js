/**
 * Restore R2 CDN hlsUrl for transfer-imported episodes that were clobbered by
 * refreshExternalUrlIfNeeded (sourcePageUrl re-resolve overwrote CDN URLs).
 *
 * Safe: only updates rows where
 *  - drama.sourceType is R2 or LOCAL
 *  - hlsUrl is third-party http(s)
 *  - R2 still has hls/{episodeId}/index.m3u8
 */
const { PrismaClient } = require('@prisma/client');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');

const p = new PrismaClient();

function env(k) {
  return (process.env[k] || '').trim();
}

(async () => {
  const dry = process.argv.includes('--dry');
  const cdnBase = (env('CDN_BASE_URL') || 'https://cdn.velvetmovie.space').replace(/\/$/, '');
  const bucket = env('R2_MEDIA_BUCKET') || 'velvet-media';
  const client = new S3Client({
    region: 'auto',
    endpoint: env('R2_ENDPOINT'),
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  });

  const candidates = await p.episode.findMany({
    where: {
      drama: { sourceType: { in: ['R2', 'LOCAL'] } },
      OR: [{ hlsUrl: { startsWith: 'http://' } }, { hlsUrl: { startsWith: 'https://' } }],
      NOT: {
        OR: [
          { hlsUrl: { contains: 'cdn.velvetmovie.space' } },
          { hlsUrl: { contains: '.r2.dev' } },
          { hlsUrl: { contains: 'r2.cloudflarestorage.com' } },
        ],
      },
    },
    select: {
      id: true,
      episodeNumber: true,
      hlsUrl: true,
      dramaId: true,
      drama: { select: { titleEn: true, sourceType: true } },
    },
    orderBy: [{ dramaId: 'asc' }, { episodeNumber: 'asc' }],
  });

  console.log('CANDIDATES', candidates.length);
  const pinExpiry = new Date('2099-01-01T00:00:00.000Z');
  let restored = 0;
  let missing = 0;

  for (const ep of candidates) {
    const key = `hls/${ep.id.toString()}/index.m3u8`;
    let exists = false;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      exists = true;
    } catch {
      exists = false;
    }
    const nextUrl = `${cdnBase}/hls/${ep.id.toString()}/index.m3u8`;
    console.log(
      JSON.stringify({
        dramaId: String(ep.dramaId),
        title: ep.drama.titleEn,
        n: ep.episodeNumber,
        id: String(ep.id),
        r2: exists,
        from: (ep.hlsUrl || '').slice(0, 90),
        to: nextUrl,
      }),
    );
    if (!exists) {
      missing += 1;
      continue;
    }
    if (!dry) {
      await p.episode.update({
        where: { id: ep.id },
        data: {
          hlsUrl: nextUrl,
          originalUrl: null,
          uploadStatus: 'COMPLETED',
          transcodeStatus: 'COMPLETED',
          resolvedExpiresAt: pinExpiry,
        },
      });
    }
    restored += 1;
  }

  console.log(JSON.stringify({ dry, restored, missing, candidates: candidates.length }));
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
