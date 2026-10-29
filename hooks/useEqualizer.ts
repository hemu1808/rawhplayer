import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_EQ_BANDS, EqualizerBand, EQ_PRESETS } from '../types';
import { usePersistence } from './usePersistence';
import { readDeviceProfile, validBands } from '../services/deviceProfiles';

export function useEqualizer(isPuristMode: boolean, deviceName?: string | null) {
  const [storedBands, setEqBands] = usePersistence<EqualizerBand[]>(
    'rawh_eq_bands',
    DEFAULT_EQ_BANDS.map((b) => ({ ...b })),
  );
  const [currentPresetId, setCurrentPresetId] = usePersistence<string>('rawh_eq_preset', 'manual');
  const eqBands = validBands(storedBands) ? storedBands : DEFAULT_EQ_BANDS;
  const lastDevice = useRef<string | null>(null);
  useEffect(() => {
    if (!deviceName || lastDevice.current === deviceName) return;
    lastDevice.current = deviceName;
    const profile = readDeviceProfile(deviceName);
    if (profile) {
      setEqBands(profile);
      setCurrentPresetId('manual');
    }
  }, [deviceName, setEqBands, setCurrentPresetId]);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    invoke('set_purist_mode', { isPurist: isPuristMode }).catch((err) => {
      console.error('Failed to sync purist mode to backend:', err);
    });
  }, [isPuristMode]);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    eqBands.forEach((band, i) => {
      invoke('set_equalizer_band', { index: i, gain: band.gain }).catch((err) => {
        console.error(`Failed to sync EQ band ${i} to backend:`, err);
      });
    });
  }, [eqBands]);

  const updateBand = (index: number, gain: number) => {
    setEqBands((prev) => {
      const next = [...(validBands(prev) ? prev : DEFAULT_EQ_BANDS)];
      next[index] = { ...next[index], gain };
      return next;
    });
  };

  const resetBands = () => {
    setEqBands(DEFAULT_EQ_BANDS.map((b) => ({ ...b })));
    setCurrentPresetId('manual');
  };

  const setPreset = (id: string) => {
    setCurrentPresetId(id);
    const p = EQ_PRESETS.find((x) => x.id === id);
    if (p) setEqBands(p.bands.map((b) => ({ ...b })));
  };

  return {
    eqBands,
    currentPresetId,
    updateBand,
    resetBands,
    setPreset,
  };
}
