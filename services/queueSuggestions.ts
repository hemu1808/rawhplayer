import type { QueueEntry, Track } from '../types';

export interface QueueSuggestion {
  track: Track;
  reasons: string[];
}

export function suggestQueue(tracks: Track[], queue: QueueEntry[], current?: Track, limit = 6): QueueSuggestion[] {
  const queued = new Set(queue.map((entry) => entry.trackId));
  return tracks
    .filter((track) => track.path && !track.missing && track.id !== current?.id && !queued.has(track.id))
    .map((track) => {
      const reasons: string[] = [];
      let score = 0;
      if (track.isLiked) {
        score += 8;
        reasons.push('A favorite');
      }
      if (current?.artist && track.artist.trim().toLocaleLowerCase() === current.artist.trim().toLocaleLowerCase()) {
        score += 4;
        reasons.push('Same artist as the current track');
      }
      if (current?.genre && track.genre?.trim().toLocaleLowerCase() === current.genre.trim().toLocaleLowerCase()) {
        score += 2;
        reasons.push('Same genre as the current track');
      }
      if (!track.playCount) {
        score += 1;
        reasons.push('Not played yet');
      }
      if (!reasons.length) reasons.push('Rediscover a track from your library');
      return { track, reasons, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.track.playCount ?? 0) - (b.track.playCount ?? 0) ||
        (b.track.dateAdded ?? 0) - (a.track.dateAdded ?? 0) ||
        a.track.id.localeCompare(b.track.id),
    )
    .slice(0, Math.max(0, Math.min(50, Math.floor(limit))))
    .map(({ track, reasons }) => ({ track, reasons }));
}
