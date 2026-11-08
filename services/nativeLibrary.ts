import {
  commands,
  type CatalogQuery,
  type LibraryHeader,
  type LibraryPatch,
  type Playlist as NativePlaylist,
  type QueueOperation,
  type UserTrackPatch,
} from './generated/native';
import { emptyLibrary, parseTrack } from './libraryStore';
import { PlaybackMode, type LibrarySnapshot, type Playlist, type QueueEntry, type Track } from '../types';

export const catalogQuery = (query: Partial<CatalogQuery> = {}): CatalogQuery => ({
  offset: 0,
  limit: 100,
  search: null,
  sort: 'recent',
  artist: null,
  album: null,
  playlistId: null,
  favoritesOnly: false,
  minBpm: null,
  maxBpm: null,
  ...query,
});
export function preserveUserMetadata(incoming: Track, current?: Track): Track {
  return current
    ? {
        ...incoming,
        isLiked: current.isLiked,
        playCount: current.playCount,
        listeningSeconds: current.listeningSeconds,
      }
    : incoming;
}
export function nativeSnapshot(header: LibraryHeader): LibrarySnapshot {
  const state = header.state;
  const snapshot = emptyLibrary();
  snapshot.tracks = header.initialTracks.map(parseTrack);
  snapshot.queue = state.queue ?? [];
  snapshot.playlists = (state.playlists ?? []).map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    trackIds: playlist.trackIds ?? [],
    createdAt: playlist.createdAt ?? 0,
    smartRule: playlist.smartRule
      ? {
          ...Object.fromEntries(Object.entries(playlist.smartRule).filter(([, value]) => value !== null)),
        }
      : undefined,
  }));
  snapshot.session = state.session
    ? {
        ...state.session,
        position: state.session.position ?? 0,
        playbackMode: Object.values(PlaybackMode).includes(state.session.playbackMode as PlaybackMode)
          ? (state.session.playbackMode as PlaybackMode)
          : PlaybackMode.SEQUENCE,
      }
    : snapshot.session;
  snapshot.watchedFolders = state.watchedFolders ?? [];
  return snapshot;
}
const nativePlaylist = (playlist: Playlist): NativePlaylist => ({
  ...playlist,
  smartRule: playlist.smartRule
    ? {
        query: null,
        artist: null,
        genre: null,
        format: null,
        likedOnly: false,
        unplayedOnly: false,
        addedWithinDays: null,
        minSampleRate: null,
        ...playlist.smartRule,
      }
    : null,
});
const preferences = (track: Track) => [!!track.isLiked, track.playCount ?? 0, track.listeningSeconds ?? 0].join(':');

export function queueDelta(
  before: QueueEntry[],
  after: QueueEntry[],
): Pick<LibraryPatch, 'replaceQueue' | 'queueOperations'> {
  if (before === after) return { replaceQueue: null, queueOperations: [] };
  const oldIds = new Set(before.map((entry) => entry.id));
  const nextIds = new Set(after.map((entry) => entry.id));
  const operations: QueueOperation[] = before
    .filter((entry) => !nextIds.has(entry.id))
    .map((entry) => ({ kind: 'remove', id: entry.id }));
  const working = before.filter((entry) => nextIds.has(entry.id));
  const replacement = () => ({ replaceQueue: after, queueOperations: [] });
  if (operations.length > 64 || Math.abs(before.length - after.length) > 64) return replacement();
  for (let index = 0; index < after.length; index++) {
    const entry = after[index];
    if (working[index]?.id === entry.id && working[index]?.trackId === entry.trackId) continue;
    if (oldIds.has(entry.id)) {
      const oldIndex = working.findIndex((item) => item.id === entry.id);
      if (oldIndex < 0 || working[oldIndex].trackId !== entry.trackId) return replacement();
      operations.push({ kind: 'move', id: entry.id, beforeId: working[index]?.id ?? null });
      working.splice(oldIndex, 1);
      working.splice(index, 0, entry);
    } else {
      operations.push({ kind: 'insert', entry, afterId: after[index - 1]?.id ?? null });
      working.splice(index, 0, entry);
    }
    if (operations.length > 64) return replacement();
  }
  return { replaceQueue: null, queueOperations: operations };
}

/** Tracks user edits independently of the bounded metadata cache. Failed writes keep their edits. */
export class NativeLibrarySession {
  revision = 0;
  catalogRevision = 0;
  private base = emptyLibrary();
  private dirty = new Map<string, UserTrackPatch>();
  adopt(header: LibraryHeader, preserveEdits = false) {
    this.revision = header.revision;
    this.catalogRevision = header.catalogRevision;
    this.base = nativeSnapshot(header);
    if (!preserveEdits) this.dirty.clear();
    return this.base;
  }
  observe(before: LibrarySnapshot, after: LibrarySnapshot) {
    if (before.tracks === after.tracks) return;
    const byId = new Map(before.tracks.map((track) => [track.id, track]));
    for (const track of after.tracks) {
      const previous = byId.get(track.id);
      if (previous && preferences(previous) !== preferences(track))
        this.dirty.set(track.id, {
          id: track.id,
          isLiked: !!track.isLiked,
          playCount: track.playCount ?? 0,
          listeningSeconds: track.listeningSeconds ?? 0,
        });
    }
    const surviving = new Set(after.tracks.map((track) => track.id));
    for (const id of this.dirty.keys())
      if (!surviving.has(id) && before.tracks.some((track) => track.id === id)) this.dirty.delete(id);
  }
  async save(current: LibrarySnapshot) {
    const tracks = [...this.dirty.values()];
    const oldPlaylists = new Map(this.base.playlists.map((playlist) => [playlist.id, playlist]));
    const upserts = current.playlists.filter(
      (playlist) => JSON.stringify(oldPlaylists.get(playlist.id)) !== JSON.stringify(playlist),
    );
    const currentIds = new Set(current.playlists.map((playlist) => playlist.id));
    const removals = this.base.playlists
      .filter((playlist) => !currentIds.has(playlist.id))
      .map((playlist) => playlist.id);
    const queue = queueDelta(this.base.queue, current.queue);
    const session = JSON.stringify(this.base.session) === JSON.stringify(current.session) ? null : current.session;
    if (
      !tracks.length &&
      !upserts.length &&
      !removals.length &&
      !queue.replaceQueue &&
      !queue.queueOperations?.length &&
      !session
    )
      return;
    for (
      let index = 0;
      index <
      Math.max(1, Math.ceil(tracks.length / 500), Math.ceil(upserts.length / 100), Math.ceil(removals.length / 100));
      index++
    ) {
      const patch: LibraryPatch = {
        baseRevision: this.revision,
        tracks: tracks.slice(index * 500, (index + 1) * 500),
        upsertPlaylists: upserts.slice(index * 100, (index + 1) * 100).map(nativePlaylist),
        removePlaylists: removals.slice(index * 100, (index + 1) * 100),
        ...(index === 0 ? queue : { replaceQueue: null, queueOperations: [] }),
        session: index === 0 ? session : null,
      };
      const receipt = await commands.libraryPatch(patch);
      this.revision = receipt.revision;
      this.catalogRevision = Math.max(this.catalogRevision, receipt.catalogRevision);
      for (const track of patch.tracks ?? []) if (this.dirty.get(track.id) === track) this.dirty.delete(track.id);
      const savedPlaylists = new Map(this.base.playlists.map((playlist) => [playlist.id, playlist]));
      for (const id of patch.removePlaylists ?? []) savedPlaylists.delete(id);
      for (const playlist of upserts.slice(index * 100, (index + 1) * 100)) savedPlaylists.set(playlist.id, playlist);
      this.base = {
        ...this.base,
        queue: index === 0 ? current.queue : this.base.queue,
        session: index === 0 ? current.session : this.base.session,
        playlists: [...savedPlaylists.values()],
      };
    }
    this.base = current;
  }
  get dirtyTrackIds() {
    return new Set(this.dirty.keys());
  }
}
