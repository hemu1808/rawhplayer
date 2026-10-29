import { describe, expect, it } from 'vitest';
import { suggestQueue } from '../services/queueSuggestions';
import type { Track } from '../types';

describe('local queue suggestions', () => {
  const track = (id: string, changes: Partial<Track> = {}): Track => ({
    id,
    name: id,
    artist: 'Artist',
    path: `/music/${id}.wav`,
    ...changes,
  });
  it('excludes current, queued, missing and unplayable tracks without changing the library', () => {
    const tracks = [
      track('current'),
      track('queued'),
      track('missing', { missing: true }),
      track('remote', { path: undefined }),
      track('available'),
    ];
    const before = structuredClone(tracks);
    expect(suggestQueue(tracks, [{ id: 'q', trackId: 'queued' }], tracks[0]).map(({ track }) => track.id)).toEqual([
      'available',
    ]);
    expect(tracks).toEqual(before);
  });
  it('explains favorite and artist matches and lets users discover unplayed music', () => {
    const tracks = [
      track('familiar', { artist: 'Other', playCount: 10 }),
      track('discovery'),
      track('favorite', { isLiked: true, playCount: 3 }),
    ];
    const suggestions = suggestQueue(tracks, [], track('current'));
    expect(suggestions.map(({ track }) => track.id)).toEqual(['favorite', 'discovery', 'familiar']);
    expect(suggestions[0].reasons).toContain('A favorite');
    expect(suggestions[1].reasons).toContain('Not played yet');
    expect(suggestQueue(tracks, [], undefined, 0)).toEqual([]);
  });
});
