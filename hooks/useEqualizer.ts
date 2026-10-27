import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_EQ_BANDS, EqualizerBand, EQ_PRESETS } from '../types';
import { usePersistence } from './usePersistence';

export function useEqualizer(isPuristMode: boolean) {
  const [eqBands, setEqBands] = usePersistence<EqualizerBand[]>('rawh_eq_bands', DEFAULT_EQ_BANDS.map(b => ({ ...b })));
  const [currentPresetId, setCurrentPresetId] = usePersistence<string>('rawh_eq_preset', 'manual');

  useEffect(() => {
    invoke('set_purist_mode', { isPurist: isPuristMode }).catch(err => {
      console.error("Failed to sync purist mode to backend:", err);
    });
  }, [isPuristMode]);

  useEffect(() => {
    eqBands.forEach((band, i) => {
      invoke('set_equalizer_band', { index: i, gain: band.gain }).catch(err => {
        console.error(`Failed to sync EQ band ${i} to backend:`, err);
      });
    });
  }, [eqBands]);

  const updateBand = (index: number, gain: number) => {
    setEqBands(prev => {
      const next = [...prev];
      next[index] = { ...next[index], gain };
      return next;
    });
  };

  const resetBands = () => {
    setEqBands(DEFAULT_EQ_BANDS.map(b => ({ ...b })));
    setCurrentPresetId('manual');
  };

  const setPreset = (id: string) => {
    setCurrentPresetId(id);
    const p = EQ_PRESETS.find(x => x.id === id);
    if (p) setEqBands(p.bands.map(b => ({ ...b })));
  };

  return {
    eqBands,
    currentPresetId,
    updateBand,
    resetBands,
    setPreset
  };
}
