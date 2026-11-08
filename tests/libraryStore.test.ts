import { describe, expect, it } from 'vitest';
import {
  emptyLibrary,
  LIBRARY_LIMITS,
  mergeTracks,
  parseLibrarySnapshot,
  removeQueueEntrySnapshot,
  resolvePlaylistTracks,
} from '../services/libraryStore';

describe('durable library invariants', () => {
  const first = { id: 'a', name: 'First', artist: 'Artist', path: 'C:/music/a.wav', isLiked: true };
  const second = { id: 'b', name: 'Second', artist: 'Artist', path: 'C:/music/b.wav' };
  it('removes a queue entry without deleting its library track', () => {
    const snapshot = emptyLibrary();
    snapshot.tracks = [first, second];
    snapshot.queue = [
      { id: 'one', trackId: 'a' },
      { id: 'two', trackId: 'b' },
    ];
    snapshot.session.currentQueueId = 'one';
    const next = removeQueueEntrySnapshot(snapshot, 'one');
    expect(next.tracks).toHaveLength(2);
    expect(next.queue).toEqual([{ id: 'two', trackId: 'b' }]);
  });
  it('deduplicates imported tracks', () => {
    expect(mergeTracks([first], [first])).toHaveLength(1);
  });
  it('rejects corrupt persisted state', () => {
    expect(() => parseLibrarySnapshot({ schemaVersion: 999 })).toThrow();
  });
  it('loads existing libraries above the old browser limit without truncation', () => {
    const snapshot = emptyLibrary();
    snapshot.tracks = Array.from({ length: 100_001 }, (_, index) => ({
      id: String(index),
      name: 'Track',
      artist: 'Artist',
      path: `C:/music/${index}.wav`,
    }));
    const loaded = parseLibrarySnapshot(snapshot);
    expect(loaded.tracks).toHaveLength(100_001);
    expect(loaded.tracks.at(-1)?.id).toBe('100000');
  });
  it('rejects tracks and queue entries beyond the shared contract', () => {
    const snapshot = emptyLibrary();
    snapshot.tracks = new Array(LIBRARY_LIMITS.maxTracks + 1).fill(first);
    expect(() => parseLibrarySnapshot(snapshot)).toThrow();
    snapshot.tracks = [first];
    snapshot.queue = new Array(LIBRARY_LIMITS.maxQueueEntries + 1).fill({ id: 'entry', trackId: first.id });
    expect(() => parseLibrarySnapshot(snapshot)).toThrow();
  });
  it('evaluates smart favorites against current library data', () => {
    const playlist = { id: 'favorites', name: 'Favorites', trackIds: [], createdAt: 0, smartRule: { likedOnly: true } };
    expect(resolvePlaylistTracks(playlist, [first, second]).map((track) => track.id)).toEqual(['a']);
  });
});
