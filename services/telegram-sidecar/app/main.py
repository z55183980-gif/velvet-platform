"""Velvet Telegram sidecar — Telethon probe/download for admin R2 ingest."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from telethon import TelegramClient
from telethon.errors import ChannelPrivateError, FloodWaitError, UsernameNotOccupiedError
from telethon.tl.types import (
    DocumentAttributeFilename,
    DocumentAttributeVideo,
    Message,
    MessageMediaDocument,
    MessageMediaPhoto,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("velvet-telegram")

TME_RE = re.compile(
    r"(?:https?://)?(?:t\.me|telegram\.me)/(?:s/)?(?P<channel>[A-Za-z0-9_]+)/(?P<msgid>\d+)",
    re.I,
)
CHANNEL_RE = re.compile(
    r"(?:https?://)?(?:t\.me|telegram\.me)/(?:s/)?(?P<channel>[A-Za-z0-9_]+)/?$",
    re.I,
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    telegram_api_id: int = Field(alias="TELEGRAM_API_ID", default=0)
    telegram_api_hash: str = Field(alias="TELEGRAM_API_HASH", default="")
    telegram_session_path: str = Field(
        alias="TELEGRAM_SESSION_PATH",
        default="./data/velvet-telegram",
    )
    upload_dir: str = Field(alias="UPLOAD_DIR", default="./uploads")
    host: str = Field(alias="HOST", default="127.0.0.1")
    port: int = Field(alias="PORT", default=4110)


settings = Settings()
_client: TelegramClient | None = None
_client_lock = asyncio.Lock()


def session_file_base() -> str:
    path = Path(settings.telegram_session_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Telethon appends .session; strip if caller passed it.
    return str(path.with_suffix("")) if path.suffix == ".session" else str(path)


def uploads_abs() -> Path:
    p = Path(settings.upload_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p.resolve()


async def get_client() -> TelegramClient:
    global _client
    async with _client_lock:
        if _client is None:
            if not settings.telegram_api_id or not settings.telegram_api_hash:
                raise HTTPException(
                    status_code=503,
                    detail="TELEGRAM_API_ID / TELEGRAM_API_HASH not configured",
                )
            _client = TelegramClient(
                session_file_base(),
                settings.telegram_api_id,
                settings.telegram_api_hash,
            )
            await _client.connect()
        if not await _client.is_user_authorized():
            raise HTTPException(
                status_code=503,
                detail="Telegram session not authorized — run: python -m app.login",
            )
        return _client


def parse_channel(raw: str) -> tuple[str, int | None]:
    text = (raw or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="channel required")
    m = TME_RE.search(text)
    if m:
        return m.group("channel"), int(m.group("msgid"))
    m2 = CHANNEL_RE.search(text)
    if m2:
        return m2.group("channel"), None
    if re.fullmatch(r"[A-Za-z0-9_]+", text):
        return text, None
    raise HTTPException(status_code=400, detail=f"invalid channel/url: {text}")


def media_info(msg: Message) -> dict[str, Any] | None:
    if not msg or not msg.media:
        return None
    media = msg.media
    if isinstance(media, MessageMediaPhoto):
        return {
            "mediaKind": "photo",
            "hasVideo": False,
            "size": None,
            "duration": None,
            "filename": None,
        }
    if isinstance(media, MessageMediaDocument) and media.document:
        doc = media.document
        size = int(getattr(doc, "size", 0) or 0)
        duration = None
        filename = None
        is_video = False
        for attr in doc.attributes or []:
            if isinstance(attr, DocumentAttributeVideo):
                is_video = True
                duration = float(getattr(attr, "duration", 0) or 0) or None
            if isinstance(attr, DocumentAttributeFilename):
                filename = attr.file_name
        mime = (getattr(doc, "mime_type", "") or "").lower()
        if mime.startswith("video/") or is_video:
            return {
                "mediaKind": "video",
                "hasVideo": True,
                "size": size or None,
                "duration": duration,
                "filename": filename,
            }
        if mime.startswith("audio/"):
            return {
                "mediaKind": "audio",
                "hasVideo": False,
                "size": size or None,
                "duration": duration,
                "filename": filename,
            }
        return {
            "mediaKind": "document",
            "hasVideo": False,
            "size": size or None,
            "duration": duration,
            "filename": filename,
        }
    return None


def message_title(msg: Message, fallback: str) -> str:
    text = (msg.message or "").strip()
    if text:
        first = text.splitlines()[0].strip()
        return first[:120] if first else fallback
    return fallback


class ProbeBody(BaseModel):
    channel: str
    mode: Literal["recent", "range"] = "recent"
    recentN: int | None = Field(default=20, ge=1, le=500)
    fromId: int | None = Field(default=None, ge=1)
    toId: int | None = Field(default=None, ge=1)
    mediaOnly: bool = True


class DownloadBody(BaseModel):
    channel: str
    messageId: int = Field(ge=1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info(
        "telegram sidecar starting host=%s port=%s upload=%s session=%s",
        settings.host,
        settings.port,
        uploads_abs(),
        session_file_base(),
    )
    yield
    global _client
    if _client is not None:
        await _client.disconnect()
        _client = None


app = FastAPI(title="Velvet Telegram Sidecar", lifespan=lifespan)


@app.get("/health")
async def health():
    configured = bool(settings.telegram_api_id and settings.telegram_api_hash)
    session_path = Path(session_file_base() + ".session")
    session_exists = session_path.is_file()
    authorized = False
    user = None
    error = None
    if configured and session_exists:
        try:
            client = await get_client()
            authorized = True
            me = await client.get_me()
            user = {
                "id": me.id,
                "username": me.username,
                "phone": me.phone,
            }
        except HTTPException as e:
            error = e.detail
        except Exception as e:  # noqa: BLE001
            error = str(e)
    return {
        "ok": True,
        "configured": configured,
        "sessionExists": session_exists,
        "authorized": authorized,
        "user": user,
        "error": error,
        "uploadDir": str(uploads_abs()),
    }


@app.post("/probe")
async def probe(body: ProbeBody):
    channel, hint_id = parse_channel(body.channel)
    client = await get_client()
    try:
        entity = await client.get_entity(channel)
    except UsernameNotOccupiedError as e:
        raise HTTPException(status_code=404, detail=f"channel not found: {channel}") from e
    except ChannelPrivateError as e:
        raise HTTPException(
            status_code=403,
            detail=f"channel private or session not a member: {channel}",
        ) from e
    except FloodWaitError as e:
        raise HTTPException(status_code=429, detail=f"flood wait {e.seconds}s") from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e

    items: list[dict[str, Any]] = []

    try:
        if body.mode == "range":
            lo = body.fromId or hint_id
            hi = body.toId or hint_id
            if lo is None or hi is None:
                raise HTTPException(
                    status_code=400,
                    detail="range mode requires fromId/toId (or a t.me/channel/id url)",
                )
            if lo > hi:
                lo, hi = hi, lo
            # Fetch inclusive ids via get_messages ids=list
            ids = list(range(lo, hi + 1))
            # Chunk to avoid huge requests
            for i in range(0, len(ids), 100):
                chunk = ids[i : i + 100]
                msgs = await client.get_messages(entity, ids=chunk)
                for msg in msgs:
                    if not isinstance(msg, Message) or msg.id is None:
                        continue
                    info = media_info(msg)
                    if body.mediaOnly and (not info or not info.get("hasVideo")):
                        continue
                    items.append(_item(channel, msg, info))
        else:
            limit = int(body.recentN or 20)
            async for msg in client.iter_messages(entity, limit=limit):
                if not isinstance(msg, Message):
                    continue
                info = media_info(msg)
                if body.mediaOnly and (not info or not info.get("hasVideo")):
                    continue
                items.append(_item(channel, msg, info))
    except FloodWaitError as e:
        raise HTTPException(status_code=429, detail=f"flood wait {e.seconds}s") from e

    # Oldest → newest for ingest numbering
    items.sort(key=lambda x: x["messageId"])
    return {
        "channel": channel,
        "count": len(items),
        "items": items,
    }


def _item(channel: str, msg: Message, info: dict[str, Any] | None) -> dict[str, Any]:
    mid = int(msg.id)
    info = info or {
        "mediaKind": "none",
        "hasVideo": False,
        "size": None,
        "duration": None,
        "filename": None,
    }
    title = message_title(msg, f"{channel}/{mid}")
    date = msg.date
    if isinstance(date, datetime) and date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return {
        "messageId": mid,
        "date": date.isoformat() if isinstance(date, datetime) else None,
        "title": title,
        "text": (msg.message or "")[:500],
        "mediaKind": info["mediaKind"],
        "hasVideo": bool(info.get("hasVideo")),
        "size": info.get("size"),
        "duration": info.get("duration"),
        "filename": info.get("filename"),
        "webpageUrl": f"https://t.me/{channel}/{mid}",
    }


@app.post("/download")
async def download(body: DownloadBody):
    channel, _ = parse_channel(body.channel)
    client = await get_client()
    try:
        entity = await client.get_entity(channel)
        msg = await client.get_messages(entity, ids=body.messageId)
    except FloodWaitError as e:
        raise HTTPException(status_code=429, detail=f"flood wait {e.seconds}s") from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e

    if not isinstance(msg, Message) or not msg.media:
        raise HTTPException(status_code=404, detail="message has no media")

    info = media_info(msg)
    if not info or not info.get("hasVideo"):
        raise HTTPException(status_code=400, detail="message is not a video")

    dest_dir = uploads_abs()
    # Unique name under uploads/
    stamp = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    safe_channel = re.sub(r"[^A-Za-z0-9_]+", "_", channel)[:40]
    base_name = info.get("filename") or f"tg-{safe_channel}-{body.messageId}.mp4"
    base_name = Path(base_name).name
    if not Path(base_name).suffix:
        base_name = f"{base_name}.mp4"
    filename = f"{stamp}-{safe_channel}-{body.messageId}-{base_name}"
    dest = dest_dir / filename

    try:
        path = await client.download_media(msg, file=str(dest))
    except FloodWaitError as e:
        raise HTTPException(status_code=429, detail=f"flood wait {e.seconds}s") from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"download failed: {e}") from e

    if not path:
        raise HTTPException(status_code=500, detail="download returned empty path")
    abs_path = Path(path).resolve()
    size = abs_path.stat().st_size
    # Nest UploadService expects uploads/<filename> relative to STORAGE_ROOT
    relative = f"uploads/{abs_path.name}"
    return {
        "channel": channel,
        "messageId": body.messageId,
        "filename": abs_path.name,
        "absolutePath": str(abs_path),
        "relativePath": relative,
        "size": size,
        "duration": info.get("duration"),
        "title": message_title(msg, f"{channel}/{body.messageId}"),
        "webpageUrl": f"https://t.me/{channel}/{body.messageId}",
    }


def main():
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
