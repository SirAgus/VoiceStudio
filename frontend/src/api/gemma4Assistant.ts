import { apiFetch, apiJson } from './client';

export interface AssistantTurn {
  transcript: string;
  reply: string;
  model: string;
}

export async function runGemma4Turn(
  audio: File,
  persona: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AssistantTurn> {
  const body = new FormData();
  body.append('audio', audio, audio.name || 'turn.wav');
  body.append('persona', persona);
  body.append('history_json', JSON.stringify(history));
  return apiJson<AssistantTurn>('/gemma4-assistant/turn', { method: 'POST', body });
}

export async function runGemma4TextTurn(
  text: string,
  persona: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AssistantTurn> {
  return apiJson<AssistantTurn>('/gemma4-assistant/text-turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, persona, history }),
  });
}

type AssistantStreamEvent =
  | { type: 'delta'; text: string }
  | ({ type: 'done' } & AssistantTurn)
  | { type: 'error'; detail: string };

export async function streamGemma4TextTurn(
  text: string,
  persona: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onDelta: (fragment: string) => void,
): Promise<AssistantTurn> {
  const response = await apiFetch('/gemma4-assistant/text-turn/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, persona, history }),
  });
  if (!response.body) throw new Error('The streaming response has no body.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: AssistantTurn | undefined;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AssistantStreamEvent;
    if (event.type === 'delta') onDelta(event.text);
    if (event.type === 'done') completed = event;
    if (event.type === 'error') throw new Error(event.detail);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  consumeLine(buffer);
  if (!completed) throw new Error('The streaming response ended before completion.');
  return completed;
}

export async function synthesizeAssistantReply(text: string, profileId?: string): Promise<Blob> {
  const body = new FormData();
  body.append('text', text);
  if (profileId) body.append('profile_id', profileId);
  const response = await apiFetch('/generate', { method: 'POST', body });
  return response.blob();
}
