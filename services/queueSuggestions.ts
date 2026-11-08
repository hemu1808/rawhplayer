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
      const a = current?.analysis;
      const b = track.analysis;
      if (a && b) {
        if (a.bpm && b.bpm && a.bpmConfidence >= 0.2 && b.bpmConfidence >= 0.2) {
          const distance = Math.min(...[0.5, 1, 2].map((scale) => Math.abs(b.bpm! * scale - a.bpm!) / a.bpm!));
          if (distance <= 0.08) {
            score += 5;
            reasons.push(`Similar estimated tempo (≈${Math.round(b.bpm)} BPM)`);
          }
        }
        if (
          a.musicalKey &&
          b.musicalKey &&
          a.keyConfidence >= 0.1 &&
          b.keyConfidence >= 0.1 &&
          compatibleKeys(a.musicalKey, b.musicalKey)
        ) {
          score += 4;
          reasons.push(`Compatible estimated key (${b.musicalKey})`);
        }
        if (Math.abs(a.energy - b.energy) <= 0.08 && a.energy > 0.001 && b.energy > 0.001) {
          score += 2;
          reasons.push('Similar measured energy');
        }
        if (
          a.integratedLufs !== null &&
          b.integratedLufs !== null &&
          Math.abs(a.integratedLufs - b.integratedLufs) <= 3
        ) {
          score += 1;
          reasons.push('Similar measured loudness');
        }
      }
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

function compatibleKeys(first: string, second: string) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const [a, modeA] = first.split(' ');
  const [b, modeB] = second.split(' ');
  const tonicA = notes.indexOf(a);
  const tonicB = notes.indexOf(b);
  if (tonicA < 0 || tonicB < 0) return false;
  const distance = (tonicB - tonicA + 12) % 12;
  return modeA === modeB ? [0, 5, 7].includes(distance) : distance === (modeA === 'major' ? 9 : 3);
}
