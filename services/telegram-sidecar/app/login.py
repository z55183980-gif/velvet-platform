"""Interactive Telethon login — run once on the server to create session file.

Usage (from services/telegram-sidecar):

  export TELEGRAM_API_ID=...
  export TELEGRAM_API_HASH=...
  export TELEGRAM_SESSION_PATH=/www/wwwroot/velvet-platform/services/api/storage/telegram/velvet
  python -m app.login
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from telethon import TelegramClient


def _session_base() -> str:
    raw = os.environ.get("TELEGRAM_SESSION_PATH", "./data/velvet-telegram")
    path = Path(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(path.with_suffix("")) if path.suffix == ".session" else str(path)


async def _run() -> None:
    api_id = int(os.environ.get("TELEGRAM_API_ID") or "0")
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    if not api_id or not api_hash:
        print("Set TELEGRAM_API_ID and TELEGRAM_API_HASH", file=sys.stderr)
        raise SystemExit(1)

    session = _session_base()
    print(f"Session file base: {session}.session")
    client = TelegramClient(session, api_id, api_hash)
    await client.start()
    me = await client.get_me()
    print(f"Authorized as id={me.id} username={me.username} phone={me.phone}")
    session_file = Path(session + ".session")
    try:
        session_file.chmod(0o600)
    except OSError:
        pass
    await client.disconnect()
    print("Login complete. Start the sidecar (pm2 / uvicorn).")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
