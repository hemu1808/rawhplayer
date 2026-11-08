import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LibraryAction, LibrarySnapshot, PlaybackMode, Playlist, QueueEntry, SmartRule, Track } from '../types';
import {
  emptyLibrary,
  findDuplicateTracks,
  LIBRARY_KEY,
  LIBRARY_LIMITS,
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
import { commands as native, events, type CatalogQuery } from '../services/generated/native';
import { catalogQuery, NativeLibrarySession, nativeSnapshot, preserveUserMetadata } from '../services/nativeLibrary';

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
  totalTracks: number;
  catalogRevision: number;
  queryCatalog: (query: Partial<CatalogQuery>) => Promise<{ tracks: Track[]; total: number }>;
  getTracks: (ids: string[]) => Promise<Track[]>;
  state: { tracks: Track[]; currentTrackIndex: number; playbackMode: PlaybackMode };
  snapshot: LibrarySnapshot;
  ready: boolean;
  error: string | null;
  clearError: () => void;
  dispatch: React.Dispatch<LibraryAction>;
  processFiles: (files: FileList | File[]) => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  pickMusic: (folder: boolean) => Promise<void>;
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
  const nativeSession = useRef(new NativeLibrarySession());
  const [totalTracks, setTotalTracks] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);
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
  const durableSnapshot = useRef<LibrarySnapshot | null>(null);
  const maximumSaveDelay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const { reportError: playerError, setLoading, registerResumeHandler, refreshAudioInfo } = usePlayer();
  const reportError = useCallback((reason: unknown) => {
    if (mounted.current) setError(errorMessage(reason));
  }, []);
  const clearError = useCallback(() => setError(null), []);
  const update = useCallback((change: (current: LibrarySnapshot) => LibrarySnapshot) => {
    let next = change(snapshotRef.current);
    if (next === snapshotRef.current) return;
    if (isNative()) {
      nativeSession.current.observe(snapshotRef.current, next);
      if (next.tracks.length > 4096) {
        const pinned = nativeSession.current.dirtyTrackIds;
        const selected = next.queue.find((entry) => entry.id === next.session.currentQueueId);
        if (selected) pinned.add(selected.trackId);
        const recent = new Set(next.tracks.slice(-4096).map((track) => track.id));
        next = { ...next, tracks: next.tracks.filter((track) => pinned.has(track.id) || recent.has(track.id)) };
      }
    }
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
    if (!readyRef.current || busy.current) return writes.current.then(() => false);
    const version = ++writeVersion.current;
    const result = writes.current
      .then(async () => {
        if (version !== writeVersion.current || !readyRef.current || busy.current) return false;
        if (isNative()) {
          await nativeSession.current.save(snapshotRef.current);
          setCatalogRevision((value) => Math.max(value, nativeSession.current.catalogRevision));
        } else localStorage.setItem(LIBRARY_KEY, JSON.stringify(parseLibrarySnapshot(snapshotRef.current)));
        return true;
      })
      .catch((reason) => {
        reportError(reason);
        return false;
      });
    writes.current = result.then(() => undefined);
    return result;
  }, [reportError]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const load = async () => {
      try {
        let header = isNative() ? await native.libraryBootstrap() : null;
        let loaded = header ? nativeSnapshot(header) : loadBrowserLibrary();
        if (header && !header.trackCount && (localStorage.getItem(LIBRARY_KEY) || localStorage.getItem('rawh_tracks'))) {
          try {
            const legacy = loadBrowserLibrary();
            await native.libraryMigrateLegacy(JSON.stringify(legacy));
            header = await native.libraryBootstrap();
            loaded = nativeSnapshot(header);
          } catch (reason) {
            if (active) reportError(`Your previous library was preserved but could not be migrated: ${errorMessage(reason)}`);
          }
        }
        if (!active) return;
        if (header) {
          nativeSession.current.adopt(header);
          setTotalTracks(header.trackCount);
          setCatalogRevision(header.catalogRevision);
        }
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
    const previous = durableSnapshot.current;
    durableSnapshot.current = snapshot;
    const persist = () => {
      if (maximumSaveDelay.current !== null) clearTimeout(maximumSaveDelay.current);
      maximumSaveDelay.current = null;
      void save();
    };
    // Durable edits do not wait for transport updates to become quiet.
    if (
      !previous ||
      previous.tracks !== snapshot.tracks ||
      previous.queue !== snapshot.queue ||
      previous.playlists !== snapshot.playlists ||
      previous.watchedFolders !== snapshot.watchedFolders ||
      previous.session.currentQueueId !== snapshot.session.currentQueueId ||
      previous.session.playbackMode !== snapshot.session.playbackMode
    ) {
      persist();
      return;
    }
    // Position checkpoints may coalesce, but continuous updates cannot starve them.
    if (maximumSaveDelay.current === null) maximumSaveDelay.current = setTimeout(persist, 2000);
    const timer = window.setTimeout(persist, 400);
    return () => clearTimeout(timer);
  }, [snapshot, ready, save]);

  useEffect(
    () => () => {
      if (maximumSaveDelay.current !== null) clearTimeout(maximumSaveDelay.current);
    },
    [],
  );

  useEffect(() => {
    if (!isNative()) return;
    let active = true;
    let closing = false;
    let removeListener: (() => void) | undefined;
    const windowHandle = getCurrentWindow();
    void windowHandle
      .onCloseRequested(async (event) => {
        if (closing) return;
        event.preventDefault();
        if (busy.current) {
          reportError('Wait for the library operation to finish before closing RawhPlayer.');
          return;
        }
        if (readyRef.current) {
          let stable = false;
          for (let attempt = 0; attempt < 4; attempt++) {
            const snapshotBeforeSave = snapshotRef.current;
            if (!(await save())) return;
            if (snapshotBeforeSave === snapshotRef.current) {
              stable = true;
              break;
            }
          }
          if (!stable) {
            reportError('New library changes are still being saved. Try closing again.');
            return;
          }
        }
        flushStats();
        closing = true;
        try {
          await windowHandle.destroy();
        } catch (reason) {
          closing = false;
          reportError(reason);
        }
      })
      .then((unlisten) => {
        if (active) removeListener = unlisten;
        else unlisten();
      })
      .catch(reportError);
    return () => {
      active = false;
      removeListener?.();
    };
  }, [reportError, save]);

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
      if (!entry || (!track && !isNative())) {
        reportError('This queue item is no longer in the library.');
        return;
      }
      if (track && (!track.path || track.missing)) {
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
        const playing = parseTrack(await native.playLibraryTrack(entry.trackId, id));
        update((value) => ({
          ...value,
          tracks: mergeTracks(value.tracks, [
            preserveUserMetadata(
              playing,
              value.tracks.find((track) => track.id === playing.id),
            ),
          ]),
        }));
        if (request !== generation.current) return;
        activeIdRef.current = id;
        setActiveQueueId(id);
        requestedId.current = null;
        if (position > 0 && (!playing.duration || position < playing.duration)) await native.seekAudio(position);
        setTransition((value) => value + 1);
        await refreshAudioInfo();
      });
    },
    [reportError, run, setLoading, update, refreshAudioInfo],
  );

  const playById = useCallback(
    (id: string) => {
      const current = snapshotRef.current;
      if (!isNative() && !current.tracks.some((track) => track.id === id)) {
        reportError('Track not found in the library.');
        return;
      }
      const existing = current.queue.find((entry) => entry.trackId === id);
      if (existing) {
        playQueueEntry(existing.id);
        return;
      }
      if (isNative()) {
        void (async () => {
          const ids = await native.libraryTrackIds(null);
          if (!ids.includes(id)) throw new Error('This track is missing. Locate its file before playing.');
          const queue = ids.map(queueEntry);
          update((value) => ({ ...value, queue, session: { ...value.session, currentQueueId: null, position: 0 } }));
          playQueueEntry(queue.find((entry) => entry.trackId === id)!.id);
        })().catch(reportError);
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
      if (next && !track?.missing && preloadKey.current === key && request === generation.current) {
        preloadedId.current = next.id;
        try {
          await native.queueLibraryTrack(next.trackId, next.id);
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
        if (!isNative() && !current.tracks.some((track) => track.id === id)) return current;
        if (current.queue.length >= LIBRARY_LIMITS.maxQueueEntries) {
          reportError(`The queue supports at most ${LIBRARY_LIMITS.maxQueueEntries} entries.`);
          return current;
        }
        const queue = [...current.queue];
        const index = next ? queue.findIndex((entry) => entry.id === current.session.currentQueueId) + 1 : queue.length;
        queue.splice(index, 0, queueEntry(id));
        return { ...current, queue };
      });
    },
    [update, reportError],
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
      if (isNative() && !(await save())) return;
      busy.current += 1;
      try {
        if (isNative()) {
          const header = await native.libraryRemoveCatalog(id);
          nativeSession.current.adopt(header, true);
          setTotalTracks(header.trackCount);
          setCatalogRevision(header.catalogRevision);
        }
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
        update((current) => {
          if (!isNative()) return { ...current, tracks: mergeTracks(current.tracks, tracks) };
          const byId = new Map(current.tracks.map((track) => [track.id, track]));
          const incoming = new Set(tracks.map((track) => track.id));
          const safe = tracks.map((track) => {
            const old = byId.get(track.id);
            return preserveUserMetadata(track, old);
          });
          return { ...current, tracks: [...current.tracks.filter((track) => !incoming.has(track.id)), ...safe] };
        });
      } catch (reason) {
        reportError(reason);
      }
    },
    [update, reportError],
  );
  const getTracks = useCallback(
    async (ids: string[]) => {
      if (!isNative()) return snapshotRef.current.tracks.filter((track) => ids.includes(track.id));
      const result: Track[] = [];
      for (let index = 0; index < ids.length; index += 500)
        result.push(...(await native.libraryTracks(ids.slice(index, index + 500))).map(parseTrack));
      addTracks(result);
      return result;
    },
    [addTracks],
  );
  const queryCatalog = useCallback(
    async (query: Partial<CatalogQuery>) => {
      if (!isNative()) return { tracks: snapshotRef.current.tracks, total: snapshotRef.current.tracks.length };
      const page = await native.libraryPage(catalogQuery(query));
      const tracks = page.tracks.map(parseTrack);
      addTracks(tracks);
      return { tracks, total: page.total };
    },
    [addTracks],
  );
  const repairTrack = useCallback(
    async (id: string) => {
      if (!isNative()) throw new Error('Locate files in the desktop app.');
      if (!(await save())) throw new Error('Save your pending changes before locating a file.');
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
      if (!(await save())) return;
      busy.current += 1;
      try {
        const header = await native.libraryImportCatalog(paths);
        nativeSession.current.adopt(header, true);
        addTracks(header.initialTracks.map(parseTrack));
        setTotalTracks(header.trackCount);
        setCatalogRevision(header.catalogRevision);
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
  const pickMusic = useCallback(
    async (folder: boolean) => {
      if (!isNative()) {
        reportError('Open the desktop app to import your music.');
        return;
      }
      if (!(await save())) return;
      busy.current += 1;
      try {
        const header = await native.pickMusicCatalog(folder);
        nativeSession.current.adopt(header, true);
        addTracks(header.initialTracks.map(parseTrack));
        setTotalTracks(header.trackCount);
        setCatalogRevision(header.catalogRevision);
      } catch (reason) {
        reportError(reason);
      } finally {
        busy.current -= 1;
        void save();
      }
    },
    [addTracks, reportError, save],
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
      if (snapshotRef.current.playlists.length >= LIBRARY_LIMITS.maxPlaylists)
        throw new Error(`The library supports at most ${LIBRARY_LIMITS.maxPlaylists} playlists.`);
      if (trackIds.length > LIBRARY_LIMITS.maxPlaylistTracks) throw new Error('The playlist exceeds the supported track limit.');
      const id = crypto.randomUUID();
      const existing = new Set(snapshotRef.current.tracks.map((track) => track.id));
      const playlist: Playlist = {
        id,
        name: name.trim(),
        trackIds: isNative() ? trackIds : trackIds.filter((trackId) => existing.has(trackId)),
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
      if (changes.trackIds && changes.trackIds.length > LIBRARY_LIMITS.maxPlaylistTracks)
        throw new Error('The playlist exceeds the supported track limit.');
      const existing = new Set(snapshotRef.current.tracks.map((track) => track.id));
      update((current) => ({
        ...current,
        playlists: current.playlists.map((playlist) =>
          playlist.id === id
            ? {
                ...playlist,
                ...changes,
                name: changes.name?.trim() ?? playlist.name,
                trackIds: changes.trackIds
                  ? isNative()
                    ? changes.trackIds
                    : changes.trackIds.filter((trackId) => existing.has(trackId))
                  : playlist.trackIds,
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
      if (isNative()) {
        void (async () => {
          if (!(await save())) return;
          const ids = await native.libraryTrackIds(id);
          if (!ids.length) throw new Error('This playlist has no available tracks.');
          const queue = ids.map(queueEntry);
          update((current) => ({ ...current, queue, session: { ...current.session, currentQueueId: null, position: 0 } }));
          playQueueEntry(queue[0].id);
        })().catch(reportError);
        return;
      }
      const tracks = getPlaylistTracks(id).filter((track) => !track.missing);
      if (!tracks.length) {
        reportError('This playlist has no available tracks.');
        return;
      }
      const queue = tracks.map((track) => queueEntry(track.id));
      update((current) => ({ ...current, queue, session: { ...current.session, currentQueueId: null, position: 0 } }));
      playQueueEntry(queue[0].id);
    },
    [getPlaylistTracks, playQueueEntry, reportError, update, save],
  );

  const exportLibrary = useCallback(async () => {
    if (!(await save())) throw new Error('Save your pending library changes before exporting.');
    return isNative() ? invoke<string>('library_export') : JSON.stringify(parseLibrarySnapshot(snapshotRef.current), null, 2);
  }, [save]);
  const restoreLibrary = useCallback(
    async (backup: string) => {
      if (new TextEncoder().encode(backup).byteLength > LIBRARY_LIMITS.maxBackupBytes)
        throw new Error('This backup exceeds the 64 MiB import limit.');
      const validated = parseLibrarySnapshot(JSON.parse(backup));
      busy.current += 1;
      try {
        await writes.current;
        let restored = validated;
        if (isNative()) {
          const header = await native.libraryRestoreCatalog(JSON.stringify(validated));
          restored = nativeSession.current.adopt(header);
          setTotalTracks(header.trackCount);
          setCatalogRevision(header.catalogRevision);
        }
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
    if (isNative() && !(await save())) return;
    busy.current += 1;
    try {
      const header = isNative() ? await native.libraryReconcileCatalog() : null;
      const result = header ? nativeSession.current.adopt(header, true) : loadBrowserLibrary();
      if (header) {
        setTotalTracks(header.trackCount);
        setCatalogRevision(header.catalogRevision);
      }
      update((current) => {
        if (!readyRef.current) return result;
        const dirty = nativeSession.current.dirtyTrackIds;
        const pending = new Map(current.tracks.filter((track) => dirty.has(track.id)).map((track) => [track.id, track]));
        const fresh = result.tracks.map((track) => preserveUserMetadata(track, pending.get(track.id)));
        const loaded = new Set(fresh.map((track) => track.id));
        return {
          ...current,
          tracks: [...fresh, ...[...pending.values()].filter((track) => !loaded.has(track.id))],
          watchedFolders: result.watchedFolders,
        };
      });
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
      const difference = Math.abs(position - snapshotRef.current.session.position);
      if (difference >= 5 || (!event.is_playing && (difference > 0 || listened > 0))) {
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
    void events.catalogChanged
      .listen(({ payload }) => {
        if (!active) return;
        setTotalTracks(payload.trackCount);
        nativeSession.current.catalogRevision = Math.max(nativeSession.current.catalogRevision, payload.revision);
        setCatalogRevision((value) => Math.max(value, payload.revision));
        // Refresh only visible/current cached metadata after a background catalog change.
        const selected = snapshotRef.current.queue.find((entry) => entry.id === snapshotRef.current.session.currentQueueId);
        if (selected) void getTracks([selected.trackId]).catch(reportError);
      })
      .then((unlisten) => {
        if (active) cleanups.push(unlisten);
        else unlisten();
      })
      .catch(reportError);
    void attach<unknown>('media_stop', stop);
    void attach<unknown>('media_next', handleNext);
    void attach<unknown>('media_prev', () => handlePrev(snapshotRef.current.session.position));
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [handleNext, handlePrev, playQueueEntry, reportError, update, getTracks, stop]);

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
  const suggestionSource = currentTrack?.id;
  const suggestionBpm = currentTrack?.analysis?.bpm;
  useEffect(() => {
    if (!isNative() || !ready || !suggestionSource) return;
    void queryCatalog({
      limit: 200,
      ...(suggestionBpm ? { minBpm: Math.max(20, suggestionBpm * 0.92), maxBpm: Math.min(400, suggestionBpm * 1.08) } : {}),
    }).catch(reportError);
  }, [ready, suggestionSource, suggestionBpm, queryCatalog, reportError]);
  const duplicateGroups = useMemo(() => findDuplicateTracks(tracks), [tracks]);
  const suggestions = useMemo(() => suggestQueue(tracks, snapshot.queue, currentTrack), [tracks, snapshot.queue, currentTrack]);

  return (
    <LibraryContext.Provider
      value={{
        totalTracks: isNative() ? totalTracks : tracks.length,
        catalogRevision,
        queryCatalog,
        getTracks,
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
        pickMusic,
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
