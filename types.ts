declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    jsmediatags?: unknown;
  }
}

export interface Track {
  analysis?: import('./services/generated/native').TrackAnalysis;
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
  artworkPath?: string;
  bitDepth?: number;
  trackNumber?: number;
  missing?: boolean;
  playCount?: number;
  listeningSeconds?: number;
  replayGainTrack?: number;
  replayGainAlbum?: number;
}

export interface QueueEntry {
  id: string;
  trackId: string;
}

export interface SmartRule {
  query?: string;
  artist?: string;
  genre?: string;
  format?: string;
  likedOnly?: boolean;
  unplayedOnly?: boolean;
  addedWithinDays?: number;
  minSampleRate?: number;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  smartRule?: SmartRule;
  createdAt: number;
}

export interface LibrarySnapshot {
  schemaVersion: 1;
  tracks: Track[];
  queue: QueueEntry[];
  playlists: Playlist[];
  session: { currentQueueId: string | null; position: number; playbackMode: PlaybackMode };
  watchedFolders: string[];
}

export interface AudioDevice {
  id: string;
  name: string;
  is_default: boolean;
}

export type AudioInfo = import('./services/generated/native').AudioInfo;

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
  SHUFFLE = 'SHUFFLE',
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
  };
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
  {
    id: 'rock',
    label: 'Rock',
    bands: [
      { frequency: 32, gain: 4.5 },
      { frequency: 64, gain: 3.5 },
      { frequency: 125, gain: 2.5 },
      { frequency: 250, gain: 0 },
      { frequency: 500, gain: -1.5 },
      { frequency: 1000, gain: -1.5 },
      { frequency: 2000, gain: 0 },
      { frequency: 4000, gain: 2.5 },
      { frequency: 8000, gain: 3.5 },
      { frequency: 16000, gain: 4.5 },
    ],
  },
  {
    id: 'jazz',
    label: 'Jazz',
    bands: [
      { frequency: 32, gain: 3 },
      { frequency: 64, gain: 2 },
      { frequency: 125, gain: 1 },
      { frequency: 250, gain: 2 },
      { frequency: 500, gain: 0 },
      { frequency: 1000, gain: 0 },
      { frequency: 2000, gain: 2 },
      { frequency: 4000, gain: 1 },
      { frequency: 8000, gain: 2 },
      { frequency: 16000, gain: 3 },
    ],
  },
  {
    id: 'vocal',
    label: 'Vocal / Acoustic',
    bands: [
      { frequency: 32, gain: -2 },
      { frequency: 64, gain: -2 },
      { frequency: 125, gain: -1 },
      { frequency: 250, gain: 1 },
      { frequency: 500, gain: 3 },
      { frequency: 1000, gain: 4 },
      { frequency: 2000, gain: 3 },
      { frequency: 4000, gain: 2 },
      { frequency: 8000, gain: 1 },
      { frequency: 16000, gain: 0 },
    ],
  },
  {
    id: 'bass',
    label: 'Bass Boost',
    bands: [
      { frequency: 32, gain: 6 },
      { frequency: 64, gain: 5 },
      { frequency: 125, gain: 3 },
      { frequency: 250, gain: 1 },
      { frequency: 500, gain: 0 },
      { frequency: 1000, gain: 0 },
      { frequency: 2000, gain: 0 },
      { frequency: 4000, gain: 0 },
      { frequency: 8000, gain: 0 },
      { frequency: 16000, gain: -1 },
    ],
  },
];

const GOLD_THEME_COLORS = { 300: '#fff09a', 400: '#ffe375', 500: '#f2d34b', 600: '#b79b2e', 900: '#332a12' };

export const THEMES: ThemeColor[] = [
  {
    name: 'Slate',
    id: 'immersive',
    colors: { 300: '#e1e8ee', 400: '#c9d4dd', 500: '#b1c2cf', 600: '#8a9faa', 900: '#303e45' },
  },
  {
    name: 'Album artwork',
    id: 'dynamic',
    colors: GOLD_THEME_COLORS,
  },
  {
    name: 'Brass',
    id: 'gold',
    colors: { 300: '#f3e4ba', 400: '#e2cc99', 500: '#d1b47b', 600: '#ab925f', 900: '#413721' },
  },
  {
    name: 'Gold',
    id: 'reference',
    colors: GOLD_THEME_COLORS,
  },
  {
    name: 'Copper',
    id: 'analog',
    colors: { 300: '#f0d6c5', 400: '#e2b99e', 500: '#d1a184', 600: '#ae7d63', 900: '#473329' },
  },
  {
    name: 'Harbor',
    id: 'cyber',
    colors: { 300: '#d0e3ee', 400: '#b6d3e3', 500: '#9ebfd4', 600: '#739bb4', 900: '#2c414c' },
  },
  {
    name: 'Fern',
    id: 'forest',
    colors: { 300: '#d6e9d8', 400: '#bbd7bf', 500: '#a1c3a6', 600: '#81a887', 900: '#304436' },
  },
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
