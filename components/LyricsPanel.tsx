import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Track } from '../types';

export function LyricsPanel({
  track,
  isOpen,
  onClose,
  currentTime = 0,
}: {
  track: Track | null;
  isOpen: boolean;
  onClose: () => void;
  currentTime?: number;
}) {
  const [lyrics, setLyrics] = useState('');
  const [status, setStatus] = useState('');
  const id = track?.id;
  useEffect(() => {
    if (!isOpen || !id) return;
    let active = true;
    setLyrics('');
    setStatus('Reading local lyrics…');
    invoke<string | null>('library_read_lyrics', { trackId: id })
      .then((text) => {
        if (active) {
          setLyrics(text || '');
          setStatus(text ? '' : 'Place an LRC or TXT file next to your music file with the same name.');
        }
      })
      .catch(() => {
        if (active) setStatus('Local lyrics are unavailable.');
      });
    return () => {
      active = false;
    };
  }, [id, isOpen]);
  const lines = useMemo(
    () =>
      lyrics
        .split(/\r?\n/)
        .flatMap((line) => {
          const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
          return tags.map((tag) => ({ time: Number(tag[1]) * 60 + Number(tag[2]), text: line.replace(/\[[^\]]*\]/g, '').trim() }));
        })
        .sort((a, b) => a.time - b.time),
    [lyrics],
  );
  if (!isOpen) return null;
  return (
    <aside
      aria-label="Local lyrics"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="absolute inset-y-0 right-0 w-80 z-40 bg-neutral-950 border-l border-white/10 p-5 overflow-auto"
    >
      <div className="flex justify-between mb-5">
        <h2>Lyrics</h2>
        <button onClick={onClose}>Close</button>
      </div>
      {status && (
        <p role="status" className="text-neutral-400">
          {status}
        </p>
      )}
      {lines.length ? (
        lines.map((line, index) => (
          <p
            key={index}
            className={
              line.time <= currentTime && (!lines[index + 1] || lines[index + 1].time > currentTime)
                ? 'text-primary-300 font-semibold my-4'
                : 'text-neutral-400 my-4'
            }
          >
            {line.text}
          </p>
        ))
      ) : (
        <p className="whitespace-pre-wrap">{lyrics}</p>
      )}
    </aside>
  );
}
