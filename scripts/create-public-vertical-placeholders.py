#!/usr/bin/env python3
"""
Build public sample vertical placeholder dramas on production:
  download open trailers/samples → 9:16 HLS → R2 → upsert 5 dramas × 3 eps
  then delete seed placeholders d01–d09.

Keeps velvet-cdn-demo-5ep and live-smoke-* untouched.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_ENV = Path("/www/wwwroot/velvet-platform/services/api/.env")
API_DIR = Path("/www/wwwroot/velvet-platform/services/api")
WORK = Path("/tmp/velvet-public-vplaceholders")
PREFIX = "samples/public-vph"
CDN_HOST = "https://cdn.velvetmovie.space"
CLIP_SEC = 8

PREFERRED_URLS = [
    "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "https://media.w3.org/2010/05/sintel/trailer_hd.mp4",
]

DRAMAS = [
    {
        "slug": "pub-vph-01",
        "titleZh": "竖屏测片 · 霓虹侧影",
        "titleVi": "Clip dọc · Neon",
        "descZh": "公开样片竖屏占位（W3C Sintel / SampleLib），仅供联调播放。",
        "descVi": "Placeholder dọc từ mẫu công khai, chỉ để kiểm thử phát.",
        "categorySlug": "romance",
        "tags": ["placeholder", "public", "vertical"],
    },
    {
        "slug": "pub-vph-02",
        "titleZh": "竖屏测片 · 镜前时刻",
        "titleVi": "Clip dọc · Gương",
        "descZh": "公开样片竖屏占位（W3C Sintel / SampleLib），仅供联调播放。",
        "descVi": "Placeholder dọc từ mẫu công khai, chỉ để kiểm thử phát.",
        "categorySlug": "thanh_xuan",
        "tags": ["placeholder", "public", "vertical"],
    },
    {
        "slug": "pub-vph-03",
        "titleZh": "竖屏测片 · 城市节奏",
        "titleVi": "Clip dọc · Nhịp đô thị",
        "descZh": "公开样片竖屏占位（W3C Sintel / SampleLib），仅供联调播放。",
        "descVi": "Placeholder dọc từ mẫu công khai, chỉ để kiểm thử phát.",
        "categorySlug": "urban",
        "tags": ["placeholder", "public", "vertical"],
    },
    {
        "slug": "pub-vph-04",
        "titleZh": "竖屏测片 · 运动光影",
        "titleVi": "Clip dọc · Chuyển động",
        "descZh": "公开样片竖屏占位（W3C Sintel / SampleLib），仅供联调播放。",
        "descVi": "Placeholder dọc từ mẫu công khai, chỉ để kiểm thử phát.",
        "categorySlug": "action",
        "tags": ["placeholder", "public", "vertical"],
    },
    {
        "slug": "pub-vph-05",
        "titleZh": "竖屏测片 · 日常切片",
        "titleVi": "Clip dọc · Slice of life",
        "descZh": "公开样片竖屏占位（W3C Sintel / SampleLib），仅供联调播放。",
        "descVi": "Placeholder dọc từ mẫu công khai, chỉ để kiểm thử phát.",
        "categorySlug": "romance",
        "tags": ["placeholder", "public", "vertical"],
    },
]

SEED_SLUGS = [f"d{i:02d}" for i in range(1, 10)]


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
    if path.suffix in (".jpg", ".jpeg"):
        return "image/jpeg"
    return "application/octet-stream"


def head_ok(url: str) -> bool:
    try:
        out = subprocess.check_output(
            [
                "curl",
                "-sSIL",
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                "--connect-timeout",
                "10",
                "--max-time",
                "20",
                "-A",
                "Mozilla/5.0",
                url,
            ],
            text=True,
        ).strip()
        code = int(out[-3:]) if out else 0
        return 200 <= code < 400
    except Exception as e:
        print(f"skip {url}: {e}", flush=True)
        return False


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"download {url}", flush=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    run(
        [
            "curl",
            "-fL",
            "--retry",
            "2",
            "--connect-timeout",
            "20",
            "--max-time",
            "120",
            "-A",
            "Mozilla/5.0",
            "-o",
            str(tmp),
            url,
        ]
    )
    tmp.replace(dest)
    print(f"  -> {dest} ({dest.stat().st_size} bytes)", flush=True)


def download_cache(url: str, cache_dir: Path) -> Path | None:
    safe = hashlib.sha1(url.encode()).hexdigest()[:16]
    dest = cache_dir / f"{safe}.mp4"
    if dest.exists() and dest.stat().st_size > 50_000:
        return dest
    if not head_ok(url):
        return None
    try:
        download(url, dest)
        if dest.stat().st_size < 50_000:
            dest.unlink(missing_ok=True)
            return None
        return dest
    except Exception as e:
        print(f"download fail {url}: {e}", flush=True)
        dest.unlink(missing_ok=True)
        return None


def collect_jobs(n: int) -> list[tuple[Path, float]]:
    cache = WORK / "raw"
    cache.mkdir(parents=True, exist_ok=True)
    locals_unique: list[Path] = []

    # Reuse any already-downloaded usable mp4 first (avoid flaky third-party CDNs).
    for path in sorted(cache.glob("*.mp4")):
        if path.is_file() and path.stat().st_size > 50_000 and path not in locals_unique:
            locals_unique.append(path)

    for url in PREFERRED_URLS:
        path = download_cache(url, cache)
        if path and path not in locals_unique:
            locals_unique.append(path)

    if not locals_unique:
        raise RuntimeError("no public source clips downloaded")

    jobs: list[tuple[Path, float]] = []
    starts = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]
    for start in starts:
        for path in locals_unique:
            if len(jobs) >= n:
                break
            jobs.append((path, float(start)))
        if len(jobs) >= n:
            break
    if len(jobs) < n:
        raise RuntimeError(f"need {n} clips, got {len(jobs)}")
    return jobs[:n]


def to_vertical_hls_from_source(src: Path, out_dir: Path, start_sec: float = 0) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    mp4 = out_dir / "source.mp4"
    vf = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1"
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
        "-an",
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


def upload_tree(local_dir: Path, key_prefix: str, host: str, bucket: str, ak: str, sk: str) -> str:
    for path in sorted(local_dir.iterdir()):
        if path.name == "source.mp4" or not path.is_file():
            continue
        key = f"{key_prefix}/{path.name}"
        body = path.read_bytes()
        print(f"upload s3://{bucket}/{key} ({len(body)} bytes)", flush=True)
        put_object(host, bucket, key, body, ak, sk, content_type_for(path))
    return f"{CDN_HOST}/{key_prefix}/index.m3u8"


def upsert_and_wipe(payload: dict) -> None:
    js = API_DIR / "scripts" / "_upsert-public-vph.js"
    payload_path = API_DIR / "scripts" / "_upsert-public-vph.json"
    payload_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    js.write_text(
        r"""
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const payload = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_upsert-public-vph.json'), 'utf8'),
);

(async () => {
  const creator = await p.creator.findFirst({ orderBy: { id: 'asc' } });
  if (!creator) throw new Error('no creator');

  const results = [];
  for (const d of payload.dramas) {
    let category = await p.category.findUnique({ where: { slug: d.categorySlug } });
    if (!category) category = await p.category.findFirst({ orderBy: { sortOrder: 'asc' } });
    if (!category) throw new Error('no category');

    const drama = await p.drama.upsert({
      where: { slug: d.slug },
      create: {
        creatorId: creator.id,
        slug: d.slug,
        titleVi: d.titleVi,
        titleZh: d.titleZh,
        descriptionVi: d.descVi,
        descriptionZh: d.descZh,
        coverUrl: d.coverUrl || null,
        categorySlug: category.slug,
        tags: d.tags,
        sourceType: 'LOCAL',
        status: 'LIVE',
        lockMode: 'ALL_FREE',
        freeEpisodeCount: d.episodes.length,
        totalEpisodes: d.episodes.length,
        publishedAt: new Date(),
        isOfficial: true,
        externalRef: `public-vph:${d.slug}`,
      },
      update: {
        titleVi: d.titleVi,
        titleZh: d.titleZh,
        descriptionVi: d.descVi,
        descriptionZh: d.descZh,
        coverUrl: d.coverUrl || undefined,
        categorySlug: category.slug,
        tags: d.tags,
        status: 'LIVE',
        lockMode: 'ALL_FREE',
        freeEpisodeCount: d.episodes.length,
        totalEpisodes: d.episodes.length,
        publishedAt: new Date(),
        sourceType: 'LOCAL',
        isOfficial: true,
        externalRef: `public-vph:${d.slug}`,
      },
    });

    for (const ep of d.episodes) {
      await p.episode.upsert({
        where: { dramaId_episodeNumber: { dramaId: drama.id, episodeNumber: ep.no } },
        create: {
          dramaId: drama.id,
          episodeNumber: ep.no,
          title: ep.title,
          hlsUrl: ep.hlsUrl,
          durationSec: ep.durationSec,
          isFree: true,
          priceCredits: 0n,
          priceVnd: 0n,
          uploadStatus: 'COMPLETED',
          transcodeStatus: 'COMPLETED',
        },
        update: {
          title: ep.title,
          hlsUrl: ep.hlsUrl,
          durationSec: ep.durationSec,
          isFree: true,
          priceCredits: 0n,
          priceVnd: 0n,
          uploadStatus: 'COMPLETED',
          transcodeStatus: 'COMPLETED',
        },
      });
    }
    results.push({ slug: drama.slug, id: String(drama.id), eps: d.episodes.length });
  }

  const wiped = [];
  for (const slug of payload.wipeSlugs) {
    const drama = await p.drama.findUnique({ where: { slug } });
    if (!drama) continue;
    try {
      await p.episode.deleteMany({ where: { dramaId: drama.id } });
      await p.drama.delete({ where: { id: drama.id } });
      wiped.push({ slug, action: 'deleted' });
    } catch (e) {
      await p.drama.update({ where: { id: drama.id }, data: { status: 'OFFLINE' } });
      wiped.push({ slug, action: 'offline', err: String(e.message || e) });
    }
  }

  console.log(JSON.stringify({ ok: true, results, wiped }, null, 2));
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
        print("missing api env", file=sys.stderr)
        return 1
    env = load_env(API_ENV)
    ak = env.get("R2_ACCESS_KEY_ID") or ""
    sk = env.get("R2_SECRET_ACCESS_KEY") or ""
    endpoint = env.get("R2_ENDPOINT") or ""
    bucket = env.get("R2_MEDIA_BUCKET") or "velvet-media"
    if not ak or not sk or not endpoint:
        print("R2 credentials missing", file=sys.stderr)
        return 1
    host = re.sub(r"^https?://", "", endpoint).rstrip("/")

    # Keep previously downloaded raw sources if present.
    WORK.mkdir(parents=True, exist_ok=True)
    for child in WORK.iterdir():
        if child.name != "raw":
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()

    need = len(DRAMAS) * 3
    print(f"=== collect {need} public clip jobs ===", flush=True)
    jobs = collect_jobs(need)

    drama_payload = []
    idx = 0
    for meta in DRAMAS:
        print(f"=== drama {meta['slug']} ===", flush=True)
        episodes = []
        cover_url = None
        for ep in range(1, 4):
            src, start = jobs[idx]
            idx += 1
            ep_dir = WORK / meta["slug"] / f"ep{ep:02d}"
            to_vertical_hls_from_source(src, ep_dir, start_sec=start)
            key_prefix = f"{PREFIX}/{meta['slug']}/ep{ep:02d}"
            hls = upload_tree(ep_dir, key_prefix, host, bucket, ak, sk)
            cover_local = ep_dir / "cover.jpg"
            if ep == 1 and cover_local.exists():
                cover_key = f"{PREFIX}/{meta['slug']}/cover.jpg"
                put_object(host, bucket, cover_key, cover_local.read_bytes(), ak, sk, "image/jpeg")
                cover_url = f"{CDN_HOST}/{cover_key}"
            episodes.append(
                {
                    "no": ep,
                    "title": f"第{ep}集",
                    "hlsUrl": hls,
                    "durationSec": CLIP_SEC,
                }
            )
            print("cdn", hls, flush=True)
        drama_payload.append({**meta, "coverUrl": cover_url, "episodes": episodes})

    print("=== upsert db + wipe seeds ===", flush=True)
    upsert_and_wipe({"dramas": drama_payload, "wipeSlugs": SEED_SLUGS})
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
