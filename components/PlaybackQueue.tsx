import { useEffect, useMemo, useRef, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';

export function PlaybackQueue({ onClose }: { onClose: () => void }) {
  const library = useLibrary();
  const close = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const offset = Math.min(page * 100, Math.floor(Math.max(0, library.queueEntries.length - 1) / 100) * 100);
  const entries = useMemo(() => library.queueEntries.slice(offset, offset + 100), [library.queueEntries, offset]);
  const byId = useMemo(() => new Map(library.state.tracks.map((track) => [track.id, track])), [library.state.tracks]);
  const { getTracks } = library;
  useEffect(() => {
    const missing = [...new Set(entries.filter((entry) => !byId.has(entry.trackId)).map((entry) => entry.trackId))];
    if (missing.length) void getTracks(missing).catch(() => setError('Could not load queue tracks. Reopen the queue to retry.'));
  }, [entries, byId, getTracks]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <aside
      aria-label="Play queue"
      className="absolute right-0 top-10 bottom-20 w-96 max-w-full z-50 bg-neutral-950 border-l border-white/10 flex flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="p-4 flex justify-between">
        <h2>Play queue</h2>
        <button ref={close} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="px-4 pb-4 flex gap-4">
        <button onClick={library.shuffleQueue}>Shuffle upcoming</button>
        <button onClick={library.clearQueue}>Clear queue</button>
      </div>
      <div className="px-4 pb-3 flex gap-4 text-sm" aria-label="Queue pages">
        <span>{library.queueEntries.length} queued</span>
        <button disabled={!offset} onClick={() => setPage(offset / 100 - 1)}>
          Previous
        </button>
        <button disabled={offset + 100 >= library.queueEntries.length} onClick={() => setPage(offset / 100 + 1)}>
          Next
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="overflow-auto min-h-0">
        <ol aria-label="Queued tracks" className="p-3 space-y-2">
          {entries.map((entry) => {
            const found = byId.get(entry.trackId);
            const track = { ...found, name: found?.name || 'Loading track…', queueId: entry.id };
            return (
              <li key={track.queueId} className={`rounded-lg p-3 ${track.queueId === library.currentQueueId ? 'bg-white/10' : ''}`}>
                <button onClick={() => library.playQueueEntry(track.queueId)} className="text-left w-full">
                  <span className="block truncate">{track.name}</span>
                  <span className="text-xs text-neutral-400">{track.artist}</span>
                </button>
                <div className="flex gap-3 mt-2 text-xs">
                  <button aria-label={`Move ${track.name} up`} onClick={() => library.moveQueueEntry(track.queueId, -1)}>
                    Up
                  </button>
                  <button aria-label={`Move ${track.name} down`} onClick={() => library.moveQueueEntry(track.queueId, 1)}>
                    Down
                  </button>
                  <button aria-label={`Remove ${track.name} from queue`} onClick={() => library.removeQueueEntry(track.queueId)}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        {library.suggestions.length > 0 && (
          <section aria-label="Suggested tracks" className="p-4 border-t border-white/10 space-y-3">
            <h3>Explore your library</h3>
            <p className="text-xs text-neutral-400">
              Suggestions use favorites, listening history, and available local audio analysis. Choose which tracks to add.
            </p>
            <ul className="space-y-3">
              {library.suggestions.map(({ track, reasons }) => (
                <li key={track.id}>
                  <p>
                    {track.name} <span className="text-xs text-neutral-400">· {track.artist}</span>
                  </p>
                  <p className="text-xs text-neutral-400">{reasons.join(' · ')}</p>
                  <button className="text-sm mt-1" aria-label={`Add ${track.name} to queue`} onClick={() => library.enqueueTrack(track.id)}>
                    Add to queue
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
