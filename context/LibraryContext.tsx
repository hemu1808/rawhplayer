import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LibraryAction, LibrarySnapshot, PlaybackMode, Playlist, QueueEntry, SmartRule, Track } from '../types';
import {
  emptyLibrary,
  findDuplicateTracks,
  LIBRARY_KEY,
  loadBrowserLibrary,
  mergeTracks,
  nextQueueEntry,
  parseLibrarySnapshot,
  parseSmartRule,
  parseTrack,
  removeQueueEntrySnapshot,
  resolvePlaylistTracks,
} from '../services/libraryStore';
import { flushStats, recordListeningTime, recordPlay } from '../services/statsService';
import { errorMessage, usePlayer } from './PlayerContext';
import { suggestQueue, type QueueSuggestion } from '../services/queueSuggestions';

export interface QueueTrack extends Track {
  queueId: string;
  trackId: string;
}
export interface ScanProgress {
  processed: number;
  total: number;
  skipped: number;
  cancelled: boolean;
}
interface LibraryContextType {
  state: { tracks: Track[]; currentTrackIndex: number; playbackMode: PlaybackMode };
  snapshot: LibrarySnapshot;
  ready: boolean;
  error: string | null;
  clearError: () => void;
  dispatch: React.Dispatch<LibraryAction>;
  processFiles: (files: FileList | File[]) => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  addTracks: (tracks: Track[]) => void;
  handleNext: () => void;
  handlePrev: (currentTime: number) => void;
  playTrack: (index: number) => void;
  playById: (id: string) => void;
  playQueueEntry: (id: string) => void;
  currentTrack: Track | undefined;
  currentQueueId: string | null;
  queueEntries: QueueEntry[];
  queueTracks: QueueTrack[];
  enqueueTrack: (id: string, next?: boolean) => void;
  removeQueueEntry: (id: string) => void;
  moveQueueEntry: (id: string, direction: -1 | 1) => void;
  clearQueue: () => void;
  removeTrack: (id: string) => Promise<void>;
  repairTrack: (id: string) => Promise<void>;
  cyclePlaybackMode: () => void;
  toggleLike: (id: string) => void;
  shuffleQueue: () => void;
  playlists: Playlist[];
  createPlaylist: (name: string, trackIds?: string[], smartRule?: SmartRule) => string;
  updatePlaylist: (id: string, changes: Partial<Pick<Playlist, 'name' | 'trackIds' | 'smartRule'>>) => void;
  deletePlaylist: (id: string) => void;
  playPlaylist: (id: string) => void;
  getPlaylistTracks: (id: string) => Track[];
  duplicateGroups: Track[][];
  suggestions: QueueSuggestion[];
  exportLibrary: () => Promise<string>;
  restoreLibrary: (backup: string) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  scanProgress: ScanProgress | null;
  cancelScan: () => Promise<void>;
}

const isNative = () => Boolean(window.__TAURI_INTERNALS__);
const queueEntry = (trackId: string): QueueEntry => ({ id: crypto.randomUUID(), trackId });
const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(emptyLibrary);
  const snapshotRef = useRef(snapshot);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const requestedId = useRef<string | null>(null);
  const preloadedId = useRef<string | null>(null);
  const preloadKey = useRef('');
  const generation = useRef(0);
  const [transition, setTransition] = useState(0);
  const commands = useRef<Promise<void>>(Promise.resolve());
  const writes = useRef<Promise<void>>(Promise.resolve());
  const writeVersion = useRef(0);
  const busy = useRef(0);
  const mounted = useRef(true);
  const { reportError: playerError, setLoading, registerResumeHandler, refreshAudioInfo } = usePlayer();
  const reportError = useCallback((reason: unknown) => {
    if (mounted.current) setError(errorMessage(reason));
  }, []);
  const clearError = useCallback(() => setError(null), []);
  const update = useCallback((change: (current: LibrarySnapshot) => LibrarySnapshot) => {
    const next = change(snapshotRef.current);
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);
  const run = useCallback(
    (operation: () => Promise<void>) => {
      commands.current = commands.current.then(operation).catch((reason) => {
        reportError(reason);
        playerError(reason);
      });
      return commands.current;
    },
    [reportError, playerError],
  );

  const save = useCallback(() => {
    if (!readyRef.current || busy.current) return writes.current;
    const version = ++writeVersion.current;
    writes.current = writes.current
      .then(async () => {
        if (version !== writeVersion.current || !readyRef.current || busy.current) return;
        const current = parseLibrarySnapshot(snapshotRef.current);
        if (isNative()) await invoke('library_save', { snapshot: current });
        else localStorage.setItem(LIBRARY_KEY, JSON.stringify(current));
      })
      .catch(reportError);
    return writes.current;
  }, [reportError]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const load = async () => {
      try {
        let loaded = isNative() ? parseLibrarySnapshot(await invoke('library_load')) : loadBrowserLibrary();
        if (isNative() && !loaded.tracks.length && (localStorage.getItem(LIBRARY_KEY) || localStorage.getItem('rawh_tracks'))) {
          try {
            const legacy = loadBrowserLibrary();
            loaded = parseLibrarySnapshot(await invoke('library_migrate_legacy', { backup: JSON.stringify(legacy) }));
          } catch (reason) {
            if (active) reportError(`Your previous library was preserved but could not be migrated: ${errorMessage(reason)}`);
          }
        }
        if (!active) return;
        update(() => loaded);
        readyRef.current = true;
        setReady(true);
      } catch (reason) {
        if (active) reportError(reason);
      }
    };
    void load();
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [update, reportError]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => void save(), 400);
    return () => clearTimeout(timer);
  }, [snapshot, ready, save]);

  useEffect(() => {
    const flush = () => {
      void save();
      flushStats();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  const stop = useCallback(() => {
    generation.current += 1;
    requestedId.current = null;
    activeIdRef.current = null;
    preloadedId.current = null;
    preloadKey.current = '';
    setActiveQueueId(null);
    if (isNative())
      void run(async () => {
        await invoke('stop_audio');
        await refreshAudioInfo();
      });
  }, [run, refreshAudioInfo]);

  const playQueueEntry = useCallback(
    (id: string) => {
      const current = snapshotRef.current;
      const entry = current.queue.find((item) => item.id === id);
      const track = current.tracks.find((item) => item.id === entry?.trackId);
      if (!entry || !track) {
        reportError('This queue item is no longer in the library.');
        return;
      }
      if (!track.path || track.missing) {
        reportError('This file is unavailable. Import its folder again to reconnect it.');
        return;
      }
      if (!isNative()) {
        reportError('Playback is available in the desktop app.');
        return;
      }
      const request = ++generation.current;
      const position = current.session.currentQueueId === id && !activeIdRef.current ? current.session.position : 0;
      requestedId.current = id;
      preloadKey.current = '';
      preloadedId.current = null;
      setError(null);
      setLoading();
      update((value) => ({ ...value, session: { ...value.session, currentQueueId: id, position } }));
      void run(async () => {
        if (request !== generation.current) return;
        await invoke('play_file', { path: track.path, queueId: id });
        if (request !== generation.current) return;
        activeIdRef.current = id;
        setActiveQueueId(id);
        requestedId.current = null;
        if (position > 0 && (!track.duration || position < track.duration)) await invoke('seek_audio', { position });
        setTransition((value) => value + 1);
        await refreshAudioInfo();
      });
    },
    [reportError, run, setLoading, update, refreshAudioInfo],
  );

  const playById = useCallback(
    (id: string) => {
      const current = snapshotRef.current;
      if (!current.tracks.some((track) => track.id === id)) {
        reportError('Track not found in the library.');
        return;
      }
      const existing = current.queue.find((entry) => entry.trackId === id);
      if (existing) {
        playQueueEntry(existing.id);
        return;
      }
      const queue = current.tracks.filter((track) => !track.missing).map((track) => queueEntry(track.id));
      const entry = queue.find((item) => item.trackId === id);
      if (!entry) {
        reportError('This file is missing. Import its folder again to reconnect it.');
        return;
      }
      update((value) => ({ ...value, queue, session: { ...value.session, currentQueueId: null, position: 0 } }));
      playQueueEntry(entry.id);
    },
    [playQueueEntry, reportError, update],
  );

  useEffect(() => {
    if (!ready || !isNative()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const consume = () => {
      void run(async () => {
        if (!active) return;
        const opened = await invoke<Track[]>('take_open_files');
        if (!active || !opened.length) return;
        update((current) => ({ ...current, tracks: mergeTracks(current.tracks, opened) }));
        const first = snapshotRef.current.tracks.find((track) => track.path === opened[0].path || track.id === opened[0].id);
        if (first) playById(first.id);
      });
    };
    void listen('open_files_pending', consume)
      .then((stop) => {
        if (active) {
          unlisten = stop;
          consume();
        } else stop();
      })
      .catch(reportError);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [ready, playById, reportError, run, update]);

  const playTrack = useCallback(
    (index: number) => {
      const track = snapshotRef.current.tracks[index];
      if (track) playById(track.id);
    },
    [playById],
  );

  const handleNext = useCallback(() => {
    const next = nextQueueEntry(snapshotRef.current);
    if (next) playQueueEntry(next.id);
    else stop();
  }, [playQueueEntry, stop]);
  const handlePrev = useCallback(
    (currentTime: number) => {
      if (currentTime > 3 && activeIdRef.current) {
        void run(async () => {
          await invoke('seek_audio', { position: 0 });
        });
        return;
      }
      const current = snapshotRef.current;
      const index = current.queue.findIndex((entry) => entry.id === current.session.currentQueueId);
      const previous = current.queue[Math.max(0, index - 1)];
      if (previous) playQueueEntry(previous.id);
    },
    [playQueueEntry, run],
  );

  useEffect(() => {
    registerResumeHandler(() => {
      const current = snapshotRef.current;
      const selected = current.session.currentQueueId ?? current.queue[0]?.id;
      if (selected) playQueueEntry(selected);
      else if (current.tracks[0]) playById(current.tracks[0].id);
      else reportError('Import music to start listening.');
    });
    return () => registerResumeHandler(null);
  }, [registerResumeHandler, playQueueEntry, playById, reportError]);

  // Replace only the pending native entry; the audible item is never restarted by a queue edit.
  useEffect(() => {
    if (!ready || !activeQueueId || !isNative() || requestedId.current) return;
    const next = nextQueueEntry(snapshot);
    const track = snapshot.tracks.find((item) => item.id === next?.trackId);
    const key = `${activeQueueId}:${next?.id ?? ''}:${track?.path ?? ''}:${transition}`;
    if (preloadKey.current === key) return;
    preloadKey.current = key;
    preloadedId.current = null;
    const request = generation.current;
    void run(async () => {
      if (preloadKey.current !== key || request !== generation.current) return;
      await invoke('clear_pending');
      if (next && track?.path && !track.missing && preloadKey.current === key && request === generation.current) {
        preloadedId.current = next.id;
        try {
          await invoke('queue_next_file', { path: track.path, queueId: next.id });
        } catch (reason) {
          preloadedId.current = null;
          throw reason;
        }
      }
    });
  }, [snapshot, ready, activeQueueId, transition, run]);

  const enqueueTrack = useCallback(
    (id: string, next = false) => {
      update((current) => {
        if (!current.tracks.some((track) => track.id === id)) return current;
        const queue = [...current.queue];
        const index = next ? queue.findIndex((entry) => entry.id === current.session.currentQueueId) + 1 : queue.length;
        queue.splice(index, 0, queueEntry(id));
        return { ...current, queue };
      });
    },
    [update],
  );
  const removeQueueEntry = useCallback(
    (id: string) => {
      const current = snapshotRef.current;
      const wasActive = current.session.currentQueueId === id;
      const playing = activeIdRef.current === id;
      const next = removeQueueEntrySnapshot(current, id);
      update(() => next);
      if (wasActive && playing) {
        if (next.session.currentQueueId) playQueueEntry(next.session.currentQueueId);
        else stop();
      }
    },
    [playQueueEntry, stop, update],
  );
  const moveQueueEntry = useCallback(
    (id: string, direction: -1 | 1) => {
      update((current) => {
        const index = current.queue.findIndex((entry) => entry.id === id);
        if (index < 0 || index + direction < 0 || index + direction >= current.queue.length) return current;
        const queue = [...current.queue];
        [queue[index], queue[index + direction]] = [queue[index + direction], queue[index]];
        return { ...current, queue };
      });
    },
    [update],
  );
  const clearQueue = useCallback(() => {
    stop();
    update((current) => ({ ...current, queue: [], session: { ...current.session, currentQueueId: null, position: 0 } }));
  }, [stop, update]);

  const removeTrack = useCallback(
    async (id: string) => {
      busy.current += 1;
      try {
        if (isNative()) await invoke('library_remove_track', { trackId: id });
        const removedEntries = snapshotRef.current.queue.filter((entry) => entry.trackId === id);
        for (const entry of removedEntries) removeQueueEntry(entry.id);
        update((current) => ({
          ...current,
          tracks: current.tracks.filter((track) => track.id !== id),
          playlists: current.playlists.map((playlist) => ({
            ...playlist,
            trackIds: playlist.trackIds.filter((trackId) => trackId !== id),
          })),
        }));
      } catch (reason) {
        reportError(reason);
      } finally {
        busy.current -= 1;
        void save();
      }
    },
    [removeQueueEntry, reportError, update, save],
  );

  const addTracks = useCallback(
    (tracks: Track[]) => {
      try {
        update((current) => ({ ...current, tracks: mergeTracks(current.tracks, tracks) }));
      } catch (reason) {
        reportError(reason);
      }
    },
    [update, reportError],
  );
  const repairTrack = useCallback(
    async (id: string) => {
      if (!isNative()) throw new Error('Locate files in the desktop app.');
      await save();
      busy.current += 1;
      try {
        const result = await invoke<unknown>('library_locate_track', { trackId: id });
        if (!result) return;
        if (snapshotRef.current.queue.some((entry) => entry.trackId === id && entry.id === activeIdRef.current)) stop();
        addTracks([parseTrack(result)]);
      } finally {
        busy.current -= 1;
        void save();
      }
    },
    [addTracks, save, stop],
  );
  const importPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      if (!isNative()) {
        reportError('Open the desktop app to import files and folders.');
        return;
      }
      busy.current += 1;
      try {
        const tracks = await invoke<unknown>('library_import_paths', { paths });
        if (!Array.isArray(tracks)) throw new Error('The library returned an invalid import response.');
        addTracks(tracks.map(parseTrack));
        setError(null);
      } catch (reason) {
        reportError(reason);
      } finally {
        busy.current -= 1;
        void save();
      }
    },
    [addTracks, reportError, save],
  );
  const processFiles = useCallback(
    async (_files: FileList | File[]) => {
      reportError('Use Import files or Import folder in the desktop app so the original file paths can be preserved.');
    },
    [reportError],
  );

  const shuffleQueue = useCallback(() => {
    update((current) => {
      const split = current.queue.findIndex((entry) => entry.id === current.session.currentQueueId) + 1;
      const upcoming = current.queue.slice(split);
      for (let index = upcoming.length - 1; index > 0; index -= 1) {
        const other = Math.floor(Math.random() * (index + 1));
        [upcoming[index], upcoming[other]] = [upcoming[other], upcoming[index]];
      }
      return { ...current, queue: [...current.queue.slice(0, split), ...upcoming] };
    });
  }, [update]);
  const cyclePlaybackMode = useCallback(() => {
    const modes = Object.values(PlaybackMode);
    const next = modes[(modes.indexOf(snapshotRef.current.session.playbackMode) + 1) % modes.length];
    update((current) => ({ ...current, session: { ...current.session, playbackMode: next } }));
    if (next === PlaybackMode.SHUFFLE) shuffleQueue();
  }, [update, shuffleQueue]);
  const toggleLike = useCallback(
    (id: string) =>
      update((current) => ({
        ...current,
        tracks: current.tracks.map((track) => (track.id === id ? { ...track, isLiked: !track.isLiked } : track)),
      })),
    [update],
  );

  const createPlaylist = useCallback(
    (name: string, trackIds: string[] = [], smartRule?: SmartRule) => {
      if (!name.trim() || name.length > 256) throw new Error('Choose a playlist name between 1 and 256 characters.');
      const id = crypto.randomUUID();
      const existing = new Set(snapshotRef.current.tracks.map((track) => track.id));
      const playlist: Playlist = {
        id,
        name: name.trim(),
        trackIds: trackIds.filter((trackId) => existing.has(trackId)),
        smartRule: parseSmartRule(smartRule),
        createdAt: Date.now(),
      };
      update((current) => ({ ...current, playlists: [...current.playlists, playlist] }));
      return id;
    },
    [update],
  );
  const updatePlaylist = useCallback(
    (id: string, changes: Partial<Pick<Playlist, 'name' | 'trackIds' | 'smartRule'>>) => {
      if (changes.name !== undefined && (!changes.name.trim() || changes.name.length > 256)) throw new Error('Invalid playlist name.');
      const existing = new Set(snapshotRef.current.tracks.map((track) => track.id));
      update((current) => ({
        ...current,
        playlists: current.playlists.map((playlist) =>
          playlist.id === id
            ? {
                ...playlist,
                ...changes,
                name: changes.name?.trim() ?? playlist.name,
                trackIds: changes.trackIds?.filter((trackId) => existing.has(trackId)) ?? playlist.trackIds,
                smartRule: 'smartRule' in changes ? parseSmartRule(changes.smartRule) : playlist.smartRule,
              }
            : playlist,
        ),
      }));
    },
    [update],
  );
  const deletePlaylist = useCallback(
    (id: string) => update((current) => ({ ...current, playlists: current.playlists.filter((playlist) => playlist.id !== id) })),
    [update],
  );
  const getPlaylistTracks = useCallback((id: string) => {
    const current = snapshotRef.current;
    const playlist = current.playlists.find((item) => item.id === id);
    return playlist ? resolvePlaylistTracks(playlist, current.tracks) : [];
  }, []);
  const playPlaylist = useCallback(
    (id: string) => {
      const tracks = getPlaylistTracks(id).filter((track) => !track.missing);
      if (!tracks.length) {
        reportError('This playlist has no available tracks.');
        return;
      }
      const queue = tracks.map((track) => queueEntry(track.id));
      update((current) => ({ ...current, queue, session: { ...current.session, currentQueueId: null, position: 0 } }));
      playQueueEntry(queue[0].id);
    },
    [getPlaylistTracks, playQueueEntry, reportError, update],
  );

  const exportLibrary = useCallback(async () => {
    await save();
    return isNative() ? invoke<string>('library_export') : JSON.stringify(parseLibrarySnapshot(snapshotRef.current), null, 2);
  }, [save]);
  const restoreLibrary = useCallback(
    async (backup: string) => {
      if (backup.length > 64 * 1024 * 1024) throw new Error('This backup exceeds the 64 MB import limit.');
      const validated = parseLibrarySnapshot(JSON.parse(backup));
      busy.current += 1;
      try {
        await writes.current;
        const restored = isNative()
          ? parseLibrarySnapshot(await invoke('library_restore', { backup: JSON.stringify(validated) }))
          : validated;
        stop();
        update(() => restored);
        readyRef.current = true;
        setReady(true);
        setError(null);
      } finally {
        busy.current -= 1;
        void save();
      }
    },
    [save, stop, update],
  );
  const refreshLibrary = useCallback(async () => {
    busy.current += 1;
    try {
      const result = isNative() ? parseLibrarySnapshot(await invoke('library_reconcile')) : loadBrowserLibrary();
      update((current) => (readyRef.current ? { ...current, tracks: result.tracks, watchedFolders: result.watchedFolders } : result));
      readyRef.current = true;
      setReady(true);
      setError(null);
    } catch (reason) {
      reportError(reason);
    } finally {
      busy.current -= 1;
      void save();
    }
  }, [reportError, save, update]);
  const cancelScan = useCallback(async () => {
    if (isNative()) await invoke('library_cancel_scan');
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    let active = true;
    const cleanups: (() => void)[] = [];
    const attach = async <T,>(name: string, handler: (payload: T) => void) => {
      try {
        const unlisten = await listen<T>(name, (event) => {
          if (active) handler(event.payload);
        });
        if (active) cleanups.push(unlisten);
        else unlisten();
      } catch (reason) {
        if (active) reportError(reason);
      }
    };
    const started = (event: { queue_id: string }) => {
      const id = event.queue_id;
      if (!snapshotRef.current.queue.some((entry) => entry.id === id)) return;
      if (requestedId.current && requestedId.current !== id) return;
      if (!requestedId.current && id !== activeIdRef.current && id !== preloadedId.current) return;
      activeIdRef.current = id;
      requestedId.current = null;
      preloadedId.current = null;
      preloadKey.current = '';
      setActiveQueueId(id);
      setTransition((value) => value + 1);
      update((current) => ({ ...current, session: { ...current.session, currentQueueId: id, position: 0 } }));
    };
    void attach<{ queue_id: string }>('track_started', started);
    void attach<{ queue_id: string; next_queue_id?: string | null }>('track_ended', (event) => {
      if (event.queue_id !== activeIdRef.current || requestedId.current) return;
      if (event.next_queue_id) return; // The engine will emit track_started for its committed transition.
      activeIdRef.current = null;
      setActiveQueueId(null);
      const next = nextQueueEntry(snapshotRef.current);
      if (next) playQueueEntry(next.id);
    });
    let lastTime = performance.now();
    let listened = 0;
    let totalListened = 0;
    let statsId: string | null = null;
    let played = false;
    void attach<{ queue_id: string | null; current_time: number; is_playing: boolean }>('playback_update', (event) => {
      const now = performance.now();
      const elapsed = Math.min(2, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      if (!event.queue_id || event.queue_id !== activeIdRef.current || requestedId.current) return;
      const entry = snapshotRef.current.queue.find((item) => item.id === event.queue_id);
      if (!entry) return;
      if (statsId !== entry.id) {
        statsId = entry.id;
        listened = 0;
        totalListened = 0;
        played = false;
      }
      if (event.is_playing) {
        listened += elapsed;
        totalListened += elapsed;
        recordListeningTime(entry.trackId, elapsed);
        if (!played && totalListened >= 30) {
          played = true;
          recordPlay(entry.trackId);
          update((current) => ({
            ...current,
            tracks: current.tracks.map((track) =>
              track.id === entry.trackId ? { ...track, playCount: (track.playCount ?? 0) + 1 } : track,
            ),
          }));
        }
      }
      const position = Number.isFinite(event.current_time) ? Math.max(0, event.current_time) : 0;
      if (Math.abs(position - snapshotRef.current.session.position) >= 5 || !event.is_playing) {
        const seconds = listened;
        listened = 0;
        update((current) => ({
          ...current,
          tracks: seconds
            ? current.tracks.map((track) =>
                track.id === entry.trackId ? { ...track, listeningSeconds: (track.listeningSeconds ?? 0) + seconds } : track,
              )
            : current.tracks,
          session: { ...current.session, position },
        }));
      }
    });
    void attach<ScanProgress>('library_scan_progress', setScanProgress);
    void attach<string>('library_error', (message) => setError(message));
    void attach<unknown>('library_changed', (payload) => {
      try {
        const changed = parseLibrarySnapshot(payload);
        if (readyRef.current)
          update((current) => ({
            ...current,
            tracks: mergeTracks(current.tracks, changed.tracks),
            watchedFolders: changed.watchedFolders,
          }));
      } catch (reason) {
        reportError(reason);
      }
    });
    void attach<unknown>('media_next', handleNext);
    void attach<unknown>('media_prev', () => handlePrev(snapshotRef.current.session.position));
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [handleNext, handlePrev, playQueueEntry, reportError, update]);

  const dispatch = useCallback(
    (action: LibraryAction) => {
      switch (action.type) {
        case 'ADD_TRACKS':
          addTracks(action.payload);
          break;
        case 'REMOVE_TRACK':
          void removeTrack(action.payload);
          break;
        case 'SET_CURRENT_TRACK':
          playTrack(action.payload);
          break;
        case 'PLAY_NEXT':
          enqueueTrack(action.payload, true);
          break;
        case 'ADD_TO_QUEUE':
          enqueueTrack(action.payload);
          break;
        case 'SHUFFLE':
          shuffleQueue();
          break;
        case 'CLEAR':
          clearQueue();
          break;
        case 'SET_PLAYBACK_MODE':
          update((current) => ({ ...current, session: { ...current.session, playbackMode: action.payload } }));
          break;
        case 'TOGGLE_LIKE':
          toggleLike(action.payload);
          break;
        case 'SET_STATE':
          addTracks(action.payload.tracks);
          break;
      }
    },
    [addTracks, clearQueue, enqueueTrack, playTrack, removeTrack, shuffleQueue, toggleLike, update],
  );

  const tracks = useMemo(
    () =>
      snapshot.tracks.map((track) => ({
        ...track,
        image: track.artworkPath && isNative() ? convertFileSrc(track.artworkPath) : track.image,
      })),
    [snapshot.tracks],
  );
  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const queueTracks = useMemo(
    () =>
      snapshot.queue.flatMap((entry) => {
        const track = byId.get(entry.trackId);
        return track ? [{ ...track, queueId: entry.id, trackId: track.id }] : [];
      }),
    [snapshot.queue, byId],
  );
  const selected = snapshot.queue.find((entry) => entry.id === snapshot.session.currentQueueId);
  const currentTrack = selected ? byId.get(selected.trackId) : undefined;
  const duplicateGroups = useMemo(() => findDuplicateTracks(tracks), [tracks]);
  const suggestions = useMemo(() => suggestQueue(tracks, snapshot.queue, currentTrack), [tracks, snapshot.queue, currentTrack]);

  return (
    <LibraryContext.Provider
      value={{
        state: {
          tracks,
          currentTrackIndex: tracks.findIndex((track) => track.id === currentTrack?.id),
          playbackMode: snapshot.session.playbackMode,
        },
        snapshot,
        ready,
        error,
        clearError,
        dispatch,
        processFiles,
        importPaths,
        addTracks,
        handleNext,
        handlePrev,
        playTrack,
        playById,
        playQueueEntry,
        currentTrack,
        currentQueueId: snapshot.session.currentQueueId,
        queueEntries: snapshot.queue,
        queueTracks,
        enqueueTrack,
        removeQueueEntry,
        moveQueueEntry,
        clearQueue,
        removeTrack,
        repairTrack,
        cyclePlaybackMode,
        toggleLike,
        shuffleQueue,
        playlists: snapshot.playlists,
        createPlaylist,
        updatePlaylist,
        deletePlaylist,
        playPlaylist,
        getPlaylistTracks,
        duplicateGroups,
        suggestions,
        exportLibrary,
        restoreLibrary,
        refreshLibrary,
        scanProgress,
        cancelScan,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
};

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary must be used within a LibraryProvider');
  return context;
}
