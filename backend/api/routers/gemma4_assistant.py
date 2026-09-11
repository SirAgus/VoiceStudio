"""Half-duplex voice assistant powered by a local Gemma 4 E4B server."""
from __future__ import annotations

import base64
import json
import logging
from collections.abc import Iterator
from typing import Annotated, Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
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
    thread_id: UUID | None = None
    user_message_id: UUID | None = None
    assistant_message_id: UUID | None = None
    audio_requested: bool = True


class CreateThreadRequest(BaseModel):
    persona: str = DEFAULT_PERSONA


class AttachAudioRequest(BaseModel):
    audio_id: str = Field(min_length=1, max_length=64)
    profile_id: str = Field(default="", max_length=200)


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

    messages = _messages(transcript, persona, history)
    reply = await asyncio.to_thread(
        backend.chat_messages,
        messages=messages,
        temperature=0.6,
    )
    if not reply.strip():
        raise RuntimeError("Gemma 4 returned an empty response")
    return {"transcript": transcript, "reply": reply.strip(), "model": backend.model_name}


def _messages(
    transcript: str,
    persona: str,
    history: list[dict[str, str]],
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": (persona.strip() or DEFAULT_PERSONA)[:8000]},
        *history,
        {"role": "user", "content": transcript},
    ]


def _unavailable(exc: Exception) -> HTTPException:
    logger.warning("Gemma 4 assistant turn failed: %s", exc)
    return HTTPException(
        status_code=503,
        detail=(
            "The local assistant model is unavailable. Run `bun run dev:gemma4-server` "
            "from the VoiceStudio checkout."
        ),
    )


def _message_payload(message: dict[str, Any]) -> dict[str, Any]:
    result = dict(message)
    result["audio_requested"] = bool(result.get("audio_requested"))
    result["audio_url"] = (
        f"/gemma4-assistant/threads/{result['thread_id']}/messages/{result['id']}/audio"
        if result.get("audio_path")
        else None
    )
    result.pop("audio_path", None)
    return result


@router.get("/threads", dependencies=[Depends(require_local)])
def threads() -> list[dict[str, Any]]:
    from services import gemma4_conversations

    return gemma4_conversations.list_threads()


@router.post("/threads", dependencies=[Depends(require_local)])
def create_thread(request: CreateThreadRequest) -> dict[str, Any]:
    from services import gemma4_conversations

    return gemma4_conversations.create_thread((request.persona.strip() or DEFAULT_PERSONA)[:8000])


@router.get("/threads/{thread_id}", dependencies=[Depends(require_local)])
def get_thread(thread_id: UUID) -> dict[str, Any]:
    from services import gemma4_conversations

    thread = gemma4_conversations.get_thread(str(thread_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Conversation thread not found")
    thread["messages"] = [_message_payload(message) for message in thread["messages"]]
    return thread


@router.delete("/threads/{thread_id}", dependencies=[Depends(require_local)])
def delete_thread(thread_id: UUID) -> dict[str, bool]:
    from core.file_cleanup import FileCleanupError
    from services import gemma4_conversations

    try:
        deleted = gemma4_conversations.delete_thread(str(thread_id))
    except FileCleanupError as exc:
        raise HTTPException(status_code=500, detail="Could not delete conversation audio") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation thread not found")
    return {"deleted": True}


@router.delete(
    "/threads/{thread_id}/messages/{message_id}", dependencies=[Depends(require_local)]
)
def delete_message(thread_id: UUID, message_id: UUID) -> dict[str, bool]:
    from core.file_cleanup import FileCleanupError
    from services import gemma4_conversations

    try:
        deleted = gemma4_conversations.delete_message(str(thread_id), str(message_id))
    except FileCleanupError as exc:
        raise HTTPException(status_code=500, detail="Could not delete message audio") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation message not found")
    return {"deleted": True}


@router.put(
    "/threads/{thread_id}/messages/{message_id}/audio",
    dependencies=[Depends(require_local)],
)
def attach_audio(
    thread_id: UUID,
    message_id: UUID,
    request: AttachAudioRequest,
) -> dict[str, Any]:
    from services import gemma4_conversations

    try:
        message = gemma4_conversations.attach_generated_audio(
            str(thread_id), str(message_id), request.audio_id, request.profile_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Could not store message audio") from exc
    return _message_payload(message)


@router.get(
    "/threads/{thread_id}/messages/{message_id}/audio",
    dependencies=[Depends(require_local)],
)
def message_audio(thread_id: UUID, message_id: UUID) -> FileResponse:
    from services import gemma4_conversations

    path = gemma4_conversations.audio_file(str(thread_id), str(message_id))
    if path is None:
        raise HTTPException(status_code=404, detail="Conversation audio not found")
    return FileResponse(path, media_type="audio/wav", filename=f"{message_id}.wav")


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
        result = await _answer(
            _backend(),
            text,
            request.persona,
            _history(json.dumps(request.history)),
        )
        if request.thread_id:
            from services import gemma4_conversations

            user_message_id = str(request.user_message_id or uuid4())
            assistant_message_id = str(request.assistant_message_id or uuid4())
            gemma4_conversations.begin_turn(
                str(request.thread_id), text, request.persona, request.audio_requested,
                user_message_id, assistant_message_id,
            )
            gemma4_conversations.complete_message(
                str(request.thread_id), assistant_message_id, result["reply"]
            )
            result.update(
                user_message_id=user_message_id,
                assistant_message_id=assistant_message_id,
            )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise _unavailable(exc) from exc


@router.post("/text-turn/stream", dependencies=[Depends(require_local)])
def text_turn_stream(request: TextTurnRequest) -> StreamingResponse:
    """Stream visible reply fragments for a typed local-model turn."""
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text must not be blank")
    try:
        backend = _backend()
        messages = _messages(
            text,
            request.persona,
            _history(json.dumps(request.history)),
        )
        model_name = backend.model_name
        thread_id = str(request.thread_id) if request.thread_id else None
        user_message_id = str(request.user_message_id or uuid4())
        assistant_message_id = str(request.assistant_message_id or uuid4())
        if thread_id:
            from services import gemma4_conversations

            gemma4_conversations.begin_turn(
                thread_id,
                text,
                request.persona,
                request.audio_requested,
                user_message_id,
                assistant_message_id,
            )
    except HTTPException:
        raise
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Conversation thread not found") from exc
    except Exception as exc:
        raise _unavailable(exc) from exc

    def events() -> Iterator[str]:
        parts: list[str] = []
        try:
            for fragment in backend.stream_chat_messages(messages=messages, temperature=0.6):
                parts.append(fragment)
                yield json.dumps(
                    {"type": "delta", "text": fragment},
                    ensure_ascii=False,
                ) + "\n"
            reply = "".join(parts).strip()
            if not reply:
                raise RuntimeError("Gemma 4 returned an empty response")
            if thread_id:
                from services import gemma4_conversations

                gemma4_conversations.complete_message(thread_id, assistant_message_id, reply)
            done_event: dict[str, Any] = {
                "type": "done",
                "transcript": text,
                "reply": reply,
                "model": model_name,
            }
            if thread_id:
                done_event.update(
                    user_message_id=user_message_id,
                    assistant_message_id=assistant_message_id,
                )
            yield json.dumps(done_event, ensure_ascii=False) + "\n"
        except Exception as exc:
            if thread_id:
                from services import gemma4_conversations

                gemma4_conversations.fail_message(thread_id, assistant_message_id)
            logger.warning("Gemma 4 assistant stream failed: %s", exc)
            yield json.dumps(
                {"type": "error", "detail": _unavailable(exc).detail},
                ensure_ascii=False,
            ) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/turn", dependencies=[Depends(require_local)])
async def turn(
    audio: Annotated[UploadFile, File(...)],
    persona: Annotated[str, Form()] = DEFAULT_PERSONA,
    history_json: Annotated[str, Form()] = "[]",
    thread_id: Annotated[UUID | None, Form()] = None,
    audio_requested: Annotated[bool, Form()] = True,
) -> dict[str, Any]:
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

        result = await _answer(backend, transcript, persona, history)
        if thread_id:
            from services import gemma4_conversations

            user_message_id = str(uuid4())
            assistant_message_id = str(uuid4())
            gemma4_conversations.begin_turn(
                str(thread_id), transcript, persona, audio_requested,
                user_message_id, assistant_message_id,
            )
            gemma4_conversations.complete_message(
                str(thread_id), assistant_message_id, result["reply"]
            )
            result.update(
                user_message_id=user_message_id,
                assistant_message_id=assistant_message_id,
            )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise _unavailable(exc) from exc
