import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';

const streamGemma4TextTurn = vi.fn();
const synthesizeAssistantReply = vi.fn();
const playBlobAudio = vi.fn();
const thread = {
  id: 'thread-1',
  title: '',
  persona: '',
  created_at: 0,
  updated_at: 0,
  messages: [],
};

vi.mock('../api/gemma4Assistant', () => ({
  runGemma4Turn: vi.fn(),
  streamGemma4TextTurn: (...args) => streamGemma4TextTurn(...args),
  synthesizeAssistantReply: (...args) => synthesizeAssistantReply(...args),
  listGemma4Threads: vi.fn(async () => [thread]),
  createGemma4Thread: vi.fn(async () => thread),
  getGemma4Thread: vi.fn(async () => thread),
  deleteGemma4Thread: vi.fn(),
  deleteGemma4Message: vi.fn(),
  attachGemma4MessageAudio: vi.fn(async (_threadId, messageId) => ({
    id: messageId,
    audio_url: '/gemma4-assistant/threads/thread-1/messages/audio/audio.wav',
  })),
  gemma4MessageAudioUrl: (path) => path,
}));
vi.mock('../hooks/useRecording', () => ({
  default: () => ({
    isCleaning: false,
    isRecording: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}));
vi.mock('../utils/media', () => ({
  playBlobAudio: (...args) => playBlobAudio(...args),
}));

import Gemma4Assistant from '../pages/Gemma4Assistant';

describe('Gemma4Assistant typed conversation', () => {
  beforeEach(() => {
    streamGemma4TextTurn.mockReset();
    synthesizeAssistantReply.mockReset();
    playBlobAudio.mockReset();
    synthesizeAssistantReply.mockResolvedValue({
      blob: new Blob(['wav'], { type: 'audio/wav' }),
      audioId: 'audio-1',
    });
    playBlobAudio.mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:assistant-reply');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('shows typed text and keeps a replayable audio response', async () => {
    let emitFragment;
    let finishStream;
    streamGemma4TextTurn.mockImplementation(
      (_text, _persona, _history, onDelta) =>
        new Promise((resolve) => {
          emitFragment = onDelta;
          finishStream = resolve;
        }),
    );
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <Gemma4Assistant profiles={[{ id: 'voice-1', name: 'Voz' }]} />
      </I18nextProvider>,
    );

    const input = screen.getByLabelText(i18n.t('gemma4_assistant.write'));
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, {
      target: { value: 'Hola' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('gemma4_assistant.send') }));

    expect(screen.getByText('Hola')).toBeInTheDocument();
    await waitFor(() => expect(streamGemma4TextTurn).toHaveBeenCalled());
    await act(async () => emitFragment('¿Cómo '));
    expect(screen.getByText('¿Cómo')).toBeInTheDocument();
    await act(async () => {
      emitFragment('estás?');
      finishStream({
        transcript: 'Hola',
        reply: '¿Cómo estás?',
        model: 'local-model',
        assistant_message_id: 'assistant-1',
        user_message_id: 'user-1',
      });
    });
    expect(await screen.findByText('¿Cómo estás?')).toBeInTheDocument();
    await waitFor(() =>
      expect(synthesizeAssistantReply).toHaveBeenCalledWith('¿Cómo estás?', 'voice-1'),
    );
    await waitFor(() =>
      expect(container.querySelector('audio')).toHaveAttribute(
        'src',
        '/gemma4-assistant/threads/thread-1/messages/audio/audio.wav',
      ),
    );
  });
});
