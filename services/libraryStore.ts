import { LibrarySnapshot, PlaybackMode, Playlist, QueueEntry, SmartRule, Track } from '../types';

export const LIBRARY_KEY = 'rawh_library_v1';
const MAX_TRACKS = 100_000;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length <= max && !value.includes('\0');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const emptyLibrary = (): LibrarySnapshot => ({
  schemaVersion: 1,
  tracks: [],
  queue: [],
  playlists: [],
  session: { currentQueueId: null, position: 0, playbackMode: PlaybackMode.SEQUENCE },
  watchedFolders: [],
});

export function parseTrack(value: unknown): Track {
  if (!object(value) || !text(value.id, 256) || !value.id || !text(value.name) || !text(value.artist)) {
    throw new Error('The library contains an invalid track.');
  }
  const track: Track = { id: value.id, name: value.name, artist: value.artist };
  const strings = ['path', 'album', 'format', 'year', 'copyright', 'genre', 'artworkPath'] as const;
  for (const key of strings) if (text(value[key])) track[key] = value[key];
  // Blob URLs and transient native asset URLs must never survive a process restart.
  if (text(value.image, 2_000_000) && /^(data:image\/|https?:\/\/)/.test(value.image)) track.image = value.image;
  const numbers = [
    'duration',
    'dateAdded',
    'bitrate',
    'sampleRate',
    'bitDepth',
    'trackNumber',
    'playCount',
    'listeningSeconds',
  ] as const;
  for (const key of numbers) if (finite(value[key]) && value[key] >= 0) track[key] = value[key];
  for (const key of ['replayGainTrack', 'replayGainAlbum'] as const) {
    if (finite(value[key]) && Math.abs(value[key]) <= 60) track[key] = value[key];
  }
  if (typeof value.isLiked === 'boolean') track.isLiked = value.isLiked;
  if (typeof value.missing === 'boolean') track.missing = value.missing;
  if (value.source === 'local' || value.source === 'youtube') track.source = value.source;
  return track;
}

export function parseSmartRule(value: unknown): SmartRule | undefined {
  if (value === undefined || value === null) return undefined;
  if (!object(value)) throw new Error('Invalid smart playlist rules.');
  const rule: SmartRule = {};
  for (const key of ['query', 'artist', 'genre', 'format'] as const) {
    if (value[key] !== undefined) {
      if (!text(value[key], 512)) throw new Error('Invalid smart playlist filter.');
      rule[key] = value[key];
    }
  }
  for (const key of ['likedOnly', 'unplayedOnly'] as const) {
    if (typeof value[key] === 'boolean') rule[key] = value[key];
  }
  for (const key of ['addedWithinDays', 'minSampleRate'] as const) {
    if (value[key] !== undefined) {
      if (!finite(value[key]) || value[key] < 0) throw new Error('Invalid smart playlist range.');
      rule[key] = value[key];
    }
  }
  return rule;
}

export function parseLibrarySnapshot(value: unknown): LibrarySnapshot {
  if (!object(value) || value.schemaVersion !== 1) throw new Error('Unsupported library backup version.');
  if (
    !Array.isArray(value.tracks) ||
    value.tracks.length > MAX_TRACKS ||
    !Array.isArray(value.queue) ||
    value.queue.length > MAX_TRACKS ||
    !Array.isArray(value.playlists) ||
    value.playlists.length > 10_000 ||
    !object(value.session) ||
    !Array.isArray(value.watchedFolders)
  ) {
    throw new Error('Invalid library backup.');
  }
  const tracks = value.tracks.map(parseTrack);
  const trackIds = new Set(tracks.map((track) => track.id));
  if (trackIds.size !== tracks.length) throw new Error('Duplicate track IDs in library backup.');
  const queue: QueueEntry[] = value.queue.map((entry) => {
    if (
      !object(entry) ||
      !text(entry.id, 256) ||
      !entry.id ||
      !text(entry.trackId, 256) ||
      !trackIds.has(entry.trackId)
    ) {
      throw new Error('The queue references an unknown track.');
    }
    return { id: entry.id, trackId: entry.trackId };
  });
  const queueIds = new Set(queue.map((entry) => entry.id));
  if (queueIds.size !== queue.length) throw new Error('Duplicate queue entry IDs.');
  const playlists: Playlist[] = value.playlists.map((playlist) => {
    if (
      !object(playlist) ||
      !text(playlist.id, 256) ||
      !playlist.id ||
      !text(playlist.name, 256) ||
      !playlist.name.trim() ||
      !Array.isArray(playlist.trackIds) ||
      playlist.trackIds.length > MAX_TRACKS ||
      !playlist.trackIds.every((id) => typeof id === 'string' && trackIds.has(id))
    ) {
      throw new Error('Invalid playlist in library backup.');
    }
    return {
      id: playlist.id,
      name: playlist.name.trim(),
      trackIds: playlist.trackIds as string[],
      smartRule: parseSmartRule(playlist.smartRule),
      createdAt: finite(playlist.createdAt) && playlist.createdAt >= 0 ? playlist.createdAt : 0,
    };
  });
  if (new Set(playlists.map((item) => item.id)).size !== playlists.length) throw new Error('Duplicate playlist IDs.');
  const mode = value.session.playbackMode;
  if (!Object.values(PlaybackMode).includes(mode as PlaybackMode)) throw new Error('Invalid playback mode.');
  if (!finite(value.session.position) || value.session.position < 0) throw new Error('Invalid playback position.');
  if (value.watchedFolders.length > 1000 || !value.watchedFolders.every((path) => text(path))) {
    throw new Error('Invalid watched folders.');
  }
  return {
    schemaVersion: 1,
    tracks,
    queue,
    playlists,
    session: {
      currentQueueId:
        typeof value.session.currentQueueId === 'string' && queueIds.has(value.session.currentQueueId)
          ? value.session.currentQueueId
          : null,
      position: value.session.position,
      playbackMode: mode as PlaybackMode,
    },
    watchedFolders: [...new Set(value.watchedFolders as string[])],
  };
}

export function loadBrowserLibrary(): LibrarySnapshot {
  const saved = localStorage.getItem(LIBRARY_KEY);
  if (saved) return parseLibrarySnapshot(JSON.parse(saved));
  const legacy = localStorage.getItem('rawh_tracks');
  if (!legacy) return emptyLibrary();
  const oldTracks: unknown = JSON.parse(legacy);
  if (!Array.isArray(oldTracks) || oldTracks.length > MAX_TRACKS) throw new Error('Invalid legacy library.');
  const tracks = mergeTracks([], oldTracks.map(parseTrack));
  const queue = tracks.map((track) => ({ id: crypto.randomUUID(), trackId: track.id }));
  const oldIndex = Number(localStorage.getItem('rawh_current_track_idx'));
  const oldMode = localStorage.getItem('rawh_playback_mode');
  return {
    ...emptyLibrary(),
    tracks,
    queue,
    session: {
      currentQueueId: queue[oldIndex]?.id ?? null,
      position: 0,
      playbackMode: Object.values(PlaybackMode).includes(oldMode as PlaybackMode)
        ? (oldMode as PlaybackMode)
        : PlaybackMode.SEQUENCE,
    },
  };
}

function pathKey(path: string): string {
  // Windows paths compare case-insensitively; POSIX paths must retain case.
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') ? path.replace(/\\/g, '/').toLowerCase() : path;
}

export function mergeTracks(existing: Track[], incoming: Track[]): Track[] {
  const result = [...existing];
  const byId = new Map(result.map((track, index) => [track.id, index]));
  const byPath = new Map(result.flatMap((track, index) => (track.path ? [[pathKey(track.path), index] as const] : [])));
  for (const candidate of incoming) {
    const track = parseTrack(candidate);
    const index = byId.get(track.id) ?? (track.path ? byPath.get(pathKey(track.path)) : undefined);
    if (index !== undefined) {
      const previous = result[index];
      result[index] = {
        ...previous,
        ...track,
        id: previous.id,
        isLiked: previous.isLiked ?? track.isLiked,
        playCount: Math.max(previous.playCount ?? 0, track.playCount ?? 0),
        listeningSeconds: Math.max(previous.listeningSeconds ?? 0, track.listeningSeconds ?? 0),
      };
    } else {
      byId.set(track.id, result.length);
      if (track.path) byPath.set(pathKey(track.path), result.length);
      result.push(track);
    }
  }
  return result;
}

export function resolvePlaylistTracks(playlist: Playlist, tracks: Track[], now = Date.now()): Track[] {
  const rule = playlist.smartRule;
  if (!rule) {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return playlist.trackIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  }
  const includes = (value: string | undefined, filter: string | undefined) =>
    !filter || (value ?? '').toLocaleLowerCase().includes(filter.toLocaleLowerCase());
  return tracks.filter(
    (track) =>
      includes(`${track.name} ${track.artist} ${track.album ?? ''}`, rule.query) &&
      includes(track.artist, rule.artist) &&
      includes(track.genre, rule.genre) &&
      includes(track.format, rule.format) &&
      (!rule.likedOnly || track.isLiked) &&
      (!rule.unplayedOnly || !track.playCount) &&
      (!rule.minSampleRate || (track.sampleRate ?? 0) >= rule.minSampleRate) &&
      (!rule.addedWithinDays || (track.dateAdded ?? 0) >= now - rule.addedWithinDays * 86_400_000),
  );
}

export function removeQueueEntrySnapshot(snapshot: LibrarySnapshot, id: string): LibrarySnapshot {
  const index = snapshot.queue.findIndex((entry) => entry.id === id);
  if (index < 0) return snapshot;
  const queue = snapshot.queue.filter((entry) => entry.id !== id);
  return {
    ...snapshot,
    queue,
    session:
      snapshot.session.currentQueueId === id
        ? { ...snapshot.session, currentQueueId: queue[index]?.id ?? queue[index - 1]?.id ?? null, position: 0 }
        : snapshot.session,
  };
}

export function nextQueueEntry(snapshot: LibrarySnapshot): QueueEntry | undefined {
  const index = snapshot.queue.findIndex((entry) => entry.id === snapshot.session.currentQueueId);
  if (snapshot.session.playbackMode === PlaybackMode.LOOP && index >= 0) return snapshot.queue[index];
  return snapshot.queue[index + 1];
}

export function findDuplicateTracks(tracks: Track[]): Track[][] {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = `${track.artist.trim().toLocaleLowerCase()}\0${track.name.trim().toLocaleLowerCase()}\0${Math.round(track.duration ?? 0)}`;
    const group = groups.get(key) ?? [];
    group.push(track);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
