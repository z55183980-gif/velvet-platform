# Velvet Telegram Sidecar

Telethon-backed local HTTP service for admin ingest of public Telegram channel videos
(including posts that only show “Please open Telegram to view this post” in the web embed).

## Endpoints (bind 127.0.0.1)

- `GET /health`
- `POST /probe` — `{ channel, mode: "recent"|"range", recentN?, fromId?, toId?, mediaOnly? }`
- `POST /download` — `{ channel, messageId }` → writes under `UPLOAD_DIR`, returns `uploads/...` path

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
