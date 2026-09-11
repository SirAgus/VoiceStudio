import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';

const runGemma4TextTurn = vi.fn();
const synthesizeAssistantReply = vi.fn();
const playBlobAudio = vi.fn();

vi.mock('../api/gemma4Assistant', () => ({
  runGemma4Turn: vi.fn(),
  runGemma4TextTurn: (...args) => runGemma4TextTurn(...args),
  synthesizeAssistantReply: (...args) => synthesizeAssistantReply(...args),
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
    runGemma4TextTurn.mockReset();
    synthesizeAssistantReply.mockReset();
    playBlobAudio.mockReset();
    runGemma4TextTurn.mockResolvedValue({
      transcript: 'Hola',
      reply: '¿Cómo estás?',
      model: 'local-model',
    });
    synthesizeAssistantReply.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }));
    playBlobAudio.mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:assistant-reply');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('shows typed text and keeps a replayable audio response', async () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <Gemma4Assistant profiles={[{ id: 'voice-1', name: 'Voz' }]} />
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByLabelText(i18n.t('gemma4_assistant.write')), {
      target: { value: 'Hola' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('gemma4_assistant.send') }));

    await waitFor(() => expect(runGemma4TextTurn).toHaveBeenCalled());
    expect(await screen.findByText('Hola')).toBeInTheDocument();
    expect(await screen.findByText('¿Cómo estás?')).toBeInTheDocument();
    await waitFor(() =>
      expect(synthesizeAssistantReply).toHaveBeenCalledWith('¿Cómo estás?', 'voice-1'),
    );
    await waitFor(() =>
      expect(container.querySelector('audio')).toHaveAttribute('src', 'blob:assistant-reply'),
    );
  });
});
