from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import gemma4_assistant


class _FakeBackend:
    model_name = gemma4_assistant.MODEL_ID

    def __init__(self):
        self.calls = []

    def chat_messages(self, **kwargs):
        self.calls.append(kwargs)
        return "Hola, mundo" if len(self.calls) == 1 else "Hola. ¿En qué puedo ayudarte?"

    def stream_chat_messages(self, **kwargs):
        self.calls.append(kwargs)
        yield "Hola"
        yield ". ¿En qué puedo ayudarte?"


def _client(monkeypatch):
    fake = _FakeBackend()
    monkeypatch.setattr(gemma4_assistant, "_backend", lambda: fake)
    app = FastAPI()
    app.dependency_overrides[gemma4_assistant.require_local] = lambda: None
    app.include_router(gemma4_assistant.router)
    return TestClient(app), fake


def test_voice_turn_transcribes_then_reasons_with_history(monkeypatch):
    client, backend = _client(monkeypatch)
    response = client.post(
        "/gemma4-assistant/turn",
        files={"audio": ("turn.wav", b"RIFFaudio", "audio/wav")},
        data={
            "persona": "Responde brevemente.",
            "history_json": '[{"role":"assistant","content":"Buenos días"}]',
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "transcript": "Hola, mundo",
        "reply": "Hola. ¿En qué puedo ayudarte?",
        "model": gemma4_assistant.MODEL_ID,
    }
    audio_part = backend.calls[0]["messages"][0]["content"][1]
    assert audio_part["type"] == "input_audio"
    assert audio_part["input_audio"]["format"] == "wav"
    assert backend.calls[1]["messages"] == [
        {"role": "system", "content": "Responde brevemente."},
        {"role": "assistant", "content": "Buenos días"},
        {"role": "user", "content": "Hola, mundo"},
    ]


def test_voice_turn_rejects_unsupported_audio(monkeypatch):
    client, _ = _client(monkeypatch)
    response = client.post(
        "/gemma4-assistant/turn",
        files={"audio": ("turn.webm", b"audio", "audio/webm")},
    )
    assert response.status_code == 415


def test_text_turn_reasons_once_and_preserves_history(monkeypatch):
    client, backend = _client(monkeypatch)
    response = client.post(
        "/gemma4-assistant/text-turn",
        json={
            "text": "  Cuéntame algo  ",
            "persona": "Responde brevemente.",
            "history": [{"role": "assistant", "content": "Buenos días"}],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "transcript": "Cuéntame algo",
        "reply": "Hola, mundo",
        "model": gemma4_assistant.MODEL_ID,
    }
    assert backend.calls[0]["messages"] == [
        {"role": "system", "content": "Responde brevemente."},
        {"role": "assistant", "content": "Buenos días"},
        {"role": "user", "content": "Cuéntame algo"},
    ]


def test_text_turn_rejects_blank_messages(monkeypatch):
    client, _ = _client(monkeypatch)
    response = client.post("/gemma4-assistant/text-turn", json={"text": "   "})
    assert response.status_code == 422


def test_text_turn_streams_visible_fragments_and_completion(monkeypatch):
    client, backend = _client(monkeypatch)
    with client.stream(
        "POST",
        "/gemma4-assistant/text-turn/stream",
        json={
            "text": "Cuéntame algo",
            "persona": "Responde brevemente.",
            "history": [],
        },
    ) as response:
        events = [json.loads(line) for line in response.iter_lines()]

    assert response.status_code == 200
    assert events == [
        {"type": "delta", "text": "Hola"},
        {"type": "delta", "text": ". ¿En qué puedo ayudarte?"},
        {
            "type": "done",
            "transcript": "Cuéntame algo",
            "reply": "Hola. ¿En qué puedo ayudarte?",
            "model": gemma4_assistant.MODEL_ID,
        },
    ]
    assert backend.calls[0]["messages"][-1] == {
        "role": "user",
        "content": "Cuéntame algo",
    }


def test_threaded_stream_persists_and_deletes_messages(monkeypatch):
    from core.db import init_db

    init_db()
    client, _ = _client(monkeypatch)
    thread = client.post(
        "/gemma4-assistant/threads", json={"persona": "Responde breve."}
    ).json()
    with client.stream(
        "POST",
        "/gemma4-assistant/text-turn/stream",
        json={
            "text": "Guarda esto",
            "thread_id": thread["id"],
            "audio_requested": False,
        },
    ) as response:
        events = [json.loads(line) for line in response.iter_lines()]

    done = events[-1]
    assert done["type"] == "done"
    stored = client.get(f"/gemma4-assistant/threads/{thread['id']}").json()
    assert [message["role"] for message in stored["messages"]] == ["user", "assistant"]
    assert stored["messages"][1]["audio_requested"] is False
    assert client.delete(
        f"/gemma4-assistant/threads/{thread['id']}/messages/{done['assistant_message_id']}"
    ).status_code == 200
    assert len(client.get(f"/gemma4-assistant/threads/{thread['id']}").json()["messages"]) == 1
    assert client.delete(f"/gemma4-assistant/threads/{thread['id']}").json() == {"deleted": True}
    assert client.get(f"/gemma4-assistant/threads/{thread['id']}").status_code == 404


def test_gemma4_backend_refuses_remote_audio_destination(monkeypatch):
    monkeypatch.setenv("GEMMA4_BASE_URL", "https://remote.example/v1")
    with pytest.raises(RuntimeError, match="loopback"):
        gemma4_assistant._backend()


def test_openai_compat_backend_yields_only_visible_stream_content(monkeypatch):
    from services.llm_backend import OpenAICompatBackend

    backend = OpenAICompatBackend()
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return iter([
            SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="Hola"))]),
            SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None))]),
            SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=" mundo"))]),
        ])

    backend._client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
    )
    monkeypatch.setattr(OpenAICompatBackend, "model_name", property(lambda _self: "local"))

    fragments = list(backend.stream_chat_messages(messages=[{"role": "user", "content": "Hi"}]))

    assert fragments == ["Hola", " mundo"]
    assert calls[0]["stream"] is True
