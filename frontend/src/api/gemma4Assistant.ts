import { apiFetch, apiJson, apiUrl } from './client';
import { encodeAudio } from './stories';

export interface AssistantTurn {
  transcript: string;
  reply: string;
  model: string;
  user_message_id?: string;
  assistant_message_id?: string;
}

export interface AssistantMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'complete' | 'error';
  audio_requested: boolean;
  audio_url?: string | null;
}

export interface AssistantThread {
  id: string;
  title: string;
  persona: string;
  created_at: number;
  updated_at: number;
  message_count?: number;
  messages?: AssistantMessage[];
}

export interface TurnPersistence {
  threadId: string;
  audioRequested: boolean;
  userMessageId?: string;
  assistantMessageId?: string;
}

export async function runGemma4Turn(
  audio: File,
  persona: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  persistence?: TurnPersistence,
): Promise<AssistantTurn> {
  const body = new FormData();
  body.append('audio', audio, audio.name || 'turn.wav');
  body.append('persona', persona);
  body.append('history_json', JSON.stringify(history));
  if (persistence) {
    body.append('thread_id', persistence.threadId);
    body.append('audio_requested', String(persistence.audioRequested));
  }
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
  persistence?: TurnPersistence,
): Promise<AssistantTurn> {
  const response = await apiFetch('/gemma4-assistant/text-turn/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      persona,
      history,
      thread_id: persistence?.threadId,
      user_message_id: persistence?.userMessageId,
      assistant_message_id: persistence?.assistantMessageId,
      audio_requested: persistence?.audioRequested ?? false,
    }),
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

export async function synthesizeAssistantReply(
  text: string,
  profileId?: string,
): Promise<{ blob: Blob; audioId: string }> {
  const body = new FormData();
  body.append('text', text);
  if (profileId) body.append('profile_id', profileId);
  const response = await apiFetch('/generate', { method: 'POST', body });
  const audioId = response.headers.get('X-Audio-Id');
  if (!audioId) throw new Error('The generated audio has no persistent identifier.');
  return { blob: await response.blob(), audioId };
}

export async function listGemma4Threads(): Promise<AssistantThread[]> {
  return apiJson<AssistantThread[]>('/gemma4-assistant/threads');
}

export async function createGemma4Thread(persona: string): Promise<AssistantThread> {
  return apiJson<AssistantThread>('/gemma4-assistant/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona }),
  });
}

export async function getGemma4Thread(threadId: string): Promise<AssistantThread> {
  return apiJson<AssistantThread>(`/gemma4-assistant/threads/${threadId}`);
}

export async function deleteGemma4Thread(threadId: string): Promise<void> {
  await apiFetch(`/gemma4-assistant/threads/${threadId}`, { method: 'DELETE' });
}

export async function deleteGemma4Message(threadId: string, messageId: string): Promise<void> {
  await apiFetch(`/gemma4-assistant/threads/${threadId}/messages/${messageId}`, {
    method: 'DELETE',
  });
}

export async function attachGemma4MessageAudio(
  threadId: string,
  messageId: string,
  audioId: string,
  profileId?: string,
): Promise<AssistantMessage> {
  return apiJson<AssistantMessage>(
    `/gemma4-assistant/threads/${threadId}/messages/${messageId}/audio`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_id: audioId, profile_id: profileId || '' }),
    },
  );
}

export function gemma4MessageAudioUrl(path?: string | null): string | undefined {
  return path ? apiUrl(path) : undefined;
}

export async function downloadGemma4MessageAudio(
  threadId: string,
  messageId: string,
  format: 'wav' | 'mp3' | 'ogg',
): Promise<Blob> {
  const wav = await (
    await apiFetch(`/gemma4-assistant/threads/${threadId}/messages/${messageId}/audio`)
  ).blob();
  return format === 'wav' ? wav : encodeAudio(wav, format);
}
