import { DEFAULT_EQ_BANDS, type EqualizerBand } from '../types';
const KEY = 'rawh_device_eq_profiles_v1';
const VOLUME_KEY = 'rawh_device_volume_profiles_v1';

export function readDeviceVolume(device: string): number | undefined {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(VOLUME_KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Object.hasOwn(saved, device)) return;
    const volume = (saved as Record<string, unknown>)[device];
    return typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : undefined;
  } catch {
    return;
  }
}
export function validBands(value: unknown): value is EqualizerBand[] {
  return (
    Array.isArray(value) &&
    value.length === DEFAULT_EQ_BANDS.length &&
    value.every(
      (band, index) =>
        band &&
        typeof band === 'object' &&
        band.frequency === DEFAULT_EQ_BANDS[index].frequency &&
        typeof band.gain === 'number' &&
        Number.isFinite(band.gain) &&
        Math.abs(band.gain) <= 12,
    )
  );
}
export function readDeviceProfile(device: string): EqualizerBand[] | undefined {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const profile = (data as Record<string, unknown>)[device];
    return validBands(profile) ? profile : undefined;
  } catch {
    return;
  }
}
export function saveDeviceProfile(device: string, volume?: number): void {
  if (volume !== undefined && (!Number.isFinite(volume) || volume < 0 || volume > 1))
    throw new Error('Choose a volume between 0 and 100%.');
  const current: unknown = JSON.parse(localStorage.getItem('rawh_eq_bands') || 'null');
  if (!validBands(current)) throw new Error('Set valid EQ bands before saving a device profile.');
  let saved: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value as Record<string, unknown>;
  } catch {
    /* Explicit save replaces invalid profiles. */
  }
  const entries = Object.entries(saved)
    .filter(([key, value]) => key !== device && validBands(value))
    .slice(-99);
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...entries, [device, current]])));
  if (volume !== undefined) {
    let profiles: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(localStorage.getItem(VOLUME_KEY) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) profiles = value as Record<string, unknown>;
    } catch {
      /* Replace malformed volume profiles only on an explicit save. */
    }
    const volumes = Object.entries(profiles)
      .filter(
        ([name, value]) =>
          name !== device && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
      )
      .slice(-99);
    localStorage.setItem(VOLUME_KEY, JSON.stringify(Object.fromEntries([...volumes, [device, volume]])));
  }
}
