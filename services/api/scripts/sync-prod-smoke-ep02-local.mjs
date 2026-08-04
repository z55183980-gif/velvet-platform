import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(__dirname, "..");
const mediaAbs = join(apiRoot, "storage", "imports", "live-smoke");
const remoteHost = "starnexus-s4";
const remoteDir = "/www/wwwroot/velvet-platform/services/api/storage/imports/live-smoke";
const slug = "live-smoke-1785827828";

mkdirSync(mediaAbs, { recursive: true });
console.log("==> scp media from prod");
const scp = spawnSync(
  "scp",
  ["-o", "BatchMode=yes", "-r", `${remoteHost}:${remoteDir}/.`, `${mediaAbs}/`],
  { stdio: "inherit" },
);
if (scp.status !== 0) throw new Error(`scp failed: ${scp.status}`);

const needed = [
  "ep01.mp4",
  "ep02.mp4",
  "cover.jpg",
  "cover-ep02.jpg",
  "hls/index.m3u8",
  "hls/seg_000.ts",
  "hls-ep02/index.m3u8",
  "hls-ep02/seg_000.ts",
];
for (const rel of needed) {
  const p = join(mediaAbs, rel);
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  console.log("ok", rel);
}

const prisma = new PrismaClient();
try {
  const drama = await prisma.drama.findUnique({ where: { slug } });
  if (!drama) throw new Error(`local drama missing: ${slug}. sync ep1 first.`);

  await prisma.drama.update({
    where: { id: drama.id },
    data: {
      totalEpisodes: 2,
      freeEpisodeCount: 2,
      status: "LIVE",
      isHottest: true,
      isFeatured: true,
    },
  });

  const ep1 = await prisma.episode.findFirst({
    where: { dramaId: drama.id, episodeNumber: 1 },
  });
  if (!ep1) throw new Error("local EP01 missing");

  const ep2Data = {
    title: "EP02",
    hlsUrl: "imports/live-smoke/hls-ep02/index.m3u8",
    thumbnailUrl: "imports/live-smoke/cover-ep02.jpg",
    durationSec: 5,
    isFree: true,
    priceVnd: 0n,
    priceCredits: 0n,
    uploadStatus: "COMPLETED",
    transcodeStatus: "COMPLETED",
    originalUrl: "imports/live-smoke/ep02.mp4",
  };

  const existing = await prisma.episode.findFirst({
    where: { dramaId: drama.id, episodeNumber: 2 },
  });
  const ep2 = existing
    ? await prisma.episode.update({ where: { id: existing.id }, data: ep2Data })
    : await prisma.episode.create({
        data: { dramaId: drama.id, episodeNumber: 2, ...ep2Data },
      });

  console.log(
    JSON.stringify(
      {
        dramaId: drama.id.toString(),
        slug,
        ep1: ep1.id.toString(),
        ep2: ep2.id.toString(),
        totalEpisodes: 2,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
console.log("DONE_LOCAL");
