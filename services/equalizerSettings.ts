import type { EqualizerSettings, FilterKind, ParametricBand } from './generated/native';

export type AdvancedEqualizer = Omit<EqualizerSettings, 'graphicGains'>;
export const EQ_ADVANCED_KEY = 'rawh_eq_advanced_v1';
export const MAX_PARAMETRIC_BANDS = 8;
export const EQ_LIMITS = {
  frequency: { min: 20, max: 20000, step: 1 },
  gain: { min: -18, max: 18, step: 0.1 },
  q: { min: 0.1, max: 18, step: 0.01 },
  preamp: { min: -24, max: 12, step: 0.1 },
} as const;

export const FILTER_TYPES = {
  peak: { label: 'Bell', gain: true, q: true },
  lowShelf: { label: 'Low shelf', gain: true, q: false },
  highShelf: { label: 'High shelf', gain: true, q: false },
  highPass: { label: 'High-pass', gain: false, q: true },
  lowPass: { label: 'Low-pass', gain: false, q: true },
  notch: { label: 'Notch', gain: false, q: true },
} satisfies Record<FilterKind, { label: string; gain: boolean; q: boolean }>;

export function eqBand(frequency: number, kind: FilterKind = 'peak'): ParametricBand {
  return { kind, frequency, gain: 0, q: 0.707, enabled: true };
}

export const DEFAULT_ADVANCED_EQ: AdvancedEqualizer = {
  mode: 'graphic',
  filters: [eqBand(70, 'lowShelf'), eqBand(250), eqBand(1000), eqBand(4000), eqBand(10000, 'highShelf')],
  preampDb: 0,
  autoHeadroom: true,
};

export function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
}

export function validAdvancedEq(value: unknown): value is AdvancedEqualizer {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return (
    (state.mode === 'graphic' || state.mode === 'parametric') &&
    typeof state.autoHeadroom === 'boolean' &&
    inRange(state.preampDb, EQ_LIMITS.preamp) &&
    Array.isArray(state.filters) &&
    state.filters.length <= MAX_PARAMETRIC_BANDS &&
    state.filters.every((filter: unknown) => {
      if (!filter || typeof filter !== 'object') return false;
      const band = filter as Record<string, unknown>;
      return (
        typeof band.kind === 'string' &&
        Object.hasOwn(FILTER_TYPES, band.kind) &&
        typeof band.enabled === 'boolean' &&
        inRange(band.frequency, EQ_LIMITS.frequency) &&
        inRange(band.gain, EQ_LIMITS.gain) &&
        inRange(band.q, EQ_LIMITS.q)
      );
    })
  );
}
