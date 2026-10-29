import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AudioInfo, AudioState, PlayerAction } from '../types';
import { readDeviceVolume } from '../services/deviceProfiles';

type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
interface PlayerContextType {
  state: AudioState;
  dispatch: React.Dispatch<PlayerAction>;
  seek: (position: number) => void;
  togglePlayPause: () => void;
  status: PlaybackStatus;
  error: string | null;
  clearError: () => void;
  reportError: (error: unknown) => void;
  nativeInfo: AudioInfo | null;
  refreshAudioInfo: () => Promise<void>;
  registerResumeHandler: (handler: (() => void) | null) => void;
  setLoading: () => void;
}

const initialState: AudioState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  playbackRate: 1,
  isPuristMode: true,
  sampleRate: 0,
  bufferSize: 2048,
  processingPrecision: '32-bit float',
};
const isNative = () => Boolean(window.__TAURI_INTERNALS__);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'The operation could not be completed. Please try again.';

export function playerReducer(state: AudioState, action: PlayerAction): AudioState {
  switch (action.type) {
    case 'PLAY':
      return state;
    case 'PAUSE':
      return state;
    case 'SEEK':
      return { ...state, currentTime: clamp(action.payload, 0, state.duration || Number.MAX_SAFE_INTEGER, state.currentTime) };
    case 'SET_VOLUME': {
      const volume = clamp(action.payload, 0, 1, state.volume);
      return { ...state, volume, isMuted: volume === 0 };
    }
    case 'TOGGLE_MUTE':
      return { ...state, isMuted: !state.isMuted };
    case 'SET_PLAYBACK_RATE':
      return { ...state, playbackRate: clamp(action.payload, 0.25, 4, state.playbackRate) };
    case 'SET_PURIST_MODE':
      return { ...state, isPuristMode: action.payload };
    case 'SET_BUFFER_SIZE':
      return { ...state, bufferSize: clamp(action.payload, 128, 8192, state.bufferSize) };
    case 'SET_PRECISION':
      return { ...state, processingPrecision: action.payload };
    case 'UPDATE_PLAYBACK':
      return {
        ...state,
        currentTime: clamp(action.payload.currentTime, 0, Number.MAX_SAFE_INTEGER, state.currentTime),
        duration: clamp(action.payload.duration, 0, Number.MAX_SAFE_INTEGER, state.duration),
        isPlaying: action.payload.isPlaying,
      };
    case 'SET_STATE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

function restorePreferences(): AudioState {
  try {
    const volume = localStorage.getItem('rawh_volume');
    return {
      ...initialState,
      volume: volume === null ? 1 : clamp(Number(volume), 0, 1, 1),
      isMuted: localStorage.getItem('rawh_muted') === 'true',
      isPuristMode: localStorage.getItem('rawh_purist_mode') !== 'false',
      playbackRate: clamp(Number(localStorage.getItem('rawh_playback_rate') ?? 1), 0.25, 4, 1),
    };
  } catch {
    return initialState;
  }
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, reduce] = useReducer(playerReducer, undefined, restorePreferences);
  const [status, setStatus] = useState<PlaybackStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nativeInfo, setNativeInfo] = useState<AudioInfo | null>(null);
  const infoRef = useRef<AudioInfo | null>(null);
  const resumeHandler = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const profileDevice = useRef<string | null>(null);
  const reportError = useCallback((reason: unknown) => {
    if (!mounted.current) return;
    setError(errorMessage(reason));
    setStatus('error');
  }, []);
  const clearError = useCallback(() => setError(null), []);
  const setLoading = useCallback(() => {
    setStatus('loading');
    setError(null);
  }, []);
  const registerResumeHandler = useCallback((handler: (() => void) | null) => {
    resumeHandler.current = handler;
  }, []);

  const refreshAudioInfo = useCallback(async () => {
    if (!isNative()) return;
    try {
      const info = await invoke<AudioInfo>('get_audio_info');
      if (!mounted.current || !info || !finite(info.current_time) || !finite(info.duration)) return;
      infoRef.current = info;
      setNativeInfo(info);
    } catch (reason) {
      reportError(reason);
    }
  }, [reportError]);

  const seek = useCallback(
    (position: number) => {
      if (!finite(position) || position < 0) {
        reportError('Seek position must be a non-negative number.');
        return;
      }
      if (!isNative()) {
        reportError('Playback is available in the desktop app.');
        return;
      }
      void invoke('seek_audio', { position }).catch(reportError);
    },
    [reportError],
  );

  const togglePlayPause = useCallback(() => {
    if (!infoRef.current?.queue_id && resumeHandler.current) {
      resumeHandler.current();
      return;
    }
    if (!isNative()) {
      reportError('Playback is available in the desktop app.');
      return;
    }
    void invoke('toggle_play').catch(reportError);
  }, [reportError]);

  const dispatch = useCallback(
    (action: PlayerAction) => {
      if (action.type === 'PLAY') {
        if (!infoRef.current?.queue_id) resumeHandler.current?.();
        else void invoke('set_paused', { paused: false }).catch(reportError);
      } else if (action.type === 'PAUSE') {
        if (isNative()) void invoke('set_paused', { paused: true }).catch(reportError);
      } else if (action.type === 'SEEK') seek(action.payload);
      else reduce(action);
    },
    [reportError, seek],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('rawh_volume', String(state.volume));
      localStorage.setItem('rawh_muted', String(state.isMuted));
      localStorage.setItem('rawh_purist_mode', String(state.isPuristMode));
      localStorage.setItem('rawh_playback_rate', String(state.playbackRate));
    } catch {
      reportError('Preferences could not be saved. Check available disk space.');
    }
  }, [state.volume, state.isMuted, state.isPuristMode, state.playbackRate, reportError]);

  useEffect(() => {
    if (isNative()) void invoke('set_volume', { volume: state.isMuted ? 0 : state.volume }).catch(reportError);
  }, [state.volume, state.isMuted, reportError]);
  useEffect(() => {
    const device = nativeInfo?.device_name;
    if (!device || profileDevice.current === device) return;
    profileDevice.current = device;
    const volume = readDeviceVolume(device);
    if (volume !== undefined) reduce({ type: 'SET_STATE', payload: { volume } });
  }, [nativeInfo?.device_name]);
  useEffect(() => {
    if (isNative()) void invoke('set_playback_rate', { rate: state.playbackRate }).catch(reportError);
  }, [state.playbackRate, reportError]);

  useEffect(() => {
    if (!isNative()) return;
    let active = true;
    const cleanups: (() => void)[] = [];
    const attach = async <T,>(event: string, callback: (payload: T) => void) => {
      try {
        const unlisten = await listen<T>(event, ({ payload }) => {
          if (active) callback(payload);
        });
        if (active) cleanups.push(unlisten);
        else unlisten();
      } catch (reason) {
        if (active) reportError(reason);
      }
    };
    void attach<Partial<AudioInfo>>('playback_update', (payload) => {
      if (!finite(payload.current_time) || !finite(payload.duration) || typeof payload.is_playing !== 'boolean') return;
      reduce({
        type: 'UPDATE_PLAYBACK',
        payload: { currentTime: payload.current_time, duration: payload.duration, isPlaying: payload.is_playing },
      });
      if (finite(payload.sample_rate)) reduce({ type: 'SET_STATE', payload: { sampleRate: payload.sample_rate } });
      if (infoRef.current) {
        infoRef.current = { ...infoRef.current, ...payload };
        setNativeInfo(infoRef.current);
      } else void refreshAudioInfo();
      setStatus(payload.is_playing ? 'playing' : payload.queue_id ? 'paused' : 'idle');
    });
    void attach<unknown>('audio_error', (reason) => reportError(reason));
    void attach<unknown>('media_play_pause', () => togglePlayPause());
    void attach<unknown>('track_started', () => {
      setError(null);
      void refreshAudioInfo();
    });
    void attach<unknown>('audio_device_changed', () => void refreshAudioInfo());
    void refreshAudioInfo();
    const refresh = window.setInterval(() => void refreshAudioInfo(), 2000);
    return () => {
      active = false;
      clearInterval(refresh);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [refreshAudioInfo, reportError, togglePlayPause]);

  return (
    <PlayerContext.Provider
      value={{
        state,
        dispatch,
        seek,
        togglePlayPause,
        status,
        error,
        clearError,
        reportError,
        nativeInfo,
        refreshAudioInfo,
        registerResumeHandler,
        setLoading,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used within a PlayerProvider');
  return context;
}
