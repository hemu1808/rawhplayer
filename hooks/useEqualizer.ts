import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_EQ_BANDS, EQ_PRESETS, type EqualizerBand } from '../types';
import { usePersistence } from './usePersistence';
import { readDeviceProfile, readDeviceAdvancedEq, validBands } from '../services/deviceProfiles';
import {
  DEFAULT_ADVANCED_EQ,
  EQ_ADVANCED_KEY,
  validAdvancedEq,
  type AdvancedEqualizer,
} from '../services/equalizerSettings';
import { commands } from '../services/generated/native';

export function useEqualizer(isPuristMode: boolean, deviceName?: string | null) {
  const [storedBands, setEqBands] = usePersistence<EqualizerBand[]>('rawh_eq_bands', DEFAULT_EQ_BANDS);
  const [storedPreset, setPresetId] = usePersistence<string>('rawh_eq_preset', 'manual');
  const [storedAdvanced, setAdvanced] = usePersistence<AdvancedEqualizer>(EQ_ADVANCED_KEY, DEFAULT_ADVANCED_EQ);
  const [syncError, setSyncError] = useState('');
  const eqBands = validBands(storedBands) ? storedBands : DEFAULT_EQ_BANDS;
  const advanced = validAdvancedEq(storedAdvanced) ? storedAdvanced : DEFAULT_ADVANCED_EQ;
  const currentPresetId = EQ_PRESETS.some((preset) => preset.id === storedPreset) ? storedPreset : 'manual';
  const settings = useMemo(
    () => ({ ...advanced, graphicGains: eqBands.map((band) => band.gain) }),
    [eqBands, advanced],
  );
  const lastDevice = useRef<string | null>(null);

  useEffect(() => {
    if (!deviceName || lastDevice.current === deviceName) return;
    lastDevice.current = deviceName;
    const profile = readDeviceProfile(deviceName);
    if (profile) {
      setEqBands(profile);
      setAdvanced(readDeviceAdvancedEq(deviceName) ?? DEFAULT_ADVANCED_EQ);
      setPresetId('manual');
    }
  }, [deviceName, setEqBands, setPresetId, setAdvanced]);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void commands
        .configureEqualizer(settings, isPuristMode)
        .then(() => {
          if (active) setSyncError('');
        })
        .catch((error: unknown) => {
          if (active) setSyncError(error instanceof Error ? error.message : String(error));
        });
    }, 28);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [settings, isPuristMode]);

  function updateBand(index: number, gain: number) {
    setPresetId('manual');
    setEqBands((previous) =>
      (validBands(previous) ? previous : DEFAULT_EQ_BANDS).map((band, i) => (i === index ? { ...band, gain } : band)),
    );
  }

  function updateAdvanced(changes: Partial<AdvancedEqualizer>) {
    setAdvanced((previous) => ({ ...(validAdvancedEq(previous) ? previous : DEFAULT_ADVANCED_EQ), ...changes }));
  }

  function resetBands() {
    if (advanced.mode === 'parametric') {
      updateAdvanced({ filters: DEFAULT_ADVANCED_EQ.filters, preampDb: 0 });
    } else {
      setEqBands(DEFAULT_EQ_BANDS);
      setPresetId('manual');
      updateAdvanced({ preampDb: 0 });
    }
  }

  function setPreset(id: string) {
    const preset = EQ_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setPresetId(id);
    if (id !== 'manual') setEqBands(preset.bands);
  }

  return { eqBands, currentPresetId, settings, syncError, updateBand, updateAdvanced, resetBands, setPreset };
}
