import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Track, LibraryAction, PlaybackMode } from '../types';
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
import { invoke } from '@tauri-apps/api/core';

interface LibraryState {
  tracks: Track[];
  currentTrackIndex: number;
  playbackMode: PlaybackMode;
}

interface LibraryContextType {
  state: LibraryState;
  dispatch: React.Dispatch<LibraryAction>;
  processFiles: (files: FileList | File[]) => Promise<void>;
  handleNext: () => void;
  handlePrev: (currentTime: number) => void;
  playTrack: (index: number) => void;
  currentTrack: Track | undefined;
  cyclePlaybackMode: () => void;
  toggleLike: (id: string) => void;
  shuffleQueue: () => void;
}

const initialState: LibraryState = {
  tracks: [],
  currentTrackIndex: -1,
  playbackMode: PlaybackMode.SEQUENCE,
};

function libraryReducer(state: LibraryState, action: LibraryAction): LibraryState {
  switch (action.type) {
    case 'ADD_TRACKS':
      return { ...state, tracks: [...state.tracks, ...action.payload] };
    case 'REMOVE_TRACK': {
      const idx = state.tracks.findIndex(t => t.id === action.payload);
      if (idx === -1) return state;
      let nextIdx = state.currentTrackIndex;
      if (idx < state.currentTrackIndex) {
        nextIdx--;
      } else if (idx === state.currentTrackIndex) {
        if (state.tracks.length <= 1) nextIdx = -1;
        else nextIdx = idx >= state.tracks.length - 1 ? idx - 1 : idx;
      }
      return {
        ...state,
        tracks: state.tracks.filter(t => t.id !== action.payload),
        currentTrackIndex: nextIdx
      };
    }
    case 'SET_CURRENT_TRACK':
      return { ...state, currentTrackIndex: action.payload };
    case 'PLAY_NEXT': {
      const idx = state.tracks.findIndex(t => t.id === action.payload);
      if (idx === -1 || idx === state.currentTrackIndex || idx === state.currentTrackIndex + 1) return state;
      const nextTracks = [...state.tracks];
      const [track] = nextTracks.splice(idx, 1);
      let targetIdx = state.currentTrackIndex + 1;
      if (idx < state.currentTrackIndex) {
        nextTracks.splice(targetIdx - 1, 0, track);
        return { ...state, tracks: nextTracks, currentTrackIndex: state.currentTrackIndex - 1 };
      }
      nextTracks.splice(targetIdx, 0, track);
      return { ...state, tracks: nextTracks };
    }
    case 'ADD_TO_QUEUE': {
      const idx = state.tracks.findIndex(t => t.id === action.payload);
      if (idx === -1 || idx === state.tracks.length - 1) return state;
      const nextTracks = [...state.tracks];
      const [track] = nextTracks.splice(idx, 1);
      let nextIdx = state.currentTrackIndex;
      if (idx < state.currentTrackIndex) nextIdx--;
      nextTracks.push(track);
      return { ...state, tracks: nextTracks, currentTrackIndex: nextIdx };
    }
    case 'SHUFFLE': {
      // Fisher-Yates on upcoming
      if (state.tracks.length <= state.currentTrackIndex + 1) return state;
      const upcoming = state.tracks.slice(state.currentTrackIndex + 1);
      for (let i = upcoming.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
      }
      return {
        ...state,
        tracks: [
          ...state.tracks.slice(0, state.currentTrackIndex + 1),
          ...upcoming
        ]
      };
    }
    case 'CLEAR':
      return { ...state, tracks: [], currentTrackIndex: -1 };
    case 'SET_PLAYBACK_MODE':
      return { ...state, playbackMode: action.payload };
    case 'TOGGLE_LIKE': {
      return {
        ...state,
        tracks: state.tracks.map(t => t.id === action.payload ? { ...t, isLiked: !t.isLiked } : t)
      };
    }
    case 'SET_STATE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

const extractMetadata = async (file: File): Promise<Partial<Track>> => {
  return new Promise((resolve) => {
    const meta: Partial<Track> = {};
    if (!jsmediatags) { resolve(meta); return; }
    jsmediatags.read(file, {
      onSuccess: (tag: any) => {
        if (tag.tags.title) meta.name = tag.tags.title;
        if (tag.tags.artist) meta.artist = tag.tags.artist;
        if (tag.tags.album) meta.album = tag.tags.album;
        if (tag.tags.picture) {
          const { data, format } = tag.tags.picture;
          const blob = new Blob([new Uint8Array(data)], { type: format });
          meta.image = URL.createObjectURL(blob);
        }
        resolve(meta);
      },
      onError: () => resolve(meta)
    });
  });
};

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export const LibraryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(libraryReducer, initialState, (init) => {
    try {
      const savedTracks = localStorage.getItem('rawh_tracks');
      const savedIdx = localStorage.getItem('rawh_current_track_idx');
      const savedMode = localStorage.getItem('rawh_playback_mode');
      return {
        ...init,
        tracks: savedTracks ? JSON.parse(savedTracks) : [],
        currentTrackIndex: savedIdx ? parseInt(savedIdx, 10) : -1,
        playbackMode: savedMode as PlaybackMode || PlaybackMode.SEQUENCE
      };
    } catch {
      return init;
    }
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      const serializable = state.tracks.map((t: Track) => {
        const { file, ...rest } = t;
        return rest;
      });
      localStorage.setItem('rawh_tracks', JSON.stringify(serializable));
    } catch (e) {
      console.error("Failed to save tracks:", e);
    }
  }, [state.tracks]);

  useEffect(() => {
    localStorage.setItem('rawh_current_track_idx', String(state.currentTrackIndex));
  }, [state.currentTrackIndex]);

  useEffect(() => {
    localStorage.setItem('rawh_playback_mode', state.playbackMode);
  }, [state.playbackMode]);

  // Revoke Blob URLs
  const prevTracksRef = useRef<Track[]>([]);
  useEffect(() => {
    const removedTracks = prevTracksRef.current.filter(
      (pt: Track) => !state.tracks.some((t: Track) => t.id === pt.id)
    );
    for (const track of removedTracks) {
      if (track.image && track.image.startsWith('blob:')) {
        URL.revokeObjectURL(track.image);
      }
    }
    prevTracksRef.current = state.tracks;
  }, [state.tracks]);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const newTracks: Track[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!['mp3','flac','wav','ogg','aac','m4a','aiff','dsf','dff'].includes(ext || '')) continue;
      
      const filePath = (file as any).path || file.webkitRelativePath || '';

      const baseMeta = {
        id: crypto.randomUUID(),
        file,
        path: filePath,
        name: file.name.replace(/\.[^/.]+$/, ""),
        artist: "Unknown Artist",
        format: ext?.toUpperCase() || "RAW",
        dateAdded: Date.now(),
      };

      const deepMeta = await extractMetadata(file);
      
      const tempUrl = URL.createObjectURL(file);
      const tempAudio = new Audio(tempUrl);
      const duration = await new Promise<number>((resolve) => {
        tempAudio.onloadedmetadata = () => resolve(tempAudio.duration);
        tempAudio.onerror = () => resolve(0);
      });
      URL.revokeObjectURL(tempUrl);

      const bitrate = duration > 0 ? Math.round((file.size * 8) / duration / 1000) : 0;

      newTracks.push({ ...baseMeta, ...deepMeta, duration, bitrate } as Track);
    }

    if (newTracks.length > 0) {
      dispatch({ type: 'ADD_TRACKS', payload: newTracks });
      if (stateRef.current.tracks.length === 0) {
        dispatch({ type: 'SET_CURRENT_TRACK', payload: 0 });
        // Setting playing state will happen in App by calling playTrack if needed, or by watching currentTrackIndex
      }
    }
  }, []);

  const currentTrack = state.tracks[state.currentTrackIndex];

  // Handle Playback File Selection via Effect
  useEffect(() => {
    if (currentTrack?.path) {
      invoke('play_file', { path: currentTrack.path }).catch(console.error);
    }
  }, [state.currentTrackIndex]); // Only trigger when index changes

  const handleNext = useCallback(() => {
    const { tracks, currentTrackIndex, playbackMode } = stateRef.current;
    if (tracks.length === 0) return;
    
    if (playbackMode === PlaybackMode.LOOP) {
      // Replay current track
      if (currentTrack?.path) {
        invoke('play_file', { path: currentTrack.path }).catch(console.error);
      }
      return;
    }

    let nextIdx = currentTrackIndex + 1;
    if (playbackMode === PlaybackMode.SHUFFLE) {
      nextIdx = Math.floor(Math.random() * tracks.length);
    }
    if (nextIdx >= tracks.length) nextIdx = 0;
    
    dispatch({ type: 'SET_CURRENT_TRACK', payload: nextIdx });
  }, [currentTrack]);

  const handlePrev = useCallback((currentTime: number) => {
    if (currentTime > 3) {
      invoke('seek_audio', { position: 0.0 }).catch(console.error);
      return;
    }
    const { tracks, currentTrackIndex } = stateRef.current;
    let prev = currentTrackIndex - 1;
    if (prev < 0) prev = tracks.length - 1;
    dispatch({ type: 'SET_CURRENT_TRACK', payload: prev });
  }, []);

  const playTrack = useCallback((index: number) => {
    dispatch({ type: 'SET_CURRENT_TRACK', payload: index });
  }, []);

  const cyclePlaybackMode = useCallback(() => {
    const { playbackMode } = stateRef.current;
    const modes = [PlaybackMode.SEQUENCE, PlaybackMode.LOOP, PlaybackMode.SHUFFLE];
    const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length];
    dispatch({ type: 'SET_PLAYBACK_MODE', payload: nextMode });
  }, []);

  const toggleLike = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_LIKE', payload: id });
  }, []);

  const shuffleQueue = useCallback(() => {
    dispatch({ type: 'SHUFFLE' });
  }, []);

  return (
    <LibraryContext.Provider value={{
      state, dispatch, processFiles, handleNext, handlePrev, playTrack, currentTrack, cyclePlaybackMode, toggleLike, shuffleQueue
    }}>
      {children}
    </LibraryContext.Provider>
  );
};

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (context === undefined) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
}
