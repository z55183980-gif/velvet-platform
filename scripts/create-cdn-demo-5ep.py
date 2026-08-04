#!/usr/bin/env python3
"""
Generate a 5-episode short demo on the production host:
  ffmpeg color bars → HLS → upload to R2 velvet-media → upsert Drama/Episodes.

Isolation: only touches bucket velvet-media under prefix samples/cdn-demo-5ep/
and DB slug velvet-cdn-demo-5ep. Does not alter docs/pcp/gwj buckets.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_ENV = Path("/www/wwwroot/velvet-platform/services/api/.env")
WORK = Path("/tmp/velvet-cdn-demo-5ep")
PREFIX = "samples/cdn-demo-5ep"
SLUG = "velvet-cdn-demo-5ep"
CDN_HOST = "https://cdn.velvetmovie.space"
EPISODES = 5
DURATION = 4  # seconds each


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


def aws_sign(method: str, host: str, canonical_uri: str, payload: bytes, ak: str, sk: str, content_type: str | None = None):
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
    with urllib.request.urlopen(req, timeout=120) as resp:
        if resp.status not in (200, 204):
            raise RuntimeError(f"PUT {key} -> {resp.status}")


def content_type_for(path: Path) -> str:
    if path.suffix == ".m3u8":
        return "application/vnd.apple.mpegurl"
    if path.suffix == ".ts":
        return "video/mp2t"
    if path.suffix == ".mp4":
        return "video/mp4"
    return "application/octet-stream"


def make_episode(ep: int, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    mp4 = out_dir / "source.mp4"
    # Distinct color per episode (no drawtext/font dependency on server)
    colors = ["0xE53935", "0x43A047", "0x1E88E5", "0xFB8C00", "0x8E24AA"]
    color = colors[(ep - 1) % len(colors)]
    run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s=720x1280:d={DURATION}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency={440 + ep * 40}:duration={DURATION}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(mp4),
        ]
    )
    playlist = out_dir / "index.m3u8"
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(mp4),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-ac",
            "2",
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


def upload_tree(local_ep_dir: Path, ep: int, host: str, bucket: str, ak: str, sk: str) -> str:
    key_prefix = f"{PREFIX}/ep{ep:02d}"
    for path in sorted(local_ep_dir.iterdir()):
        if path.name == "source.mp4":
            continue  # keep CDN media bucket lean; HLS enough
        if not path.is_file():
            continue
        key = f"{key_prefix}/{path.name}"
        body = path.read_bytes()
        print(f"upload s3://{bucket}/{key} ({len(body)} bytes)", flush=True)
        put_object(host, bucket, key, body, ak, sk, content_type_for(path))
    return f"{CDN_HOST}/{key_prefix}/index.m3u8"


def upsert_db(urls: list[str]) -> None:
    api_dir = Path("/www/wwwroot/velvet-platform/services/api")
    js = api_dir / "scripts" / "_upsert-cdn-demo.js"
    js.parent.mkdir(parents=True, exist_ok=True)
    payload_path = api_dir / "scripts" / "_upsert-cdn-demo.json"
    payload = {
        "slug": SLUG,
        "urls": urls,
        "durationSec": DURATION,
        "episodes": EPISODES,
    }
    payload_path.write_text(json.dumps(payload), encoding="utf-8")
    js.write_text(
        r"""
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const payload = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_upsert-cdn-demo.json'), 'utf8'),
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
      titleVi: 'Velvet CDN Demo (5 tập ngắn)',
      titleZh: 'Velvet CDN 示例（5集短视频）',
      descriptionVi: 'Video demo HLS trên R2/CDN, mỗi tập vài giây.',
      descriptionZh: 'R2/CDN HLS 示例剧，每集约数秒。',
      categorySlug: category.slug,
      tags: ['demo', 'cdn', 'hls'],
      sourceType: 'LOCAL',
      status: 'LIVE',
      lockMode: 'ALL_FREE',
      freeEpisodeCount: payload.episodes,
      totalEpisodes: payload.episodes,
      publishedAt: new Date(),
      isOfficial: true,
    },
    update: {
      titleVi: 'Velvet CDN Demo (5 tập ngắn)',
      titleZh: 'Velvet CDN 示例（5集短视频）',
      status: 'LIVE',
      lockMode: 'ALL_FREE',
      freeEpisodeCount: payload.episodes,
      totalEpisodes: payload.episodes,
      publishedAt: new Date(),
      sourceType: 'LOCAL',
      tags: ['demo', 'cdn', 'hls'],
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

  console.log(JSON.stringify({
    ok: true,
    dramaId: String(drama.id),
    uuid: drama.uuid,
    slug: drama.slug,
    episodes: payload.urls,
  }, null, 2));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
""",
        encoding="utf-8",
    )
    run(["node", str(js)], cwd=str(api_dir))


def main() -> int:
    if not API_ENV.exists():
        print("missing api env", file=sys.stderr)
        return 1
    env = load_env(API_ENV)
    ak = env.get("R2_ACCESS_KEY_ID") or ""
    sk = env.get("R2_SECRET_ACCESS_KEY") or ""
    endpoint = env.get("R2_ENDPOINT") or ""
    bucket = env.get("R2_MEDIA_BUCKET") or "velvet-media"
    if not ak or not sk or not endpoint:
        print("R2 credentials missing in api .env", file=sys.stderr)
        return 1
    host = re.sub(r"^https?://", "", endpoint).rstrip("/")

    WORK.mkdir(parents=True, exist_ok=True)
    urls: list[str] = []
    for ep in range(1, EPISODES + 1):
        ep_dir = WORK / f"ep{ep:02d}"
        print(f"=== build episode {ep} ===", flush=True)
        make_episode(ep, ep_dir)
        url = upload_tree(ep_dir, ep, host, bucket, ak, sk)
        urls.append(url)
        print("cdn", url, flush=True)

    print("=== upsert db ===", flush=True)
    upsert_db(urls)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
