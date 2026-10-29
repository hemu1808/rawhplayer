/**
 * Rawh Player — Application Configuration Constants
 *
 * Centralized configuration for app-wide settings, defaults,
 * and feature flags. Used by contexts, hooks, and components.
 */

export const APP_NAME = 'Rawh Player';
export const VERSION = '3.0.0';
export const APP_IDENTIFIER = 'com.rawhplayer.app';

/** Supported audio file extensions (must match Rust backend whitelist) */
export const SUPPORTED_EXTENSIONS = ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'aiff', 'dsf', 'dff'] as const;

/** Default audio engine settings */
export const DEFAULT_SETTINGS = {
  puristMode: true,
  precision: '32-bit float' as const,
  bufferSize: 2048,
  volume: 1.0,
  crossfadeDuration: 0, // 0 = gapless, > 0 = crossfade in seconds
  playbackRate: 1.0,
};

/** Playback rate presets */
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;

/** EQ gain limits (dB) */
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;

/** FFT configuration */
export const FFT_SIZE = 1024;
export const FFT_UPDATE_FPS = 30;

/** Mouse idle timeout for cinematic mode (ms) */
export const MOUSE_IDLE_TIMEOUT = 4000;

/** AI insight cache TTL (ms) — 1 hour */
export const AI_CACHE_TTL = 3600000;

/** localStorage keys */
export const STORAGE_KEYS = {
  tracks: 'rawh_tracks',
  currentTrackIdx: 'rawh_current_track_idx',
  volume: 'rawh_volume',
  muted: 'rawh_muted',
  puristMode: 'rawh_purist_mode',
  bufferSize: 'rawh_buffer_size',
  precision: 'rawh_precision',
  themeId: 'rawh_theme_id',
  eqPreset: 'rawh_eq_preset',
  eqBands: 'rawh_eq_bands',
  playbackMode: 'rawh_playback_mode',
  stats: 'rawh_stats',
  watchedFolders: 'rawh_watched_folders',
  geminiApiKey: 'rawh_gemini_api_key',
  youtubeApiKey: 'rawh_youtube_api_key',
} as const;

/** Radio station genres */
export const RADIO_GENRES = [
  'All',
  'Ambient',
  'Classical',
  'Electronic',
  'Jazz',
  'Lounge',
  'Metal',
  'Pop',
  'Rock',
  'World',
] as const;

/** Feature flags for Tier 3 stubs */
export const FEATURE_FLAGS = {
  spatialAudio: false, // v4 — HRTF binaural processing
  aiDjMode: false, // v4 — Gemini-powered sequencing
  vstHost: false, // v4 — VST3 plugin hosting
  mobileCompanion: false, // v4 — Remote control app
  roomCorrection: false, // v4 — Mic-based room measurement
} as const;
