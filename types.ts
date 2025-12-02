
declare global {
  interface Window {
    __TAURI__: any;
    jsmediatags?: any;
  }
}

export interface Track {
  id: string;
  file: File; // The raw file pointer (for Web fallback)
  path?: string; // Absolute path (Required for Rust Native Playback)
  name: string;
  artist: string;
  album?: string;
  year?: string;
  genre?: string;
  copyright?: string;
  duration?: number;
  isLiked?: boolean;
  format?: string;
  image?: string; // Blob URL for cover art
  dateAdded?: number;
  bitrate?: number; // in kbps
  sampleRate?: number;
  fileSize?: number; // in bytes
  source?: 'local' | 'youtube';
  youtubeId?: string;
}

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  isPuristMode: boolean; // Bypasses EQ/DSP for bit-perfect output
  sampleRate: number; // Current DSP sample rate
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
  gain: number; // -12 to +12 dB
}

export interface EqualizerPreset {
  id: string;
  label: string;
  bands: EqualizerBand[];
}

export interface ThemeColor {
  name: string;
  id: string;
  font?: string;
  extraClass?: string;
  colors: {
    300: string;
    400: string;
    500: string;
    600: string;
    900: string;
  }
}

// 10-Band standard ISO frequencies
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
  {
    id: 'manual',
    label: 'Manual',
    bands: DEFAULT_EQ_BANDS
  },
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
    ]
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
    ]
  },
  {
    id: 'pop',
    label: 'Pop',
    bands: [
      { frequency: 32, gain: -1 },
      { frequency: 64, gain: 1 },
      { frequency: 125, gain: 3.5 },
      { frequency: 250, gain: 4 },
      { frequency: 500, gain: 2 },
      { frequency: 1000, gain: 0 },
      { frequency: 2000, gain: 1 },
      { frequency: 4000, gain: 2 },
      { frequency: 8000, gain: 1 },
      { frequency: 16000, gain: 1 },
    ]
  },
  {
    id: 'electronic',
    label: 'Electronic',
    bands: [
      { frequency: 32, gain: 6 },
      { frequency: 64, gain: 5 },
      { frequency: 125, gain: 2 },
      { frequency: 250, gain: 0 },
      { frequency: 500, gain: -2 },
      { frequency: 1000, gain: 0 },
      { frequency: 2000, gain: 1 },
      { frequency: 4000, gain: 4 },
      { frequency: 8000, gain: 5 },
      { frequency: 16000, gain: 5 },
    ]
  },
  {
    id: 'acoustic',
    label: 'Acoustic',
    bands: [
      { frequency: 32, gain: 1 },
      { frequency: 64, gain: 1 },
      { frequency: 125, gain: 0 },
      { frequency: 250, gain: 1 },
      { frequency: 500, gain: 2 },
      { frequency: 1000, gain: 2 },
      { frequency: 2000, gain: 3 },
      { frequency: 4000, gain: 4 },
      { frequency: 8000, gain: 3 },
      { frequency: 16000, gain: 2 },
    ]
  },
  {
    id: 'bass_boost',
    label: 'Bass Booster',
    bands: [
      { frequency: 32, gain: 8 },
      { frequency: 64, gain: 6 },
      { frequency: 125, gain: 4 },
      { frequency: 250, gain: 2 },
      { frequency: 500, gain: 0 },
      { frequency: 1000, gain: 0 },
      { frequency: 2000, gain: 0 },
      { frequency: 4000, gain: 0 },
      { frequency: 8000, gain: 0 },
      { frequency: 16000, gain: 0 },
    ]
  },
  {
    id: 'vocal',
    label: 'Vocal Booster',
    bands: [
      { frequency: 32, gain: -2 },
      { frequency: 64, gain: -2 },
      { frequency: 125, gain: -1 },
      { frequency: 250, gain: 0 },
      { frequency: 500, gain: 3 },
      { frequency: 1000, gain: 5 },
      { frequency: 2000, gain: 4 },
      { frequency: 4000, gain: 2 },
      { frequency: 8000, gain: 0 },
      { frequency: 16000, gain: -1 },
    ]
  }
];