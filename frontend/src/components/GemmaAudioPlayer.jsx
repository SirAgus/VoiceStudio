import React, { useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function GemmaAudioPlayer({
  src,
  label,
  downloadLabel,
  downloading = false,
  onDownload,
}) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const seek = (event) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    const next = (Number(event.target.value) / 100) * duration;
    audio.currentTime = next;
    setCurrentTime(next);
  };

  return (
    <div className="gemma-audio-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        className="gemma-audio-play"
        aria-label={label}
        onClick={togglePlayback}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="gemma-audio-timeline">
        <div className="gemma-audio-times" aria-hidden="true">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          aria-label={label}
          onChange={seek}
          style={{ '--gemma-audio-progress': `${progress}%` }}
        />
      </div>
      <label className="gemma-audio-download" title={downloadLabel}>
        <Download size={16} aria-hidden="true" />
        <select
          aria-label={downloadLabel}
          disabled={downloading}
          defaultValue=""
          onChange={(event) => {
            const format = event.target.value;
            if (format) onDownload(format);
            event.target.value = '';
          }}
        >
          <option value="">{downloadLabel}</option>
          <option value="wav">WAV</option>
          <option value="mp3">MP3</option>
          <option value="ogg">OGG</option>
        </select>
      </label>
    </div>
  );
}
