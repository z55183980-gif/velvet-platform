# velvet-cdn

HMAC-gated CDN Worker for Velvet media on Cloudflare R2 (`velvet-media` only).

- Hostname: `cdn.velvetmovie.space`
- Auth: `?sig=&exp=` where `sig = base64url(HMAC-SHA256(CDN_SIGN_KEY, "{objectKey}:{exp}"))`
- m3u8 responses are rewritten so relative segment URIs carry signatures
- Does **not** bind or modify other R2 buckets (`docs`, `pcp`, `gwj`, …)

```bash
export CLOUDFLARE_API_TOKEN=...
npm install --legacy-peer-deps
npx wrangler deploy
# Prefer API secret put over PowerShell piping:
# PUT /accounts/.../workers/scripts/velvet-cdn/secrets
```

`wrangler` is a **devDependency** only (deploy/dev toolchain). It is not shipped with API/web/admin production runtime. Keep it ≥4.59.1 (prefer current pin) so `pnpm audit` / `npm audit` on this package stay clear; CI gates on `pnpm audit --prod` for the monorepo.
