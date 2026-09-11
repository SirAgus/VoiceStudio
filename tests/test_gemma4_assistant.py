from __future__ import annotations

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


def test_gemma4_backend_refuses_remote_audio_destination(monkeypatch):
    monkeypatch.setenv("GEMMA4_BASE_URL", "https://remote.example/v1")
    with pytest.raises(RuntimeError, match="loopback"):
        gemma4_assistant._backend()
