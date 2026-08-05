#!/usr/bin/env python3
"""
Download a short public landscape trailer → HLS → R2 velvet-media → upsert one LIVE drama.

Isolation: prefix samples/land-smoke/ and slug land-smoke-hls only.
Designed to run on the production host (needs ffmpeg + services/api/.env).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_ENV = Path("/www/wwwroot/velvet-platform/services/api/.env")
API_DIR = Path("/www/wwwroot/velvet-platform/services/api")
WORK = Path("/tmp/velvet-land-smoke")
PREFIX = "samples/land-smoke"
SLUG = "land-smoke-hls"
CDN_HOST = "https://cdn.velvetmovie.space"
CLIP_SEC = 5
EPISODES = 2

# Public landscape samples (W3C / Blender). Tried in order.
SOURCE_URLS = [
    "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4",
]


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def run(cmd: list[str], **kw) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, **kw)


def aws_sign(
    method: str,
    host: str,
    canonical_uri: str,
    payload: bytes,
    ak: str,
    sk: str,
    content_type: str | None = None,
):
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
    canonical_request = "\n".join(
        [method, canonical_uri, "", canonical_headers, signed_headers, payload_hash]
    )
    scope = f"{date_stamp}/auto/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )

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


def put_object(host: str, bucket: str, key: str, body: bytes, ak: str, sk: str, content_type: str) -> None:
    uri = f"/{bucket}/{key}"
    headers = aws_sign("PUT", host, uri, body, ak, sk, content_type)
    req = urllib.request.Request(f"https://{host}{uri}", data=body, method="PUT", headers=headers)
    with urllib.request.urlopen(req, timeout=180) as resp:
        if resp.status not in (200, 204):
            raise RuntimeError(f"PUT {key} -> {resp.status}")


def content_type_for(path: Path) -> str:
    if path.suffix == ".m3u8":
        return "application/vnd.apple.mpegurl"
    if path.suffix == ".ts":
        return "video/mp2t"
    if path.suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    return "application/octet-stream"


def download_source(cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    for url in SOURCE_URLS:
        name = url.rstrip("/").split("/")[-1] or "source.mp4"
        dest = cache / name
        if dest.exists() and dest.stat().st_size > 100_000:
            print(f"reuse cache {dest}", flush=True)
            return dest
        print(f"download {url}", flush=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "velvet-land-smoke/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                dest.write_bytes(resp.read())
            if dest.stat().st_size > 100_000:
                return dest
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"WARN download failed: {e}", flush=True)
            if dest.exists():
                dest.unlink(missing_ok=True)
    raise RuntimeError("could not download any public landscape source")


def to_landscape_hls(src: Path, out_dir: Path, start_sec: float) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    mp4 = out_dir / "source.mp4"
    # Keep 16:9 landscape (letterbox pad if needed).
    vf = (
        "scale=1280:720:force_original_aspect_ratio=decrease,"
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1"
    )
    cmd = ["ffmpeg", "-y"]
    if start_sec > 0:
        cmd += ["-ss", str(start_sec)]
    cmd += [
        "-t",
        str(CLIP_SEC),
        "-i",
        str(src),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-shortest",
        str(mp4),
    ]
    run(cmd)

    cover = out_dir / "cover.jpg"
    run(["ffmpeg", "-y", "-i", str(mp4), "-vframes", "1", "-q:v", "3", str(cover)])

    playlist = out_dir / "index.m3u8"
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(mp4),
            "-c:v",
            "copy",
            "-c:a",
            "copy",
            "-f",
            "hls",
            "-hls_time",
            "2",
            "-hls_list_size",
            "0",
            "-hls_segment_filename",
            str(out_dir / "seg_%03d.ts"),
            str(playlist),
        ]
    )
    return playlist


def upload_tree(local_dir: Path, key_prefix: str, host: str, bucket: str, ak: str, sk: str) -> tuple[str, str | None]:
    cover_url = None
    for path in sorted(local_dir.iterdir()):
        if path.name == "source.mp4" or not path.is_file():
            continue
        key = f"{key_prefix}/{path.name}"
        body = path.read_bytes()
        print(f"upload s3://{bucket}/{key} ({len(body)} bytes)", flush=True)
        put_object(host, bucket, key, body, ak, sk, content_type_for(path))
        if path.name == "cover.jpg":
            cover_url = f"{CDN_HOST}/{key}"
    return f"{CDN_HOST}/{key_prefix}/index.m3u8", cover_url


def upsert_db(urls: list[str], cover_url: str | None) -> None:
    payload = {
        "slug": SLUG,
        "urls": urls,
        "durationSec": CLIP_SEC,
        "episodes": len(urls),
        "coverUrl": cover_url,
    }
    payload_path = API_DIR / "scripts" / "_upsert-land-smoke.json"
    js = API_DIR / "scripts" / "_upsert-land-smoke.js"
    payload_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    js.write_text(
        r"""
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const payload = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_upsert-land-smoke.json'), 'utf8'),
);

(async () => {
  const creator = await p.creator.findFirst({ orderBy: { id: 'asc' } });
  if (!creator) throw new Error('no creator');
  let category = await p.category.findFirst({ orderBy: { sortOrder: 'asc' } });
  if (!category) {
    category = await p.category.create({
      data: { slug: 'demo', nameVi: 'Demo', nameZh: '演示', sortOrder: 0 },
    });
  }

  const drama = await p.drama.upsert({
    where: { slug: payload.slug },
    create: {
      creatorId: creator.id,
      slug: payload.slug,
      titleVi: 'Landscape smoke (5s HLS)',
      titleZh: '横屏冒烟测片（5秒）',
      descriptionVi: 'Clip ngang ngắn từ mẫu công khai (Sintel), chỉ để kiểm thử letterbox.',
      descriptionZh: '公开横屏样片短剪（Sintel），用于联调 16:9 信箱播放。',
      coverUrl: payload.coverUrl || null,
      categorySlug: category.slug,
      tags: ['smoke', 'landscape', 'public', 'hls'],
      sourceType: 'R2',
      status: 'LIVE',
      lockMode: 'ALL_FREE',
      freeEpisodeCount: payload.episodes,
      totalEpisodes: payload.episodes,
      publishedAt: new Date(),
      isOfficial: true,
      externalRef: 'land-smoke-hls',
    },
    update: {
      titleVi: 'Landscape smoke (5s HLS)',
      titleZh: '横屏冒烟测片（5秒）',
      descriptionVi: 'Clip ngang ngắn từ mẫu công khai (Sintel), chỉ để kiểm thử letterbox.',
      descriptionZh: '公开横屏样片短剪（Sintel），用于联调 16:9 信箱播放。',
      coverUrl: payload.coverUrl || undefined,
      tags: ['smoke', 'landscape', 'public', 'hls'],
      status: 'LIVE',
      lockMode: 'ALL_FREE',
      freeEpisodeCount: payload.episodes,
      totalEpisodes: payload.episodes,
      publishedAt: new Date(),
      sourceType: 'R2',
      isOfficial: true,
      externalRef: 'land-smoke-hls',
    },
  });

  for (let i = 0; i < payload.urls.length; i++) {
    const ep = i + 1;
    const hlsUrl = payload.urls[i];
    await p.episode.upsert({
      where: { dramaId_episodeNumber: { dramaId: drama.id, episodeNumber: ep } },
      create: {
        dramaId: drama.id,
        episodeNumber: ep,
        title: `EP${ep}`,
        hlsUrl,
        durationSec: payload.durationSec,
        isFree: true,
        priceCredits: 0n,
        priceVnd: 0n,
        uploadStatus: 'COMPLETED',
        transcodeStatus: 'COMPLETED',
      },
      update: {
        title: `EP${ep}`,
        hlsUrl,
        durationSec: payload.durationSec,
        isFree: true,
        priceCredits: 0n,
        priceVnd: 0n,
        uploadStatus: 'COMPLETED',
        transcodeStatus: 'COMPLETED',
      },
    });
  }

  console.log(JSON.stringify({ ok: true, dramaId: String(drama.id), slug: drama.slug, urls: payload.urls }));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
""",
        encoding="utf-8",
    )
    run(["node", str(js)], cwd=str(API_DIR))


def main() -> int:
    if not API_ENV.exists():
        raise SystemExit(f"missing api env: {API_ENV}")
    env = load_env(API_ENV)
    ak = env.get("R2_ACCESS_KEY_ID") or ""
    sk = env.get("R2_SECRET_ACCESS_KEY") or ""
    endpoint = env.get("R2_ENDPOINT") or ""
    bucket = env.get("R2_MEDIA_BUCKET") or "velvet-media"
    if not ak or not sk or not endpoint:
        raise SystemExit("R2 credentials missing in api .env")
    host = endpoint.removeprefix("https://").removeprefix("http://").rstrip("/")

    WORK.mkdir(parents=True, exist_ok=True)
    src = download_source(WORK / "cache")
    starts = [0.0, 8.0]
    urls: list[str] = []
    cover: str | None = None
    for i in range(EPISODES):
        ep = i + 1
        ep_dir = WORK / f"ep{ep:02d}"
        print(f"=== build episode {ep} ===", flush=True)
        to_landscape_hls(src, ep_dir, starts[i % len(starts)])
        hls, cov = upload_tree(ep_dir, f"{PREFIX}/ep{ep:02d}", host, bucket, ak, sk)
        urls.append(hls)
        if not cover and cov:
            cover = cov
        print("cdn", hls, flush=True)

    print("=== upsert db ===", flush=True)
    upsert_db(urls, cover)
    print("DONE", SLUG, urls, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
