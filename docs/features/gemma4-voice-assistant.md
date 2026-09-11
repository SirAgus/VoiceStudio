# Gemma 4 E4B voice assistant

VoiceStudio's **Talk** workspace runs a fully local, half-duplex voice loop with
`HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive`:

1. Gemma 4 E4B transcribes the microphone recording.
2. The same model reasons over the transcript and recent conversation.
3. VoiceStudio synthesizes the answer with the selected local TTS voice.

Audio and text stay on the machine. The model server is a separate local process so Gemma does not contend with VoiceStudio's TTS worker pool.

You can also type a message instead of recording it. Both sides remain visible
in the conversation, and every generated answer has audio controls so it can be
paused or replayed.

## Setup

Install the official `llama-server` runtime first. On Windows:

```powershell
winget install --id ggml.llamacpp --exact --scope user
```

On macOS or Linux, use an official llama.cpp release and ensure `llama-server`
is on `PATH`, or set `LLAMA_SERVER_PATH` to its executable. Then one command
starts the model, VoiceStudio API, and browser UI together:

```bash
bun run dev:gemma4
```

Press `Ctrl+C` once to stop all three processes.

The first run downloads the Q4_K_M model (about 5 GB) and its multimodal
projector (about 945 MB) from Hugging Face. Later runs use llama.cpp's local
cache. The API and UI wait for the model health check, so the first launch does
not open the workspace until that download and model load finish. Open **Talk**, select a saved voice, then type a message or press
**Talk**. For microphone input, speak and press **Stop** to send the turn.

The default endpoint is `http://localhost:8000/v1`. Override it with `GEMMA4_BASE_URL`; override the model id with `GEMMA4_MODEL`.

Typed chat works with another local model when its server implements the
OpenAI-compatible `/v1/chat/completions` API. Microphone turns additionally
require the model to accept OpenAI-compatible `input_audio` content. VoiceStudio
does not add a moderation layer to local assistant replies; the selected
model's behavior and license still apply.

The server is OpenAI-compatible. The explicit development command may download
the selected model; opening the Talk workspace never starts a download.

## Current scope

This first slice is push-to-talk and half-duplex. It does not keep the microphone open while the assistant speaks and does not yet implement barge-in. The full-duplex design remains documented in [the conversational-agent specification](../specs/02-conversational-agent.md).

References: [HauhauCS model card](https://huggingface.co/HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive), [Google's Gemma 4 audio guide](https://ai.google.dev/gemma/docs/capabilities/audio), and [llama.cpp multimodal support](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md).
