export interface TrackStats {
  playCount: number;
  totalListeningTime: number;
}

export interface StatsData {
  tracks: Record<string, TrackStats>;
}

const STATS_KEY = 'rawh_stats';

const loadStats = (): StatsData => {
  const data = localStorage.getItem(STATS_KEY);
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse stats', e);
    }
  }
  return { tracks: {} };
};

const saveStats = (stats: StatsData) => {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
};

export const recordPlay = (trackId: string) => {
  const stats = loadStats();
  if (!stats.tracks[trackId]) {
    stats.tracks[trackId] = { playCount: 0, totalListeningTime: 0 };
  }
  stats.tracks[trackId].playCount += 1;
  saveStats(stats);
};

export const recordListeningTime = (trackId: string, seconds: number) => {
  const stats = loadStats();
  if (!stats.tracks[trackId]) {
    stats.tracks[trackId] = { playCount: 0, totalListeningTime: 0 };
  }
  stats.tracks[trackId].totalListeningTime += seconds;
  saveStats(stats);
};

export const getStats = (): StatsData => {
  return loadStats();
};

export const getMostPlayed = (limit: number = 10) => {
  const stats = loadStats();
  const sorted = Object.entries(stats.tracks)
    .map(([trackId, data]) => ({ trackId, ...data }))
    .sort((a, b) => b.playCount - a.playCount);
  return sorted.slice(0, limit);
};
