import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Brain, Mic, Send, Square, Trash2, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';

import { runGemma4TextTurn, runGemma4Turn, synthesizeAssistantReply } from '../api/gemma4Assistant';
import useRecording from '../hooks/useRecording';
import { playBlobAudio } from '../utils/media';
import { Button, Panel, Select, Textarea } from '../ui';

export default function Gemma4Assistant({ profiles = [] }) {
  const { t } = useTranslation();
  const [turns, setTurns] = useState([]);
  const [persona, setPersona] = useState(() => t('gemma4_assistant.default_persona'));
  const [profileId, setProfileId] = useState(profiles[0]?.id || '');
  const [phase, setPhase] = useState('idle');
  const [draft, setDraft] = useState('');
  const audioUrls = useRef(new Set());

  useEffect(() => () => {
    for (const url of audioUrls.current) URL.revokeObjectURL(url);
    audioUrls.current.clear();
  });

  useEffect(() => {
    if (!profileId && profiles[0]?.id) setProfileId(profiles[0].id);
  }, [profileId, profiles]);

  const history = useMemo(() => turns.map(({ role, text }) => ({ role, content: text })), [turns]);

  const presentReply = useCallback(
    async (result) => {
      const replyId = crypto.randomUUID();
      setTurns((current) => [
        ...current,
        { role: 'user', text: result.transcript },
        { id: replyId, role: 'assistant', text: result.reply },
      ]);
      setPhase('speaking');
      try {
        const speech = await synthesizeAssistantReply(result.reply, profileId || undefined);
        const audioUrl = URL.createObjectURL(speech);
        audioUrls.current.add(audioUrl);
        setTurns((current) =>
          current.map((turn) => (turn.id === replyId ? { ...turn, audioUrl } : turn)),
        );
        await playBlobAudio(speech, { label: t('gemma4_assistant.spoken_reply') });
      } catch (error) {
        toast.error(error?.message || t('gemma4_assistant.failed'));
      }
    },
    [profileId, t],
  );

  const handleAudio = useCallback(
    async (audio) => {
      setPhase('thinking');
      try {
        const result = await runGemma4Turn(audio, persona, history);
        await presentReply(result);
      } catch (error) {
        toast.error(error?.message || t('gemma4_assistant.failed'));
      } finally {
        setPhase('idle');
      }
    },
    [history, persona, presentReply, t],
  );

  const handleTextSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || phase !== 'idle') return;
      setDraft('');
      setPhase('thinking');
      try {
        await presentReply(await runGemma4TextTurn(text, persona, history));
      } catch (error) {
        setDraft(text);
        toast.error(error?.message || t('gemma4_assistant.failed'));
      } finally {
        setPhase('idle');
      }
    },
    [draft, history, persona, phase, presentReply, t],
  );

  const clearTurns = useCallback(() => {
    for (const url of audioUrls.current) URL.revokeObjectURL(url);
    audioUrls.current.clear();
    setTurns([]);
  }, []);

  const recording = useRecording(handleAudio);
  const isBusy = phase !== 'idle' || recording.isCleaning;
  const phaseLabel = recording.isRecording
    ? t('gemma4_assistant.listening')
    : phase === 'thinking'
      ? t('gemma4_assistant.thinking')
      : phase === 'speaking'
        ? t('gemma4_assistant.speaking')
        : t('gemma4_assistant.ready');

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--chrome-bg)] px-[34px] py-[30px] font-sans">
      <div className="mx-auto flex min-h-full w-full max-w-[980px] flex-col gap-[18px]">
        <header className="flex items-center gap-[12px] border-b border-[var(--chrome-border)] pb-[18px]">
          <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--chrome-accent)_14%,transparent)] text-[var(--chrome-accent)]">
            <Bot size={22} />
          </span>
          <div>
            <h1 className="m-0 text-[1.8rem] font-normal text-[var(--chrome-fg)]">
              {t('gemma4_assistant.title')}
            </h1>
            <p className="m-0 mt-[4px] text-sm text-[var(--chrome-fg-dim)]">
              {t('gemma4_assistant.subtitle')}
            </p>
          </div>
        </header>

        <Panel className="grid gap-[14px] p-[18px] md:grid-cols-2">
          <label className="flex flex-col gap-[6px] text-sm text-fg-muted">
            {t('gemma4_assistant.voice')}
            <Select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              <option value="">{t('gemma4_assistant.default_voice')}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name || profile.id}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-[6px] text-sm text-fg-muted">
            {t('gemma4_assistant.persona')}
            <Textarea
              rows={2}
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
            />
          </label>
        </Panel>

        <section className="flex min-h-[300px] flex-1 flex-col gap-[10px] rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-bg-elev-1 p-[18px]">
          {turns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-[8px] text-center text-fg-muted">
              <Brain size={34} className="opacity-40" />
              <p className="m-0 max-w-[520px] text-sm">{t('gemma4_assistant.empty')}</p>
            </div>
          ) : (
            turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={`max-w-[82%] rounded-[16px] px-[14px] py-[10px] text-sm leading-relaxed ${
                  turn.role === 'user'
                    ? 'ml-auto bg-[var(--color-brand)] text-white'
                    : 'mr-auto border border-[var(--color-border)] bg-bg-elev-2 text-fg'
                }`}
              >
                {turn.text}
                {turn.audioUrl ? (
                  <audio
                    className="mt-[10px] block h-[36px] w-full min-w-[260px]"
                    controls
                    preload="metadata"
                    src={turn.audioUrl}
                    aria-label={t('gemma4_assistant.spoken_reply')}
                  />
                ) : null}
              </div>
            ))
          )}
        </section>

        <form className="flex items-end gap-[10px]" onSubmit={handleTextSubmit}>
          <Textarea
            className="min-h-[44px] flex-1 resize-none"
            rows={1}
            value={draft}
            disabled={isBusy}
            placeholder={t('gemma4_assistant.write')}
            aria-label={t('gemma4_assistant.write')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button type="submit" disabled={!draft.trim() || isBusy}>
            <Send size={16} /> {t('gemma4_assistant.send')}
          </Button>
        </form>

        <footer className="flex flex-wrap items-center justify-center gap-[12px]">
          <Button variant="ghost" disabled={!turns.length || isBusy} onClick={clearTurns}>
            <Trash2 size={15} /> {t('gemma4_assistant.clear')}
          </Button>
          <Button
            variant={recording.isRecording ? 'danger' : 'primary'}
            disabled={isBusy && !recording.isRecording}
            onClick={recording.isRecording ? recording.stopRecording : recording.startRecording}
          >
            {recording.isRecording ? <Square size={16} /> : <Mic size={16} />}
            {recording.isRecording ? t('gemma4_assistant.stop') : t('gemma4_assistant.talk')}
          </Button>
          <span
            className="inline-flex items-center gap-[6px] text-sm text-fg-muted"
            aria-live="polite"
          >
            <Volume2 size={15} /> {phaseLabel}
          </span>
        </footer>
      </div>
    </div>
  );
}
