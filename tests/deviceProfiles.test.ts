import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EQ_BANDS } from '../types';
import { readDeviceProfile, readDeviceVolume, saveDeviceProfile, validBands } from '../services/deviceProfiles';

describe('device EQ profiles', () => {
  beforeEach(() => localStorage.clear());
  it('stores device volume defaults, including mute-level volume, and rejects unsafe values', () => {
    localStorage.setItem('rawh_eq_bands', JSON.stringify(DEFAULT_EQ_BANDS));
    saveDeviceProfile('DAC', 0.25);
    saveDeviceProfile('Headphones', 0);
    expect(readDeviceVolume('DAC')).toBe(0.25);
    expect(readDeviceVolume('Headphones')).toBe(0);
    expect(readDeviceVolume('Unknown')).toBeUndefined();
    expect(() => saveDeviceProfile('DAC', NaN)).toThrow();
    expect(() => saveDeviceProfile('DAC', 2)).toThrow();
    expect(readDeviceVolume('DAC')).toBe(0.25);
  });
  it('restores the matching device without mixing profiles', () => {
    const bands = DEFAULT_EQ_BANDS.map((band) => ({ ...band, gain: 3 }));
    localStorage.setItem('rawh_eq_bands', JSON.stringify(bands));
    saveDeviceProfile('USB DAC');
    expect(readDeviceProfile('USB DAC')).toEqual(bands);
    expect(readDeviceProfile('Speakers')).toBeUndefined();
  });
  it('rejects malformed, unsafe and non-finite equalizer state', () => {
    expect(validBands(DEFAULT_EQ_BANDS.slice(1))).toBe(false);
    expect(validBands(DEFAULT_EQ_BANDS.map((band) => ({ ...band, gain: NaN })))).toBe(false);
    expect(validBands(DEFAULT_EQ_BANDS.map((band) => ({ ...band, gain: 13 })))).toBe(false);
    localStorage.setItem('rawh_device_eq_profiles_v1', 'invalid');
    expect(readDeviceProfile('USB DAC')).toBeUndefined();
    expect(() => saveDeviceProfile('USB DAC')).toThrow();
  });
  it('treats unusual device names as data', () => {
    localStorage.setItem('rawh_eq_bands', JSON.stringify(DEFAULT_EQ_BANDS));
    saveDeviceProfile('__proto__');
    expect(readDeviceProfile('__proto__')).toEqual(DEFAULT_EQ_BANDS);
  });
});
