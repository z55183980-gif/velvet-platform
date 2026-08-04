/**
 * 从生产同步 LIVE 剧集元数据 + 媒资到本地：
 * 1) 生产机导出 dramas.json
 * 2) 从 R2 拉取 samples/* 对象 + scp imports/live-smoke
 * 3) 本地落盘到 storage/，按 slug upsert DB，CDN 绝对 URL 改写为相对路径
 *
 * 用法（仓库根或本目录）：
 *   node services/api/scripts/sync-prod-videos-local.mjs
 */
import { createRequire } from "node:module";
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(__dirname, "..");
const storageRoot = join(apiRoot, "storage");
const remoteHost = process.env.VELVET_PROD_SSH || "starnexus-s4";
const remoteApi = "/www/wwwroot/velvet-platform/services/api";
const workLocal = join(apiRoot, ".tmp-prod-video-sync");
const tarName = "velvet-prod-video-sync.tgz";

const REMOTE_PACK = String.raw`#!/usr/bin/env python3
import hashlib, hmac, json, os, shutil, subprocess, sys, urllib.parse, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

API = Path("${remoteApi}")
ENV_PATH = API / ".env"
OUT = Path("/tmp/velvet-prod-video-sync")
STORAGE_OUT = OUT / "storage"
IMPORTS_SRC = API / "storage" / "imports"
CDN_PREFIXES = ["samples/cdn-demo-5ep/", "samples/public-vph/"]

def load_env(path: Path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def aws_sign(method, host, canonical_uri, canonical_query, payload, ak, sk, content_type=None):
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(payload).hexdigest()
    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if content_type:
        headers["content-type"] = content_type
    signed = sorted(headers)
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in signed)
    signed_headers = ";".join(signed)
    canonical_request = "\n".join([
        method, canonical_uri, canonical_query,
        canonical_headers, signed_headers, payload_hash,
    ])
    scope = f"{date_stamp}/auto/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])
    def _hmac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()
    k_date = _hmac(("AWS4" + sk).encode(), date_stamp)
    k_region = _hmac(k_date, "auto")
    k_service = _hmac(k_region, "s3")
    k_signing = _hmac(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
    headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={ak}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return headers

def list_all(host, bucket, prefix, ak, sk):
    keys = []
    token = None
    while True:
        q = {
            "list-type": "2",
            "prefix": prefix,
            "max-keys": "1000",
        }
        if token:
            q["continuation-token"] = token
        # AWS requires query params sorted & encoded for signing
        items = sorted((k, v) for k, v in q.items())
        canonical_query = "&".join(
            f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
            for k, v in items
        )
        uri = f"/{bucket}"
        headers = aws_sign("GET", host, uri, canonical_query, b"", ak, sk)
        url = f"https://{host}{uri}?{canonical_query}"
        req = urllib.request.Request(url, method="GET", headers=headers)
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read()
        root = ET.fromstring(body)
        ns = ""
        if root.tag.startswith("{"):
            ns = root.tag.split("}")[0] + "}"
        for c in root.findall(f"{ns}Contents"):
            key = c.findtext(f"{ns}Key")
            if key and not key.endswith("/"):
                keys.append(key)
        truncated = root.findtext(f"{ns}IsTruncated")
        if truncated == "true":
            token = root.findtext(f"{ns}NextContinuationToken")
            if not token:
                break
        else:
            break
    return keys

def get_object(host, bucket, key, ak, sk) -> bytes:
    uri = f"/{bucket}/{key}"
    headers = aws_sign("GET", host, uri, "", b"", ak, sk)
    req = urllib.request.Request(f"https://{host}{uri}", method="GET", headers=headers)
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read()

def export_dramas():
    js = r'''
const {PrismaClient}=require("@prisma/client");
const p=new PrismaClient();
(async()=>{
  const dramas=await p.drama.findMany({
    where:{status:"LIVE"},
    orderBy:{id:"asc"},
    include:{episodes:{orderBy:{episodeNumber:"asc"}}}
  });
  const j=(v)=>JSON.stringify(v,(_k,x)=>typeof x==="bigint"?x.toString():x);
  process.stdout.write(j({exportedAt:new Date().toISOString(), dramas}));
  await p.$disconnect();
})().catch(e=>{console.error(e); process.exit(1);});
'''
    return subprocess.check_output(["node", "-e", js], cwd=str(API))

def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    STORAGE_OUT.mkdir(parents=True)
    env = load_env(ENV_PATH)
    ak = env["R2_ACCESS_KEY_ID"]
    sk = env["R2_SECRET_ACCESS_KEY"]
    account = env["R2_ACCOUNT_ID"]
    bucket = env["R2_MEDIA_BUCKET"]
    host = f"{account}.r2.cloudflarestorage.com"
    cdn = env.get("CDN_BASE_URL", "https://cdn.velvetmovie.space").rstrip("/")

    print("==> export dramas.json", flush=True)
    (OUT / "dramas.json").write_bytes(export_dramas())

    print("==> copy local imports", flush=True)
    if IMPORTS_SRC.exists():
        shutil.copytree(IMPORTS_SRC, STORAGE_OUT / "imports")

    print("==> download R2 prefixes", flush=True)
    all_keys = []
    for prefix in CDN_PREFIXES:
        keys = list_all(host, bucket, prefix, ak, sk)
        print(f"  {prefix}: {len(keys)} objects", flush=True)
        all_keys.extend(keys)

    for i, key in enumerate(all_keys, 1):
        dest = STORAGE_OUT / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        data = get_object(host, bucket, key, ak, sk)
        dest.write_bytes(data)
        if i % 20 == 0 or i == len(all_keys):
            print(f"  downloaded {i}/{len(all_keys)}", flush=True)

    meta = {
        "cdnBase": cdn,
        "objectCount": len(all_keys),
        "prefixes": CDN_PREFIXES,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    tar_path = Path("/tmp") / "velvet-prod-video-sync.tgz"
    if tar_path.exists():
        tar_path.unlink()
    subprocess.check_call(["tar", "-czf", str(tar_path), "-C", str(OUT), "."])
    print(f"DONE package={tar_path} size={tar_path.stat().st_size}", flush=True)

if __name__ == "__main__":
    main()
`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${r.status}`);
  }
}

function rewriteMediaUrl(url, cdnBase) {
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return url.replace(/^\/+/, "");
  const base = (cdnBase || "https://cdn.velvetmovie.space").replace(/\/$/, "");
  if (url.startsWith(base + "/")) {
    return decodeURIComponent(url.slice(base.length + 1).split("?")[0]);
  }
  // 其它外链保留
  return url;
}

async function upsertLocal(bundleDir) {
  const payload = JSON.parse(readFileSync(join(bundleDir, "dramas.json"), "utf8"));
  const meta = existsSync(join(bundleDir, "meta.json"))
    ? JSON.parse(readFileSync(join(bundleDir, "meta.json"), "utf8"))
    : {};
  const cdnBase = meta.cdnBase || "https://cdn.velvetmovie.space";

  // merge storage
  const srcStorage = join(bundleDir, "storage");
  if (!existsSync(srcStorage)) throw new Error("bundle missing storage/");
  mkdirSync(storageRoot, { recursive: true });
  cpSync(srcStorage, storageRoot, { recursive: true });

  const prisma = new PrismaClient();
  const summary = [];
  try {
    let creator = await prisma.creator.findFirst({ orderBy: { id: "asc" } });
    if (!creator) throw new Error("local DB has no creators; run prisma seed first");

    for (const d of payload.dramas || []) {
      let categorySlug = d.categorySlug;
      const cat = await prisma.category.findUnique({ where: { slug: categorySlug } });
      if (!cat) {
        const any = await prisma.category.findFirst({ orderBy: { slug: "asc" } });
        if (!any) throw new Error("local DB has no categories; run prisma seed first");
        categorySlug = any.slug;
      }

      const coverUrl = rewriteMediaUrl(d.coverUrl, cdnBase);
      const dramaData = {
        creatorId: creator.id,
        titleVi: d.titleVi,
        titleZh: d.titleZh,
        descriptionVi: d.descriptionVi,
        descriptionZh: d.descriptionZh,
        categorySlug,
        tags: d.tags || [],
        coverUrl,
        externalRef: d.externalRef || null,
        totalEpisodes: d.totalEpisodes ?? (d.episodes?.length || 0),
        freeEpisodeCount: d.freeEpisodeCount ?? 3,
        lockMode: d.lockMode || null,
        buyoutCredits: d.buyoutCredits != null ? BigInt(d.buyoutCredits) : null,
        status: "LIVE",
        sourceType: d.sourceType || "LOCAL",
        isOfficial: !!d.isOfficial,
        isFeatured: !!d.isFeatured,
        sortWeight: d.sortWeight ?? 0,
        isHottest: !!d.isHottest,
        hottestSortOrder: d.hottestSortOrder ?? 0,
        publishedAt: d.publishedAt ? new Date(d.publishedAt) : new Date(),
      };

      // externalRef is unique — clear conflict if slug remaps
      if (dramaData.externalRef) {
        const clash = await prisma.drama.findUnique({
          where: { externalRef: dramaData.externalRef },
        });
        if (clash && clash.slug !== d.slug) {
          await prisma.drama.update({
            where: { id: clash.id },
            data: { externalRef: null },
          });
        }
      }

      const drama = await prisma.drama.upsert({
        where: { slug: d.slug },
        create: { slug: d.slug, ...dramaData },
        update: dramaData,
      });

      let epCount = 0;
      for (const e of d.episodes || []) {
        const epData = {
          title: e.title,
          hlsUrl: rewriteMediaUrl(e.hlsUrl, cdnBase),
          thumbnailUrl: rewriteMediaUrl(e.thumbnailUrl, cdnBase),
          durationSec: e.durationSec ?? 0,
          isFree: e.isFree !== false,
          priceVnd: BigInt(e.priceVnd ?? 0),
          priceCredits: BigInt(e.priceCredits ?? 0),
          uploadStatus: e.uploadStatus || "COMPLETED",
          transcodeStatus: e.transcodeStatus || "COMPLETED",
          originalUrl: rewriteMediaUrl(e.originalUrl, cdnBase),
        };
        const existing = await prisma.episode.findFirst({
          where: { dramaId: drama.id, episodeNumber: e.episodeNumber },
        });
        if (existing) {
          await prisma.episode.update({ where: { id: existing.id }, data: epData });
        } else {
          await prisma.episode.create({
            data: {
              dramaId: drama.id,
              episodeNumber: e.episodeNumber,
              ...epData,
            },
          });
        }
        epCount += 1;

        // sanity: relative media should exist
        for (const rel of [epData.hlsUrl, epData.originalUrl, epData.thumbnailUrl]) {
          if (!rel || /^https?:\/\//i.test(rel)) continue;
          const abs = join(storageRoot, rel);
          if (!existsSync(abs)) {
            console.warn(`WARN missing media file: ${rel}`);
          }
        }
      }

      summary.push({
        slug: drama.slug,
        dramaId: drama.id.toString(),
        episodes: epCount,
        coverUrl,
      });
      console.log(`upsert ${drama.slug} episodes=${epCount}`);
    }
  } finally {
    await prisma.$disconnect();
  }
  return summary;
}

mkdirSync(workLocal, { recursive: true });
const extractDir = join(workLocal, "bundle");
const skipPack = process.env.SKIP_PACK === "1" || process.argv.includes("--upsert-only");

if (!skipPack) {
  const remotePy = "/tmp/velvet-pack-prod-videos.py";
  const localPy = join(workLocal, "pack-remote.py");
  writeFileSync(localPy, REMOTE_PACK.replaceAll("\r\n", "\n"), "utf8");

  console.log("==> upload packer to prod");
  run("scp", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", localPy, `${remoteHost}:${remotePy}`]);

  console.log("==> pack on prod (R2 + imports + dramas.json)");
  run("ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=20",
    remoteHost,
    `python3 ${remotePy}`,
  ]);

  const localTar = join(workLocal, tarName);
  if (existsSync(localTar)) rmSync(localTar);
  console.log("==> scp package");
  run("scp", [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=20",
    `${remoteHost}:/tmp/${tarName}`,
    localTar,
  ]);

  if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  console.log("==> extract");
  run("tar", ["-xzf", localTar, "-C", extractDir]);
} else {
  console.log("==> SKIP_PACK: reuse existing bundle");
  if (!existsSync(join(extractDir, "dramas.json"))) {
    throw new Error(`missing ${join(extractDir, "dramas.json")}; run without --upsert-only first`);
  }
}

console.log("==> upsert local DB + merge storage");
const summary = await upsertLocal(extractDir);
console.log(JSON.stringify({ ok: true, dramas: summary.length, summary }, null, 2));
console.log("DONE");
