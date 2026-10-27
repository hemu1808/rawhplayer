import React, { createContext, useContext, useReducer, useEffect, ReactNode, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AudioState, PlayerAction } from '../types';

interface PlayerContextType {
  state: AudioState;
  dispatch: React.Dispatch<PlayerAction>;
  seek: (position: number) => void;
  togglePlayPause: () => void;
}

const initialState: AudioState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1.0,
  isMuted: false,
  playbackRate: 1.0,
  isPuristMode: true,
  sampleRate: 44100,
  bufferSize: 2048,
  processingPrecision: '32-bit float',
};

function playerReducer(state: AudioState, action: PlayerAction): AudioState {
  switch (action.type) {
    case 'PLAY':
      return { ...state, isPlaying: true };
    case 'PAUSE':
      return { ...state, isPlaying: false };
    case 'SEEK':
      return { ...state, currentTime: action.payload };
    case 'SET_VOLUME':
      return { ...state, volume: action.payload, isMuted: action.payload === 0 };
    case 'TOGGLE_MUTE':
      return { ...state, isMuted: !state.isMuted };
    case 'SET_PLAYBACK_RATE':
      return { ...state, playbackRate: action.payload };
    case 'SET_PURIST_MODE':
      return { ...state, isPuristMode: action.payload };
    case 'SET_BUFFER_SIZE':
      return { ...state, bufferSize: action.payload };
    case 'SET_PRECISION':
      return { ...state, processingPrecision: action.payload };
    case 'UPDATE_PLAYBACK':
      return { 
        ...state, 
        currentTime: action.payload.currentTime, 
        duration: action.payload.duration, 
        isPlaying: action.payload.isPlaying 
      };
    case 'SET_STATE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(playerReducer, initialState, (init) => {
    let volume = 1.0;
    let isMuted = false;
    let isPuristMode = true;
    let bufferSize = 2048;
    let processingPrecision: '16-bit' | '32-bit float' = '32-bit float';
    try {
      const savedVol = localStorage.getItem('rawh_volume');
      if (savedVol) volume = parseFloat(savedVol);
      const savedMuted = localStorage.getItem('rawh_muted');
      if (savedMuted) isMuted = savedMuted === 'true';
      const savedPurist = localStorage.getItem('rawh_purist_mode');
      if (savedPurist) isPuristMode = savedPurist === 'true';
      const savedBufSize = localStorage.getItem('rawh_buffer_size');
      if (savedBufSize) bufferSize = parseInt(savedBufSize, 10);
      const savedPrecision = localStorage.getItem('rawh_precision');
      if (savedPrecision === '16-bit' || savedPrecision === '32-bit float') {
        processingPrecision = savedPrecision;
      }
    } catch {}
    return { ...init, volume, isMuted, isPuristMode, bufferSize, processingPrecision };
  });

  // State Persistence
  useEffect(() => {
    localStorage.setItem('rawh_volume', String(state.volume));
    localStorage.setItem('rawh_muted', String(state.isMuted));
    localStorage.setItem('rawh_purist_mode', String(state.isPuristMode));
    localStorage.setItem('rawh_buffer_size', String(state.bufferSize));
    localStorage.setItem('rawh_precision', state.processingPrecision);
  }, [state.volume, state.isMuted, state.isPuristMode, state.bufferSize, state.processingPrecision]);

  // Volume Sync
  useEffect(() => {
    invoke('set_volume', { volume: state.isMuted ? 0.0 : state.volume }).catch(console.error);
  }, [state.volume, state.isMuted]);

  // Tauri Event Listeners
  useEffect(() => {
    const unlistenPlayback = listen<{ current_time: number, duration: number, is_playing: boolean }>('playback_update', (event) => {
      dispatch({
        type: 'UPDATE_PLAYBACK',
        payload: {
          currentTime: event.payload.current_time,
          duration: event.payload.duration,
          isPlaying: event.payload.is_playing
        }
      });
    });
    return () => {
      unlistenPlayback.then(f => f());
    };
  }, []);

  const seek = (position: number) => {
    invoke('seek_audio', { position }).catch(console.error);
  };

  const togglePlayPause = () => {
    invoke('toggle_play').catch(console.error);
  };

  return (
    <PlayerContext.Provider value={{ state, dispatch, seek, togglePlayPause }}>
      {children}
    </PlayerContext.Provider>
  );
};

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
}
