import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

export function formatPlaybackTime(seconds: number) {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

interface SeekBarProps {
  time: number;
  duration: number;
  onSeek: (time: number) => void;
  compact?: boolean;
}

export function SeekBar({ time, duration, onSeek, compact = false }: SeekBarProps) {
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const length = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTime = Number.isFinite(time) ? time : 0;
  const position = Math.max(0, Math.min(length, preview ?? safeTime));

  const cancelReset = () => {
    if (reset.current !== null) clearTimeout(reset.current);
    reset.current = null;
  };

  useEffect(
    () => () => {
      if (reset.current !== null) clearTimeout(reset.current);
    },
    [],
  );

  function commit(value: number) {
    cancelReset();
    setPreview(value);
    onSeek(value);
    reset.current = setTimeout(() => setPreview(null), 450);
  }

  function finish(event: PointerEvent<HTMLInputElement>) {
    if (drag.current !== event.pointerId) return;
    drag.current = null;
    commit(event.currentTarget.valueAsNumber);
  }

  return (
    <div className={`seek-bar${compact ? ' seek-bar--compact' : ''}`}>
      <span className="seek-time" aria-hidden="true">
        {formatPlaybackTime(position)}
      </span>
      <input
        className="player-range seek-input"
        style={{ '--range-progress': `${length ? (position / length) * 100 : 0}%` } as CSSProperties}
        type="range"
        min={0}
        max={length || 1}
        step="any"
        value={position}
        disabled={!length}
        aria-label="Playback position"
        aria-valuetext={`${formatPlaybackTime(position)} of ${formatPlaybackTime(length)}`}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          cancelReset();
          drag.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={finish}
        onPointerCancel={() => {
          drag.current = null;
          setPreview(null);
        }}
        onLostPointerCapture={() => {
          if (drag.current === null) return;
          drag.current = null;
          setPreview(null);
        }}
        onChange={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (drag.current === null) commit(value);
          else setPreview(value);
        }}
      />
      <span className="seek-time" aria-hidden="true">
        {formatPlaybackTime(length)}
      </span>
    </div>
  );
}
