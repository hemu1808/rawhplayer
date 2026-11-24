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
  it('explains confident audio matches and omits uncertain tempo and key claims', () => {
    const analysis: NonNullable<Track['analysis']> = {
      version: 1,
      contentHash: 'a'.repeat(64),
      analyzedSeconds: 180,
      complete: true,
      bpm: 120,
      bpmConfidence: 0.8,
      musicalKey: 'C major',
      keyConfidence: 0.6,
      integratedLufs: -14,
      truePeakDb: -1,
      energy: 0.2,
    };
    const current = track('current', { analysis });
    const matched = track('matched', { analysis: { ...analysis, bpm: 123, musicalKey: 'A minor' } });
    const uncertain = track('uncertain', { analysis: { ...analysis, bpmConfidence: 0.05, keyConfidence: 0.05 } });
    const suggestions = suggestQueue([matched, uncertain], [], current);
    expect(suggestions[0].track.id).toBe('matched');
    expect(suggestions[0].reasons).toContain('Similar estimated tempo (≈123 BPM)');
    expect(suggestions[0].reasons).toContain('Compatible estimated key (A minor)');
    expect(suggestions[1].reasons.some((reason) => reason.includes('tempo') || reason.includes('key'))).toBe(false);
  });
});
