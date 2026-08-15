/**
 * Velvet CDN Worker — HMAC-gated R2 media.
 * Query: ?sig=&exp=  (sig = base64url HMAC-SHA256 of `${objectKey}:${exp}` with CDN_SIGN_KEY)
 * m3u8 playlists are rewritten so relative .ts / child playlists carry fresh signatures.
 * Supports RFC 7233 Range requests for progressive media.
 */
export interface Env {
  MEDIA: R2Bucket;
  CDN_SIGN_KEY: string;
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

let cachedSigningSecret: string | null = null;
let cachedSigningKey: Promise<CryptoKey> | null = null;

function signingKey(secret: string): Promise<CryptoKey> {
  if (!cachedSigningKey || cachedSigningSecret !== secret) {
    cachedSigningSecret = secret;
    cachedSigningKey = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return cachedSigningKey;
}

async function signPath(pathKey: string, exp: number, secret: string): Promise<string> {
  const key = await signingKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${pathKey}:${exp}`),
  );
  return b64url(sig);
}

function normalizeKey(pathname: string): string {
  return decodeURIComponent(pathname.replace(/^\/+/, ""));
}

async function signUri(
  playlistKey: string,
  uri: string,
  exp: number,
  secret: string,
): Promise<string> {
  if (!uri || /^https?:\/\//i.test(uri) || /^data:/i.test(uri)) return uri;
  const hashIdx = uri.indexOf("#");
  const hash = hashIdx >= 0 ? uri.slice(hashIdx) : "";
  const noHash = hashIdx >= 0 ? uri.slice(0, hashIdx) : uri;
  const qIdx = noHash.indexOf("?");
  const pathOnly = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const existingQ = qIdx >= 0 ? noHash.slice(qIdx + 1) : "";
  const dir = playlistKey.includes("/") ? playlistKey.slice(0, playlistKey.lastIndexOf("/")) : "";
  let target: string;
  if (pathOnly.startsWith("/")) target = pathOnly.replace(/^\/+/, "");
  else {
    const combined = dir ? `${dir}/${pathOnly}` : pathOnly;
    target = combined
      .split("/")
      .reduce<string[]>((acc, part) => {
        if (!part || part === ".") return acc;
        if (part === "..") {
          acc.pop();
          return acc;
        }
        acc.push(part);
        return acc;
      }, [])
      .join("/");
  }
  const params = new URLSearchParams(existingQ);
  params.set("sig", await signPath(target, exp, secret));
  params.set("exp", String(exp));
  return `${pathOnly}?${params.toString()}${hash}`;
}

async function rewritePlaylist(body: string, playlistKey: string, exp: number, secret: string) {
  const endsWithNl = /\r?\n$/.test(body);
  const lines = body.split(/\r?\n/);
  // A media playlist can contain dozens of segments. Signing them serially made
  // manifest TTFB grow linearly with episode length, so resolve independent
  // entries concurrently while preserving their original order.
  const out = await Promise.all(lines.map(async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return line;
    }
    if (trimmed.startsWith("#")) {
      let rewritten = line;
      const re = /URI="([^"]+)"/gi;
      const matches = [...line.matchAll(re)];
      const signedUris = await Promise.all(
        matches.map((m) => signUri(playlistKey, m[1], exp, secret)),
      );
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const signed = signedUris[i];
        rewritten = rewritten.replace(`URI="${m[1]}"`, `URI="${signed}"`);
      }
      return rewritten;
    }
    return signUri(playlistKey, trimmed, exp, secret);
  }));
  const joined = out.join("\n");
  return endsWithNl ? `${joined}\n` : joined;
}

function contentTypeFor(key: string, obj: R2ObjectBody): string {
  if (obj.httpMetadata?.contentType) return obj.httpMetadata.contentType;
  if (key.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (key.endsWith(".ts")) return "video/mp2t";
  if (key.endsWith(".m4s")) return "video/iso.segment";
  if (key.endsWith(".mp4")) return "video/mp4";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

/** Parse a single-range `bytes=start-end` header. Returns null if absent/unsupported. */
function parseBytesRange(
  header: string | null,
  size: number,
): { offset: number; length: number; start: number; end: number } | null {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  let start = m[1] === "" ? NaN : Number.parseInt(m[1], 10);
  let end = m[2] === "" ? NaN : Number.parseInt(m[2], 10);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    // suffix bytes: bytes=-N
    const suffix = end;
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (start < 0 || end < start || start >= size) return null;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1, start, end };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const url = new URL(request.url);
    const objectKey = normalizeKey(url.pathname);
    if (!objectKey || objectKey.endsWith("/")) {
      return new Response("Not Found", { status: 404 });
    }

    if (!env.CDN_SIGN_KEY) {
      return new Response("CDN_SIGN_KEY missing", { status: 500 });
    }

    const expRaw = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    if (!sig || !expRaw) return new Response("Missing sig/exp", { status: 401 });
    const exp = Number.parseInt(expRaw, 10);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      return new Response("Expired", { status: 401 });
    }
    const expected = await signPath(objectKey, exp, env.CDN_SIGN_KEY);
    if (expected.length !== sig.length) return new Response("Forbidden", { status: 403 });
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (mismatch !== 0) return new Response("Forbidden", { status: 403 });

    const rangeHeader = request.headers.get("Range");
    const wantsRange = Boolean(rangeHeader) && !objectKey.endsWith(".m3u8");

    // Head first when Range requested so we can validate bounds before streaming.
    let obj: R2ObjectBody | null = null;
    if (wantsRange) {
      const head = await env.MEDIA.head(objectKey);
      if (!head) return new Response("Not Found", { status: 404 });
      const parsed = parseBytesRange(rangeHeader, head.size);
      if (!parsed) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: {
            "Content-Range": `bytes */${head.size}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
      obj = await env.MEDIA.get(objectKey, {
        range: { offset: parsed.offset, length: parsed.length },
      });
      if (!obj) return new Response("Not Found", { status: 404 });

      const headers = new Headers();
      headers.set("Content-Type", contentTypeFor(objectKey, obj));
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "public, max-age=86400");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Content-Range", `bytes ${parsed.start}-${parsed.end}/${head.size}`);
      headers.set("Content-Length", String(parsed.length));
      if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
      if (obj.uploaded) headers.set("Last-Modified", obj.uploaded.toUTCString());

      if (request.method === "HEAD") {
        return new Response(null, { status: 206, headers });
      }
      return new Response(obj.body, { status: 206, headers });
    }

    obj = await env.MEDIA.get(objectKey);
    if (!obj) return new Response("Not Found", { status: 404 });

    const headers = new Headers();
    headers.set("Content-Type", contentTypeFor(objectKey, obj));
    headers.set("Accept-Ranges", "bytes");
    headers.set(
      "Cache-Control",
      objectKey.endsWith(".m3u8") ? "private, max-age=10" : "public, max-age=86400",
    );
    headers.set("Access-Control-Allow-Origin", "*");

    if (request.method === "HEAD") {
      headers.set("Content-Length", String(obj.size));
      return new Response(null, { status: 200, headers });
    }

    if (objectKey.endsWith(".m3u8")) {
      const text = await obj.text();
      const rewritten = await rewritePlaylist(text, objectKey, exp, env.CDN_SIGN_KEY);
      headers.set("Content-Length", String(new TextEncoder().encode(rewritten).byteLength));
      headers.set("Accept-Ranges", "none");
      return new Response(rewritten, { status: 200, headers });
    }

    headers.set("ETag", obj.httpEtag);
    if (obj.uploaded) headers.set("Last-Modified", obj.uploaded.toUTCString());
    headers.set("Content-Length", String(obj.size));
    return new Response(obj.body, { status: 200, headers });
  },
};
