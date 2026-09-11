import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Brain,
  ChevronDown,
  Copy,
  Download,
  GitBranch,
  Mic,
  Plus,
  RotateCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';

import {
  attachGemma4MessageAudio,
  createGemma4Thread,
  deleteGemma4Message,
  deleteGemma4Thread,
  downloadGemma4MessageAudio,
  gemma4MessageAudioUrl,
  getGemma4Thread,
  listGemma4Threads,
  streamGemma4TextTurn,
  runGemma4Turn,
  synthesizeAssistantReply,
} from '../api/gemma4Assistant';
import { MessageResponse } from '../components/ai-elements/message';
import { SettingsToggle } from '../components/settings/primitives';
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
  const [threads, setThreads] = useState([]);
  const [currentThreadId, setCurrentThreadId] = useState('');
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [downloadingAudioId, setDownloadingAudioId] = useState('');
  const [configOpen, setConfigOpen] = useState(true);
  const initialPersona = useRef(persona);

  const applyThread = useCallback(
    (thread) => {
      setCurrentThreadId(thread.id);
      if (thread.persona) setPersona(thread.persona);
      setTurns(
        (thread.messages || []).map((message) => ({
          id: message.id,
          role: message.role,
          text: message.status === 'error' ? t('gemma4_assistant.failed') : message.content,
          error: message.status === 'error',
          isStreaming: false,
          audioUrl: gemma4MessageAudioUrl(message.audio_url),
        })),
      );
    },
    [t],
  );

  const openThread = useCallback(
    async (threadId) => applyThread(await getGemma4Thread(threadId)),
    [applyThread],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let items = await listGemma4Threads();
        if (!items.length) items = [await createGemma4Thread(initialPersona.current)];
        const thread = await getGemma4Thread(items[0].id);
        if (!active) return;
        setThreads(items);
        applyThread(thread);
      } catch (error) {
        if (active) toast.error(error?.message || t('gemma4_assistant.failed'));
      } finally {
        if (active) setThreadsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyThread, t]);

  const history = useMemo(
    () =>
      turns
        .filter((turn) => !turn.error && turn.text?.trim())
        .map(({ role, text }) => ({ role, content: text })),
    [turns],
  );

  const speakReply = useCallback(
    async (threadId, replyId, reply, shouldCreateAudio) => {
      if (!shouldCreateAudio) return;
      setPhase('speaking');
      try {
        const speech = await synthesizeAssistantReply(reply, profileId || profiles[0]?.id);
        const message = await attachGemma4MessageAudio(
          threadId,
          replyId,
          speech.audioId,
          profileId || profiles[0]?.id,
        );
        setTurns((current) =>
          current.map((turn) =>
            turn.id === replyId
              ? { ...turn, audioUrl: gemma4MessageAudioUrl(message.audio_url) }
              : turn,
          ),
        );
        await playBlobAudio(speech.blob, { label: t('gemma4_assistant.spoken_reply') });
      } catch (error) {
        toast.error(error?.message || t('gemma4_assistant.failed'));
      }
    },
    [profileId, profiles, t],
  );

  const presentReply = useCallback(
    async (result) => {
      const replyId = result.assistant_message_id || crypto.randomUUID();
      const userMessageId = result.user_message_id || crypto.randomUUID();
      setTurns((current) => [
        ...current,
        { id: userMessageId, role: 'user', text: result.transcript },
        { id: replyId, role: 'assistant', text: result.reply },
      ]);
      await speakReply(currentThreadId, replyId, result.reply, audioEnabled);
    },
    [audioEnabled, currentThreadId, speakReply],
  );

  const handleAudio = useCallback(
    async (audio) => {
      if (!currentThreadId) return;
      setPhase('thinking');
      try {
        const result = await runGemma4Turn(audio, persona, history, {
          threadId: currentThreadId,
          audioRequested: audioEnabled,
        });
        await presentReply(result);
      } catch (error) {
        toast.error(error?.message || t('gemma4_assistant.failed'));
      } finally {
        setPhase('idle');
      }
    },
    [audioEnabled, currentThreadId, history, persona, presentReply, t],
  );

  const recording = useRecording(handleAudio);
  const isBusy = phase !== 'idle' || recording.isCleaning || threadsLoading;

  const handleTextSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || phase !== 'idle' || !currentThreadId) return;
      const userMessageId = crypto.randomUUID();
      const replyId = crypto.randomUUID();
      setDraft('');
      setPhase('thinking');
      setTurns((current) => [
        ...current,
        { id: userMessageId, role: 'user', text },
        { id: replyId, role: 'assistant', text: '', isStreaming: true },
      ]);
      try {
        const result = await streamGemma4TextTurn(
          text,
          persona,
          history,
          (fragment) => {
            setTurns((current) =>
              current.map((turn) =>
                turn.id === replyId ? { ...turn, text: `${turn.text}${fragment}` } : turn,
              ),
            );
          },
          {
            threadId: currentThreadId,
            audioRequested: audioEnabled,
            userMessageId,
            assistantMessageId: replyId,
          },
        );
        setTurns((current) =>
          current.map((turn) =>
            turn.id === replyId ? { ...turn, text: result.reply, isStreaming: false } : turn,
          ),
        );
        setThreads((current) =>
          current.map((thread) =>
            thread.id === currentThreadId
              ? {
                  ...thread,
                  title: thread.title || text.slice(0, 60),
                  updated_at: Date.now() / 1000,
                }
              : thread,
          ),
        );
        await speakReply(currentThreadId, replyId, result.reply, audioEnabled);
      } catch (error) {
        setTurns((current) =>
          current.map((turn) =>
            turn.id === replyId
              ? { ...turn, text: t('gemma4_assistant.failed'), isStreaming: false, error: true }
              : turn,
          ),
        );
        toast.error(error?.message || t('gemma4_assistant.failed'));
      } finally {
        setPhase('idle');
      }
    },
    [audioEnabled, currentThreadId, draft, history, persona, phase, speakReply, t],
  );

  const createThread = useCallback(async () => {
    if (isBusy) return;
    try {
      const thread = await createGemma4Thread(persona);
      setThreads((current) => [thread, ...current]);
      applyThread({ ...thread, messages: [] });
    } catch (error) {
      toast.error(error?.message || t('gemma4_assistant.failed'));
    }
  }, [applyThread, isBusy, persona, t]);

  const removeThread = useCallback(async () => {
    if (!currentThreadId || isBusy || !window.confirm(t('gemma4_assistant.delete_thread'))) return;
    try {
      await deleteGemma4Thread(currentThreadId);
      const remaining = threads.filter((thread) => thread.id !== currentThreadId);
      if (remaining.length) {
        setThreads(remaining);
        await openThread(remaining[0].id);
      } else {
        const replacement = await createGemma4Thread(persona);
        setThreads([replacement]);
        applyThread({ ...replacement, messages: [] });
      }
    } catch (error) {
      toast.error(error?.message || t('gemma4_assistant.failed'));
    }
  }, [applyThread, currentThreadId, isBusy, openThread, persona, t, threads]);

  const removeMessage = useCallback(
    async (messageId) => {
      if (!currentThreadId || isBusy || !window.confirm(t('gemma4_assistant.delete_message')))
        return;
      try {
        await deleteGemma4Message(currentThreadId, messageId);
        setTurns((current) => current.filter((turn) => turn.id !== messageId));
      } catch (error) {
        toast.error(error?.message || t('gemma4_assistant.failed'));
      }
    },
    [currentThreadId, isBusy, t],
  );

  const downloadAudio = useCallback(
    async (messageId, format) => {
      if (!currentThreadId) return;
      setDownloadingAudioId(messageId);
      try {
        const blob = await downloadGemma4MessageAudio(currentThreadId, messageId, format);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `gemma4-${messageId}.${format}`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        toast.error(error?.message || t('gemma4_assistant.failed'));
      } finally {
        setDownloadingAudioId('');
      }
    },
    [currentThreadId, t],
  );

  const phaseLabel = recording.isRecording
    ? t('gemma4_assistant.listening')
    : phase === 'thinking'
      ? t('gemma4_assistant.thinking')
      : phase === 'speaking'
        ? t('gemma4_assistant.speaking')
        : t('gemma4_assistant.ready');

  return (
    <div
      className="h-full min-h-0 overflow-hidden px-4 py-5 font-sans text-[#f5f0eb] md:px-8 md:py-6"
      style={{
        backgroundColor: '#0b0908',
        backgroundImage:
          'radial-gradient(at 0% 0%, rgba(55,35,24,.55) 0, transparent 50%), radial-gradient(at 100% 100%, rgba(17,10,7,.8) 0, transparent 50%), radial-gradient(at 50% 0%, rgba(110,68,40,.2) 0, transparent 50%)',
      }}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[980px] flex-col gap-5">
        <header className="flex shrink-0 items-start justify-between gap-4 rounded-2xl border border-white/[.09] bg-[#14100e]/90 p-5 shadow-[0_20px_40px_rgba(0,0,0,.6)] backdrop-blur-xl md:p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-stone-700/70 bg-stone-800 text-amber-400 shadow-sm">
              <Bot size={22} />
            </span>
            <div>
              <h1 className="m-0 text-xl font-bold tracking-tight text-stone-100 md:text-2xl">
                {t('gemma4_assistant.title')}
              </h1>
              <span className="rounded-md border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                V4.1 Neural
              </span>
              <p className="m-0 mt-1 text-xs text-stone-400 md:text-sm">
                {t('gemma4_assistant.subtitle')}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400 sm:flex">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
            {t('gemma4_assistant.ready')}
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-xl border border-stone-700 bg-stone-800/70 px-3 py-2 text-xs font-semibold text-stone-200 hover:bg-stone-700"
            onClick={() => setConfigOpen((open) => !open)}
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Ajustes</span>
            <ChevronDown size={13} className={configOpen ? '' : '-rotate-90'} />
          </button>
        </header>

        {configOpen ? (
          <Panel className="shrink-0 rounded-2xl border border-white/[.09] bg-[#14100e]/90 p-5 shadow-[0_20px_40px_rgba(0,0,0,.6)] backdrop-blur-xl">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-end gap-[8px]">
                <label className="flex min-w-0 flex-1 flex-col gap-[6px] text-xs font-semibold text-stone-400">
                  <span className="flex items-center gap-1.5">
                    <GitBranch size={13} className="text-amber-400" />{' '}
                    {t('gemma4_assistant.threads')}
                  </span>
                  <Select
                    className="rounded-xl border-stone-700 bg-stone-900 text-xs text-stone-200"
                    value={currentThreadId}
                    disabled={threadsLoading || isBusy}
                    onChange={async (event) => {
                      try {
                        await openThread(event.target.value);
                      } catch (error) {
                        toast.error(error?.message || t('gemma4_assistant.failed'));
                      }
                    }}
                  >
                    {threads.map((thread) => (
                      <option key={thread.id} value={thread.id}>
                        {thread.title || t('gemma4_assistant.new_thread')}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-xl border border-stone-700 bg-stone-800 text-stone-200"
                  disabled={isBusy}
                  onClick={createThread}
                >
                  {t('gemma4_assistant.new_thread')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-400"
                  disabled={isBusy}
                  onClick={removeThread}
                >
                  <Trash2 size={15} /> {t('gemma4_assistant.delete_thread')}
                </Button>
              </div>
              <label className="flex flex-col gap-[6px] text-xs font-semibold text-stone-400">
                <span className="flex items-center gap-1.5">
                  <Volume2 size={13} className="text-amber-400" /> {t('gemma4_assistant.voice')}
                </span>
                <Select
                  className="rounded-xl border-stone-700 bg-stone-900 text-xs text-stone-200"
                  value={profileId || profiles[0]?.id || ''}
                  onChange={(event) => setProfileId(event.target.value)}
                >
                  <option value="">{t('gemma4_assistant.default_voice')}</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name || profile.id}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-[6px] text-xs font-semibold text-stone-400 md:col-span-2">
                <span className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Sparkles size={13} className="text-amber-400" />{' '}
                    {t('gemma4_assistant.persona')}
                  </span>
                  <small className="font-normal text-stone-500">Editado localmente</small>
                </span>
                <Textarea
                  rows={2}
                  value={persona}
                  onChange={(event) => setPersona(event.target.value)}
                />
              </label>
            </div>
          </Panel>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-white/[.09] bg-[#110d0b]/70 p-4 shadow-[0_20px_40px_rgba(0,0,0,.45)] backdrop-blur-xl md:p-5">
          {turns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-[8px] text-center text-fg-muted">
              <Brain size={34} className="opacity-40" />
              <p className="m-0 max-w-[520px] text-sm">{t('gemma4_assistant.empty')}</p>
            </div>
          ) : (
            turns.map((turn, index) => (
              <div
                key={turn.id || `${turn.role}-${index}`}
                className={`flex items-start gap-3 ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {turn.role === 'assistant' ? (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-stone-700 bg-stone-800 text-amber-400">
                    <Bot size={15} />
                  </div>
                ) : null}
                <div
                  aria-busy={turn.isStreaming || undefined}
                  className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    turn.role === 'user'
                      ? 'border border-[#8b5e3c] bg-[#6f472e] text-[#fdfbf7] shadow-md'
                      : 'border border-[#4a3022]/70 bg-[#17120f]/95 text-stone-100 shadow-md'
                  }`}
                >
                  {turn.isStreaming ? (
                    <span
                      className="mb-[6px] flex items-center gap-[6px] text-xs text-fg-muted"
                      role="status"
                    >
                      <Brain size={14} className="animate-pulse" />
                      {t('gemma4_assistant.thinking')}
                    </span>
                  ) : null}
                  {turn.role === 'assistant' && turn.text ? (
                    <MessageResponse isAnimating={turn.isStreaming}>{turn.text}</MessageResponse>
                  ) : (
                    turn.text
                  )}
                  {turn.audioUrl ? (
                    <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
                      <audio
                        className="block h-[36px] w-full min-w-[260px]"
                        controls
                        preload="metadata"
                        src={turn.audioUrl}
                        aria-label={t('gemma4_assistant.spoken_reply')}
                      />
                      <label className="inline-flex items-center gap-[6px] text-xs text-fg-muted">
                        <Download size={13} />
                        <span className="sr-only">{t('audiobook.download')}</span>
                        <select
                          aria-label={t('audiobook.download')}
                          className="rounded border border-[var(--color-border)] bg-bg-elev-2 px-[6px] py-[3px]"
                          disabled={downloadingAudioId === turn.id}
                          defaultValue=""
                          onChange={(event) => {
                            const format = event.target.value;
                            if (format) downloadAudio(turn.id, format);
                            event.target.value = '';
                          }}
                        >
                          <option value="">{t('audiobook.download')}</option>
                          <option value="wav">WAV</option>
                          <option value="mp3">MP3</option>
                          <option value="ogg">OGG</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {turn.role === 'assistant' && !turn.isStreaming ? (
                    <div className="mt-3 flex items-center justify-between border-t border-stone-800 pt-2 text-xs text-stone-500">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-stone-200"
                          onClick={() => navigator.clipboard?.writeText(turn.text)}
                        >
                          <Copy size={13} /> Copiar
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-stone-200"
                        >
                          <RotateCw size={13} /> Reintentar
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={t('gemma4_assistant.delete_message')}
                        disabled={isBusy}
                        onClick={() => removeMessage(turn.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ml-auto mt-1 block text-xs text-stone-400 opacity-70 hover:opacity-100"
                      aria-label={t('gemma4_assistant.delete_message')}
                      disabled={isBusy}
                      onClick={() => removeMessage(turn.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </section>

        <form
          className="shrink-0 rounded-2xl border border-white/[.09] bg-[#14100e]/95 p-3 shadow-[0_20px_40px_rgba(0,0,0,.6)] backdrop-blur-xl"
          onSubmit={handleTextSubmit}
        >
          <div className="mb-3 flex items-center justify-between px-2 text-xs font-semibold text-stone-300">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100"
              disabled={isBusy}
              onClick={recording.isRecording ? recording.stopRecording : recording.startRecording}
            >
              {recording.isRecording ? <Square size={15} /> : <Mic size={15} />}
              {recording.isRecording ? t('gemma4_assistant.stop') : t('gemma4_assistant.talk')}
            </button>
            <span className="flex items-center gap-2 text-stone-400">
              <Volume2 size={15} /> {t('gemma4_assistant.audio_reply')}
              <SettingsToggle
                checked={audioEnabled}
                disabled={isBusy}
                aria-label={t('gemma4_assistant.audio_reply')}
                onChange={setAudioEnabled}
              />
            </span>
          </div>
          <div className="flex items-end gap-[10px]">
            <Textarea
              className="min-h-[44px] flex-1 resize-none rounded-xl border-[#4a3022]/70 bg-[#0f0c0a] text-stone-100 placeholder:text-stone-500"
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
            <Button
              type="submit"
              className="rounded-xl bg-amber-600 text-white hover:bg-amber-500"
              disabled={!draft.trim() || isBusy}
            >
              <Send size={16} /> {t('gemma4_assistant.send')}
            </Button>
          </div>
        </form>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/[.08] pt-3 text-[11px] text-stone-500">
          <Button
            variant={recording.isRecording ? 'danger' : 'primary'}
            className="hidden"
            disabled={isBusy && !recording.isRecording}
            onClick={recording.isRecording ? recording.stopRecording : recording.startRecording}
          >
            {recording.isRecording ? <Square size={16} /> : <Mic size={16} />}
            {recording.isRecording ? t('gemma4_assistant.stop') : t('gemma4_assistant.talk')}
          </Button>
          <span
            className="ml-auto inline-flex items-center gap-[6px] text-xs text-stone-400"
            aria-live="polite"
          >
            <Volume2 size={15} /> {phaseLabel}
          </span>
        </footer>
      </div>
    </div>
  );
}
