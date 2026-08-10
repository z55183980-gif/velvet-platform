# Velvet Telegram Sidecar

Telethon-backed local HTTP service for admin ingest of public Telegram channel videos
(including posts that only show “Please open Telegram to view this post” in the web embed).

## Endpoints (bind 127.0.0.1)

- `GET /health`
- `POST /probe` — `{ channel, mode: "recent"|"range", recentN?, fromId?, toId?, mediaOnly? }`
- `POST /thumb` — `{ channel, messageId }` → Telegram thumbnail/cover as base64 (not full video)
- `POST /download` — `{ channel, messageId }` → writes under `UPLOAD_DIR`, returns `uploads/...` path

## Local (Windows / macOS)

1. Create venv (prefer 3.10–3.12) and install deps under `services/telegram-sidecar`.
2. Copy `.env` from the template below (same API `STORAGE_ROOT/uploads` + `storage/telegram` session).
3. Prefer copying an authorized `*.session` from the server, or run `python -m app.login` once.
4. API `.env`: `TELEGRAM_SIDECAR_URL=http://127.0.0.1:4110`
5. Start: `pnpm dev:telegram` (repo root) while `pnpm dev:api` / admin run as usual.
6. Avoid running local + production sidecars against the **same** session at the same time (MTProto may kick one side).

Example `.env`:

```bash
HOST=127.0.0.1
PORT=4110
UPLOAD_DIR=<repo>/services/api/storage/uploads
TELEGRAM_SESSION_PATH=<repo>/services/api/storage/telegram/velvet
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
```

## First-time session

```bash
cd services/telegram-sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export TELEGRAM_API_ID=...
export TELEGRAM_API_HASH=...
export TELEGRAM_SESSION_PATH=/path/to/storage/telegram/velvet
python -m app.login   # interactive phone + code
```

## Run

```bash
export UPLOAD_DIR=/path/to/storage/uploads   # same as API STORAGE_ROOT/uploads
export HOST=127.0.0.1 PORT=4110
python run.py
```

PM2 example:

```bash
pm2 start run.py --name velvet-telegram --interpreter .venv/bin/python --cwd /www/wwwroot/velvet-platform/services/telegram-sidecar
```
