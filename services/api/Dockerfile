# Optional container image for velvet-api with yt-dlp preinstalled.
# Production can keep using PM2 — the API will auto-download yt-dlp into STORAGE_ROOT/bin
# when YTDLP_AUTO_INSTALL=true (default).
#
# Build (from monorepo root, after API is built):
#   pnpm --filter velvet-api build
#   docker build -f services/api/Dockerfile -t velvet-api .
#
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
  && curl -fsSL -o /usr/local/bin/yt-dlp \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && yt-dlp --version \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Expect a pre-built services/api tree (dist + deps) copied by CI, or mount at runtime.
# Minimal runtime layout:
COPY services/api/package.json ./
COPY services/api/dist ./dist
COPY services/api/prisma ./prisma
COPY services/api/node_modules ./node_modules

ENV NODE_ENV=production \
    PORT=4100 \
    YTDLP_BIN=/usr/local/bin/yt-dlp \
    YTDLP_AUTO_INSTALL=false \
    YTDLP_ENABLED=true

EXPOSE 4100
CMD ["node", "dist/src/main.js"]
