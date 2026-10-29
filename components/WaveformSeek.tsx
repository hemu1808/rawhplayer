import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
export function WaveformSeek({
  trackId,
  time,
  duration,
  onSeek,
}: {
  trackId: string;
  time: number;
  duration: number;
  onSeek: (value: number) => void;
}) {
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    setPeaks([]);
    invoke<{ peaks: number[] }>('library_waveform', { trackId, bins: 240 })
      .then((result) => {
        if (active) setPeaks(result.peaks);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [trackId]);
  return (
    <div className="relative h-12 w-full" aria-label="Track waveform">
      <svg aria-hidden="true" viewBox="0 0 240 32" preserveAspectRatio="none" className="h-full w-full">
        {peaks.map((peak, index) => (
          <line
            key={index}
            x1={index}
            x2={index}
            y1={16 - Math.max(1, peak * 15)}
            y2={16 + Math.max(1, peak * 15)}
            stroke={index / peaks.length <= time / duration ? 'var(--primary-300)' : '#737373'}
            strokeWidth="0.6"
          />
        ))}
      </svg>
      <input
        aria-label="Seek waveform"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(time, duration || 1)}
        disabled={!duration}
        onChange={(event) => onSeek(Number(event.target.value))}
        className="absolute inset-0 opacity-0 w-full cursor-pointer focus:opacity-80"
      />
    </div>
  );
}
