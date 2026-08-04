/**
 * Velvet CDN Worker — HMAC-gated R2 media.
 * Query: ?sig=&exp=  (sig = base64url HMAC-SHA256 of `${objectKey}:${exp}` with CDN_SIGN_KEY)
 * m3u8 playlists are rewritten so relative .ts / child playlists carry fresh signatures.
 */
export interface Env {
  MEDIA: R2Bucket;
  CDN_SIGN_KEY: string;
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signPath(pathKey: string, exp: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
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
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      let rewritten = line;
      const re = /URI="([^"]+)"/gi;
      const matches = [...line.matchAll(re)];
      for (const m of matches) {
        const signed = await signUri(playlistKey, m[1], exp, secret);
        rewritten = rewritten.replace(`URI="${m[1]}"`, `URI="${signed}"`);
      }
      out.push(rewritten);
      continue;
    }
    out.push(await signUri(playlistKey, trimmed, exp, secret));
  }
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

    const obj = await env.MEDIA.get(objectKey);
    if (!obj) return new Response("Not Found", { status: 404 });

    const headers = new Headers();
    headers.set("Content-Type", contentTypeFor(objectKey, obj));
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", objectKey.endsWith(".m3u8") ? "private, max-age=10" : "public, max-age=86400");
    headers.set("Access-Control-Allow-Origin", "*");

    if (request.method === "HEAD") {
      headers.set("Content-Length", String(obj.size));
      return new Response(null, { status: 200, headers });
    }

    if (objectKey.endsWith(".m3u8")) {
      const text = await obj.text();
      const rewritten = await rewritePlaylist(text, objectKey, exp, env.CDN_SIGN_KEY);
      headers.set("Content-Length", String(new TextEncoder().encode(rewritten).byteLength));
      return new Response(rewritten, { status: 200, headers });
    }

    headers.set("ETag", obj.httpEtag);
    if (obj.uploaded) headers.set("Last-Modified", obj.uploaded.toUTCString());
    return new Response(obj.body, { status: 200, headers });
  },
};
