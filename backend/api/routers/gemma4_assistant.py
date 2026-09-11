"""Half-duplex voice assistant powered by a local Gemma 4 E4B server."""
from __future__ import annotations

import base64
import json
import logging
from typing import Annotated, Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from api.dependencies import require_local

router = APIRouter(prefix="/gemma4-assistant", tags=["gemma4-assistant"])
logger = logging.getLogger("omnivoice.gemma4_assistant")

MODEL_ID = "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive"
MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_HISTORY_TURNS = 12
DEFAULT_PERSONA = "You are a concise, helpful voice assistant. Reply in the language used by the user."
_AUDIO_FORMATS = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
}


class TextTurnRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    persona: str = DEFAULT_PERSONA
    history: list[dict[str, str]] = Field(default_factory=list)


def _backend():
    from services.llm_backend import OpenAICompatBackend
    from services.llm_providers import get_provider, resolve_base_url

    provider = get_provider("gemma4-local")
    if provider is None:  # pragma: no cover - registry invariant
        raise RuntimeError("Gemma 4 local provider is not registered")
    hostname = (urlsplit(resolve_base_url(provider)).hostname or "").lower()
    if hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Gemma 4 assistant requires a loopback model server")
    return OpenAICompatBackend(provider=provider)


def _history(raw: str) -> list[dict[str, str]]:
    if not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="history_json must be valid JSON") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=422, detail="history_json must be a list")
    messages: list[dict[str, str]] = []
    for item in parsed[-MAX_HISTORY_TURNS:]:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            raise HTTPException(status_code=422, detail="history entries need a user or assistant role")
        content = item.get("content")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=422, detail="history entries need non-empty text")
        messages.append({"role": item["role"], "content": content.strip()[:8000]})
    return messages


def _audio_format(audio: UploadFile) -> str:
    content_type = (audio.content_type or "").split(";", 1)[0].lower()
    fmt = _AUDIO_FORMATS.get(content_type)
    if fmt:
        return fmt
    filename = (audio.filename or "").lower()
    if filename.endswith(".wav"):
        return "wav"
    if filename.endswith((".mp3", ".mpeg")):
        return "mp3"
    raise HTTPException(status_code=415, detail="Gemma 4 accepts WAV or MP3 audio")


def _transcription_messages(audio_b64: str, audio_format: str) -> list[dict[str, Any]]:
    return [{
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": (
                    "Transcribe the speech exactly in its original language. "
                    "Return only the transcription, without commentary or quotation marks."
                ),
            },
            {"type": "input_audio", "input_audio": {"data": audio_b64, "format": audio_format}},
        ],
    }]


async def _answer(
    backend: Any,
    transcript: str,
    persona: str,
    history: list[dict[str, str]],
) -> dict[str, str]:
    import asyncio

    messages: list[dict[str, str]] = [
        {"role": "system", "content": (persona.strip() or DEFAULT_PERSONA)[:8000]},
        *history,
        {"role": "user", "content": transcript},
    ]
    reply = await asyncio.to_thread(
        backend.chat_messages,
        messages=messages,
        temperature=0.6,
    )
    if not reply.strip():
        raise RuntimeError("Gemma 4 returned an empty response")
    return {"transcript": transcript, "reply": reply.strip(), "model": backend.model_name}


def _unavailable(exc: Exception) -> HTTPException:
    logger.warning("Gemma 4 assistant turn failed: %s", exc)
    return HTTPException(
        status_code=503,
        detail=(
            "The local assistant model is unavailable. Run `bun run dev:gemma4-server` "
            "from the VoiceStudio checkout."
        ),
    )


@router.get("/status", dependencies=[Depends(require_local)])
def status() -> dict[str, Any]:
    """Report configuration without loading or downloading model weights."""
    from services import llm_providers

    provider = llm_providers.get_provider("gemma4-local")
    assert provider is not None
    return {
        "model": llm_providers.resolve_model(provider),
        "base_url": llm_providers.resolve_base_url(provider),
        "provider": provider.id,
    }


@router.post("/text-turn", dependencies=[Depends(require_local)])
async def text_turn(request: TextTurnRequest) -> dict[str, str]:
    """Reason over a typed message and return text for local TTS playback."""
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text must not be blank")
    try:
        return await _answer(
            _backend(),
            text,
            request.persona,
            _history(json.dumps(request.history)),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _unavailable(exc) from exc


@router.post("/turn", dependencies=[Depends(require_local)])
async def turn(
    audio: Annotated[UploadFile, File(...)],
    persona: Annotated[str, Form()] = DEFAULT_PERSONA,
    history_json: Annotated[str, Form()] = "[]",
) -> dict[str, str]:
    """Let Gemma listen, reason over the conversation, and return reply text."""
    audio_format = _audio_format(audio)
    audio_bytes = await audio.read(MAX_AUDIO_BYTES + 1)
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="audio is empty")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio exceeds the 20 MB limit")

    history = _history(history_json)
    backend = _backend()
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    try:
        import asyncio

        transcript = await asyncio.to_thread(
            backend.chat_messages,
            messages=_transcription_messages(encoded, audio_format),
            temperature=0.0,
        )
        transcript = transcript.strip()
        if not transcript:
            raise RuntimeError("Gemma 4 returned an empty transcription")

        return await _answer(backend, transcript, persona, history)
    except HTTPException:
        raise
    except Exception as exc:
        raise _unavailable(exc) from exc
