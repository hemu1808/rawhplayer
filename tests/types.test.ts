import { describe, it, expect } from 'vitest';
import { Track, AudioState, PlaybackMode, DEFAULT_EQ_BANDS, EQ_PRESETS, THEMES, EqualizerBand } from '../types';

describe('Types & Constants', () => {
  describe('DEFAULT_EQ_BANDS', () => {
    it('should have exactly 10 bands', () => {
      expect(DEFAULT_EQ_BANDS).toHaveLength(10);
    });

    it('should have all gains at 0 (flat response)', () => {
      DEFAULT_EQ_BANDS.forEach((band: EqualizerBand) => {
        expect(band.gain).toBe(0);
      });
    });

    it('should cover standard frequency range from 32Hz to 16kHz', () => {
      expect(DEFAULT_EQ_BANDS[0].frequency).toBe(32);
      expect(DEFAULT_EQ_BANDS[9].frequency).toBe(16000);
    });

    it('should have frequencies in ascending order', () => {
      for (let i = 1; i < DEFAULT_EQ_BANDS.length; i++) {
        expect(DEFAULT_EQ_BANDS[i].frequency).toBeGreaterThan(DEFAULT_EQ_BANDS[i - 1].frequency);
      }
    });
  });

  describe('EQ_PRESETS', () => {
    it('should have at least 4 presets', () => {
      expect(EQ_PRESETS.length).toBeGreaterThanOrEqual(4);
    });

    it('should include Manual preset with flat response', () => {
      const manual = EQ_PRESETS.find((p) => p.id === 'manual');
      expect(manual).toBeDefined();
      manual!.bands.forEach((band: EqualizerBand) => {
        expect(band.gain).toBe(0);
      });
    });

    it('each preset should have exactly 10 bands', () => {
      EQ_PRESETS.forEach((preset) => {
        expect(preset.bands).toHaveLength(10);
      });
    });

    it('each preset should have unique id', () => {
      const ids = EQ_PRESETS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('no preset band gain should exceed ±12dB', () => {
      EQ_PRESETS.forEach((preset) => {
        preset.bands.forEach((band: EqualizerBand) => {
          expect(band.gain).toBeGreaterThanOrEqual(-12);
          expect(band.gain).toBeLessThanOrEqual(12);
        });
      });
    });
  });

  describe('THEMES', () => {
    it('should have at least 6 themes', () => {
      expect(THEMES.length).toBeGreaterThanOrEqual(6);
    });

    it('each theme should have all 5 color stops', () => {
      THEMES.forEach((theme) => {
        expect(theme.colors).toHaveProperty('300');
        expect(theme.colors).toHaveProperty('400');
        expect(theme.colors).toHaveProperty('500');
        expect(theme.colors).toHaveProperty('600');
        expect(theme.colors).toHaveProperty('900');
      });
    });

    it('each color should be a valid hex string', () => {
      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      THEMES.forEach((theme) => {
        Object.values(theme.colors).forEach((color) => {
          expect(color).toMatch(hexRegex);
        });
      });
    });

    it('each theme should have unique id', () => {
      const ids = THEMES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('PlaybackMode enum', () => {
    it('should have SEQUENCE, LOOP, and SHUFFLE', () => {
      expect(PlaybackMode.SEQUENCE).toBe('SEQUENCE');
      expect(PlaybackMode.LOOP).toBe('LOOP');
      expect(PlaybackMode.SHUFFLE).toBe('SHUFFLE');
    });
  });

  describe('Track interface compliance', () => {
    it('should create a valid Track with required fields', () => {
      const track: Track = {
        id: 'test-id',
        name: 'Test Track',
        artist: 'Test Artist',
      };
      expect(track.id).toBe('test-id');
      expect(track.name).toBe('Test Track');
      expect(track.artist).toBe('Test Artist');
    });

    it('should allow all optional fields', () => {
      const track: Track = {
        id: 'full-track',
        name: 'Full Track',
        artist: 'Full Artist',
        album: 'Test Album',
        format: 'FLAC',
        image: 'blob:test',
        duration: 240,
        dateAdded: Date.now(),
        source: 'local',
        bitrate: 320,
        sampleRate: 44100,
        year: '2026',
        genre: 'Electronic',
        isLiked: true,
        path: '/path/to/file.flac',
      };
      expect(track.album).toBe('Test Album');
      expect(track.format).toBe('FLAC');
      expect(track.isLiked).toBe(true);
      expect(track.path).toBe('/path/to/file.flac');
    });
  });

  describe('AudioState interface compliance', () => {
    it('should create valid AudioState with defaults', () => {
      const state: AudioState = {
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
      expect(state.volume).toBe(1.0);
      expect(state.isPuristMode).toBe(true);
      expect(state.processingPrecision).toBe('32-bit float');
    });
  });
});
