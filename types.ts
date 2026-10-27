
declare global {
  interface Window {
    __TAURI_INTERNALS__?: any;
    jsmediatags?: any;
  }
}

export interface Track {
  id: string;
  file?: File; 
  path?: string; // Absolute path for Native Engine
  name: string;
  artist: string;
  album?: string;
  format?: string;
  image?: string;
  duration?: number;
  dateAdded?: number;
  source?: 'local' | 'youtube';
  bitrate?: number;
  sampleRate?: number;
  year?: string;
  copyright?: string;
  genre?: string;
  isLiked?: boolean;
}

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  isPuristMode: boolean;
  sampleRate: number;
  bufferSize: number;
  processingPrecision: '16-bit' | '32-bit float'; 
}

export enum PlaybackMode {
  SEQUENCE = 'SEQUENCE',
  LOOP = 'LOOP',
  SHUFFLE = 'SHUFFLE'
}

export type SortOption = 'title' | 'artist' | 'date';

export interface EqualizerBand {
  frequency: number;
  gain: number;
}

export interface EqualizerPreset {
  id: string;
  label: string;
  bands: EqualizerBand[];
}

export interface ThemeColor {
  name: string;
  id: string;
  colors: {
    300: string;
    400: string;
    500: string;
    600: string;
    900: string;
  }
}

export const DEFAULT_EQ_BANDS: EqualizerBand[] = [
  { frequency: 32, gain: 0 },
  { frequency: 64, gain: 0 },
  { frequency: 125, gain: 0 },
  { frequency: 250, gain: 0 },
  { frequency: 500, gain: 0 },
  { frequency: 1000, gain: 0 },
  { frequency: 2000, gain: 0 },
  { frequency: 4000, gain: 0 },
  { frequency: 8000, gain: 0 },
  { frequency: 16000, gain: 0 },
];

export const EQ_PRESETS: EqualizerPreset[] = [
  { id: 'manual', label: 'Manual', bands: DEFAULT_EQ_BANDS },
  { id: 'rock', label: 'Rock', bands: [{ frequency: 32, gain: 4.5 }, { frequency: 64, gain: 3.5 }, { frequency: 125, gain: 2.5 }, { frequency: 250, gain: 0 }, { frequency: 500, gain: -1.5 }, { frequency: 1000, gain: -1.5 }, { frequency: 2000, gain: 0 }, { frequency: 4000, gain: 2.5 }, { frequency: 8000, gain: 3.5 }, { frequency: 16000, gain: 4.5 }] },
  { id: 'jazz', label: 'Jazz', bands: [{ frequency: 32, gain: 3 }, { frequency: 64, gain: 2 }, { frequency: 125, gain: 1 }, { frequency: 250, gain: 2 }, { frequency: 500, gain: 0 }, { frequency: 1000, gain: 0 }, { frequency: 2000, gain: 2 }, { frequency: 4000, gain: 1 }, { frequency: 8000, gain: 2 }, { frequency: 16000, gain: 3 }] },
  { id: 'vocal', label: 'Vocal / Acoustic', bands: [{ frequency: 32, gain: -2 }, { frequency: 64, gain: -2 }, { frequency: 125, gain: -1 }, { frequency: 250, gain: 1 }, { frequency: 500, gain: 3 }, { frequency: 1000, gain: 4 }, { frequency: 2000, gain: 3 }, { frequency: 4000, gain: 2 }, { frequency: 8000, gain: 1 }, { frequency: 16000, gain: 0 }] },
  { id: 'bass', label: 'Bass Boost', bands: [{ frequency: 32, gain: 6 }, { frequency: 64, gain: 5 }, { frequency: 125, gain: 3 }, { frequency: 250, gain: 1 }, { frequency: 500, gain: 0 }, { frequency: 1000, gain: 0 }, { frequency: 2000, gain: 0 }, { frequency: 4000, gain: 0 }, { frequency: 8000, gain: 0 }, { frequency: 16000, gain: -1 }] },
];

export const THEMES: ThemeColor[] = [
  { name: 'Immersive Glass', id: 'immersive', colors: { 300: '#ffffff', 400: '#e5e5e5', 500: '#ffffff', 600: '#a3a3a3', 900: '#262626' } },
  { name: 'Dynamic', id: 'dynamic', colors: { 300: '#ffffff', 400: '#cccccc', 500: '#aaaaaa', 600: '#666666', 900: '#333333' } },
  { name: 'Rawh Gold', id: 'gold', colors: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 900: '#78350f' } },
  { name: 'Reference', id: 'reference', colors: { 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 900: '#171717' } },
  { name: 'Analog Warm', id: 'analog', colors: { 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 900: '#431407' } },
  { name: 'Cyber Blue', id: 'cyber', colors: { 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 900: '#164e63' } },
  { name: 'Forest Studio', id: 'forest', colors: { 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 900: '#14532d' } },
];

export type PlayerAction =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; payload: number }
  | { type: 'SET_VOLUME'; payload: number }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'SET_PLAYBACK_RATE'; payload: number }
  | { type: 'SET_PURIST_MODE'; payload: boolean }
  | { type: 'SET_BUFFER_SIZE'; payload: number }
  | { type: 'SET_PRECISION'; payload: '16-bit' | '32-bit float' }
  | { type: 'UPDATE_PLAYBACK'; payload: { currentTime: number; duration: number; isPlaying: boolean } }
  | { type: 'SET_STATE'; payload: Partial<AudioState> };

export type LibraryAction =
  | { type: 'ADD_TRACKS'; payload: Track[] }
  | { type: 'REMOVE_TRACK'; payload: string }
  | { type: 'SET_CURRENT_TRACK'; payload: number }
  | { type: 'PLAY_NEXT'; payload: string }
  | { type: 'ADD_TO_QUEUE'; payload: string }
  | { type: 'SHUFFLE' }
  | { type: 'CLEAR' }
  | { type: 'SET_PLAYBACK_MODE'; payload: PlaybackMode }
  | { type: 'TOGGLE_LIKE'; payload: string }
  | { type: 'SET_STATE'; payload: { tracks: Track[]; currentTrackIndex: number; playbackMode: PlaybackMode } };