import { describe, expect, it } from 'vitest';
import {
  emptyLibrary,
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
  it('evaluates smart favorites against current library data', () => {
    const playlist = { id: 'favorites', name: 'Favorites', trackIds: [], createdAt: 0, smartRule: { likedOnly: true } };
    expect(resolvePlaylistTracks(playlist, [first, second]).map((track) => track.id)).toEqual(['a']);
  });
});
