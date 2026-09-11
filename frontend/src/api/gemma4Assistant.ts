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

export async function synthesizeAssistantReply(text: string, profileId?: string): Promise<Blob> {
  const body = new FormData();
  body.append('text', text);
  if (profileId) body.append('profile_id', profileId);
  const response = await apiFetch('/generate', { method: 'POST', body });
  return response.blob();
}
