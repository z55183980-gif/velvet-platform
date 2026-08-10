import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(__dirname, "..");
const storageRoot = join(apiRoot, "storage");
const mediaRel = "imports/live-smoke";
const mediaAbs = join(storageRoot, mediaRel);

const remoteHost = "starnexus-s4";
const remoteDir = "/www/wwwroot/velvet-platform/services/api/storage/imports/live-smoke";

function scpTree() {
  mkdirSync(mediaAbs, { recursive: true });
  const scp = spawnSync(
    "scp",
    ["-o", "BatchMode=yes", "-r", `${remoteHost}:${remoteDir}/.`, `${mediaAbs}/`],
    { stdio: "inherit", shell: false },
  );
  if (scp.status !== 0) {
    throw new Error(`scp failed with status ${scp.status}`);
  }
}

async function upsertDb() {
  const prisma = new PrismaClient();
  try {
    let creator = await prisma.creator.findFirst({ orderBy: { id: "asc" } });
    if (!creator) throw new Error("local DB has no creators; run prisma seed first");

    let categorySlug = "costume";
    const cat = await prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!cat) {
      const any = await prisma.category.findFirst({ orderBy: { slug: "asc" } });
      if (!any) throw new Error("local DB has no categories; run prisma seed first");
      categorySlug = any.slug;
    }

    const slug = "live-smoke-1785827828";
    const coverUrl = `${mediaRel}/cover.jpg`;
    const hlsUrl = `${mediaRel}/hls/index.m3u8`;
    const originalUrl = `${mediaRel}/ep01.mp4`;

    const drama = await prisma.drama.upsert({
      where: { slug },
      create: {
        slug,
        creatorId: creator.id,
        titleVi: "Smoke test phat that (5s)",
        titleZh: "真实播放冒烟测试（5秒）",
        descriptionVi: "Video mau 5 giay dung de kiem tra phat that.",
        descriptionZh: "线上自行抓取的 5 秒短视频，用于验证真实播放链路。",
        categorySlug,
        tags: ["smoke", "demo"],
        coverUrl,
        totalEpisodes: 1,
        freeEpisodeCount: 1,
        status: "LIVE",
        isOfficial: true,
        isFeatured: true,
        sortWeight: 9999,
        isHottest: true,
        hottestSortOrder: 1,
        publishedAt: new Date(),
      },
      update: {
        titleVi: "Smoke test phat that (5s)",
        titleZh: "真实播放冒烟测试（5秒）",
        descriptionVi: "Video mau 5 giay dung de kiem tra phat that.",
        descriptionZh: "线上自行抓取的 5 秒短视频，用于验证真实播放链路。",
        categorySlug,
        tags: ["smoke", "demo"],
        coverUrl,
        totalEpisodes: 1,
        freeEpisodeCount: 1,
        status: "LIVE",
        isOfficial: true,
        isFeatured: true,
        sortWeight: 9999,
        isHottest: true,
        hottestSortOrder: 1,
        publishedAt: new Date(),
      },
    });

    const existingEp = await prisma.episode.findFirst({
      where: { dramaId: drama.id, episodeNumber: 1 },
    });

    const episode = existingEp
      ? await prisma.episode.update({
          where: { id: existingEp.id },
          data: {
            title: "EP01",
            hlsUrl,
            thumbnailUrl: coverUrl,
            durationSec: 5,
            isFree: true,
            priceVnd: 0n,
            priceCredits: 0n,
            uploadStatus: "COMPLETED",
            transcodeStatus: "COMPLETED",
            originalUrl,
          },
        })
      : await prisma.episode.create({
          data: {
            dramaId: drama.id,
            episodeNumber: 1,
            title: "EP01",
            hlsUrl,
            thumbnailUrl: coverUrl,
            durationSec: 5,
            isFree: true,
            priceVnd: 0n,
            priceCredits: 0n,
            uploadStatus: "COMPLETED",
            transcodeStatus: "COMPLETED",
            originalUrl,
          },
        });

    return {
      dramaId: drama.id.toString(),
      episodeId: episode.id.toString(),
      slug: drama.slug,
      coverUrl,
      hlsUrl,
      mediaAbs,
      creatorId: creator.id.toString(),
      categorySlug,
    };
  } finally {
    await prisma.$disconnect();
  }
}

mkdirSync(storageRoot, { recursive: true });
console.log("==> pull media from prod");
scpTree();
const needed = [
  join(mediaAbs, "ep01.mp4"),
  join(mediaAbs, "cover.jpg"),
  join(mediaAbs, "hls", "index.m3u8"),
  join(mediaAbs, "hls", "seg_000.ts"),
];
for (const f of needed) {
  if (!existsSync(f)) throw new Error(`missing after transfer: ${f}`);
  console.log("ok", f);
}

console.log("==> upsert local DB");
const result = await upsertDb();
console.log(JSON.stringify(result, null, 2));
console.log("DONE");
