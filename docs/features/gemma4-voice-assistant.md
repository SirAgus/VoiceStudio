# Gemma 4 E4B voice assistant

VoiceStudio's **Talk** workspace runs a fully local, half-duplex voice loop:

1. Gemma 4 E4B transcribes the microphone recording.
2. The same model reasons over the transcript and recent conversation.
3. VoiceStudio synthesizes the answer with the selected local TTS voice.

Audio and text stay on the machine. The model server is a separate local process so Gemma does not contend with VoiceStudio's TTS worker pool.

## Setup

Gemma 4 E4B requires Hugging Face Transformers 5.10.1 or newer and substantial memory (the official full-precision checkpoint is about 16 GB). Install the serving extras in a separate Python environment:

```bash
python -m pip install "transformers[serving]>=5.10.1"
transformers download google/gemma-4-E4B-it
transformers serve google/gemma-4-E4B-it --reasoning on
```

Keep that terminal running, start VoiceStudio, open **Talk**, select a saved voice, then press **Talk**. Speak and press **Stop** to send the turn.

The default endpoint is `http://localhost:8000/v1`. Override it with `GEMMA4_BASE_URL`; override the model id with `GEMMA4_MODEL`.

The server is OpenAI-compatible and loads only downloaded models. VoiceStudio never starts a download from the Talk workspace.

## Current scope

This first slice is push-to-talk and half-duplex. It does not keep the microphone open while the assistant speaks and does not yet implement barge-in. The full-duplex design remains documented in [the conversational-agent specification](../specs/02-conversational-agent.md).

References: [Google's Gemma 4 audio guide](https://ai.google.dev/gemma/docs/capabilities/audio) and [Transformers Serve](https://github.com/huggingface/transformers/blob/main/docs/source/en/serve-cli/serving.md).
