import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { THEMES, type ThemeColor, type AudioDevice } from '../types';
import { ScrollArea } from '../components/ScrollArea';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { SoftwareUpdates } from '../components/SoftwareUpdates';
import { LibraryMaintenance } from '../components/LibraryMaintenance';
import { saveDeviceProfile } from '../services/deviceProfiles';

interface Props {
  currentThemeId: string;
  onThemeChange: (theme: ThemeColor) => void;
  isPuristMode: boolean;
  onTogglePurist: () => void;
  bufferSize?: number;
  processingPrecision?: string;
  onTogglePrecision?: () => void;
  onBufferSizeChange?: (size: number) => void;
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.download = name;
  anchor.href = url;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SettingsPage({ currentThemeId, onThemeChange, isPuristMode, onTogglePurist }: Props) {
  const { state: audioState, nativeInfo, refreshAudioInfo } = usePlayer();
  const library = useLibrary();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [notice, setNotice] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [watchedFolders, setWatchedFolders] = useState<string[]>([]);
  const [policy, setPolicy] = useState<{ allowUpdates: boolean; allowExternalServices: boolean; allowMetadataEdits: boolean } | null>(null);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        setNotice('Saved.');
        await refreshAudioInfo();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshAudioInfo],
  );
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let active = true;
    invoke<{ allowUpdates: boolean; allowExternalServices: boolean; allowMetadataEdits: boolean }>('deployment_policy')
      .then((value) => {
        if (active) setPolicy(value);
      })
      .catch((error) => {
        if (active) setNotice(String(error));
      });
    invoke<AudioDevice[]>('list_audio_devices')
      .then((value) => {
        if (active) setDevices(value);
      })
      .catch((error) => {
        if (active) setNotice(String(error));
      });
    invoke<{ gemini: boolean }>('credential_status')
      .then((value) => {
        if (active) setConfigured(value.gemini);
      })
      .catch(() => {});
    invoke<string[]>('get_watched_folders')
      .then((folders) => {
        if (active) setWatchedFolders(folders);
      })
      .catch((error) => {
        if (active) setNotice(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <ScrollArea title="Settings" subtitle="Playback, library and privacy">
      <div className="px-8 pb-28 max-w-4xl space-y-6">
        {notice && (
          <p role="status" className="rounded-xl border border-white/20 p-3">
            {notice}
          </p>
        )}
        <fieldset className="glass-panel rounded-2xl p-6 space-y-4">
          <legend>Appearance</legend>
          <div className="flex gap-3 flex-wrap">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                aria-pressed={theme.id === currentThemeId}
                onClick={() => onThemeChange(theme)}
                className="border border-white/20 rounded-lg p-3"
              >
                {theme.name}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="glass-panel rounded-2xl p-6 space-y-5">
          <legend>Audio output</legend>
          <button
            disabled={!nativeInfo?.device_name}
            onClick={() =>
              void run(async () => {
                if (nativeInfo?.device_name) saveDeviceProfile(nativeInfo.device_name, audioState.volume);
              })
            }
          >
            Save current EQ and volume for this output device
          </button>
          <label className="block">
            Output device
            <select
              className="block bg-neutral-900 rounded-lg p-3 mt-2 w-full"
              aria-label="Output device"
              value={nativeInfo?.device_name || ''}
              onChange={(event) => void run(() => invoke('set_output_device', { deviceId: event.target.value || null }))}
            >
              <option value="">System default</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
          <button aria-pressed={isPuristMode} onClick={onTogglePurist} className="border border-white/20 rounded-lg p-3">
            {isPuristMode ? 'EQ bypassed' : 'Equalizer enabled'}
          </button>
          <p className="text-sm text-neutral-400">
            Actual output: {nativeInfo?.output_sample_rate ? nativeInfo.output_sample_rate / 1000 + ' kHz' : 'Not connected'} ·{' '}
            {nativeInfo?.output_format || 'Unknown format'}. Audio uses the system mixer.
          </p>
          <label className="block">
            Crossfade: {nativeInfo?.crossfade_seconds || 0} seconds
            <input
              className="block w-full mt-2"
              aria-label="Crossfade seconds"
              type="range"
              min="0"
              max="12"
              step="1"
              value={nativeInfo?.crossfade_seconds || 0}
              onChange={(event) => void run(() => invoke('set_crossfade_duration', { seconds: Number(event.target.value) }))}
            />
          </label>
          <label className="block">
            Loudness normalization
            <select
              className="block bg-neutral-900 rounded-lg p-3 mt-2"
              value={nativeInfo?.normalization || 'off'}
              onChange={(event) => void run(() => invoke('set_normalization', { mode: event.target.value, preampDb: 0 }))}
            >
              <option value="off">Off</option>
              <option value="track">Track ReplayGain</option>
              <option value="album">Album ReplayGain</option>
            </select>
          </label>
          <p className="text-sm text-neutral-400">
            ReplayGain uses tags embedded in your music. Untagged files retain their original loudness.
          </p>
        </fieldset>
        <fieldset className="glass-panel rounded-2xl p-6 space-y-4">
          <legend>Library and recovery</legend>
          <p className="text-sm text-neutral-400">
            Watched folders are scanned at startup and when music changes. Missing files stay in your playlists and can return when a drive
            reconnects.
          </p>
          <button
            onClick={() =>
              void run(async () => {
                setWatchedFolders(await invoke<string[]>('pick_watched_folder'));
              })
            }
          >
            Add watched folder
          </button>
          <ul className="space-y-2">
            {watchedFolders.map((folder) => (
              <li key={folder} className="flex gap-3 items-center">
                <span className="break-all flex-1">{folder}</span>
                <button
                  aria-label={`Stop watching ${folder}`}
                  onClick={() =>
                    void run(async () => {
                      await invoke('remove_watched_folder', { path: folder });
                      setWatchedFolders(await invoke<string[]>('get_watched_folders'));
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-4 flex-wrap">
            <button onClick={() => void run(async () => download('rawh-library.json', await library.exportLibrary()))}>
              Export library backup
            </button>
            <button onClick={() => void run(library.refreshLibrary)}>Rescan library</button>
            <button onClick={() => void run(async () => download('rawh-diagnostics.json', await invoke<string>('diagnostics_export')))}>
              Export diagnostics
            </button>
          </div>
          <label className="block">
            Restore backup
            <input
              type="file"
              accept=".json"
              className="block mt-2"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void run(async () => {
                    if (file.size > 64 * 1024 * 1024) throw new Error('Backup exceeds 64 MB');
                    await library.restoreLibrary(await file.text());
                    if (window.__TAURI_INTERNALS__) setWatchedFolders(await invoke<string[]>('get_watched_folders'));
                  });
                event.target.value = '';
              }}
            />
          </label>
          <p className="text-sm text-neutral-400">
            Backups contain metadata, playlists and file paths. Your audio files remain in their original folders. After restoring on
            another computer, import those folders to grant access.
          </p>
        </fieldset>
        <SoftwareUpdates />
        {policy && (!policy.allowUpdates || !policy.allowExternalServices || !policy.allowMetadataEdits) && (
          <p className="rounded-xl border border-white/20 p-3">
            Administrator policy disables:{' '}
            {[
              !policy.allowUpdates && 'self-updates',
              !policy.allowExternalServices && 'external integrations',
              !policy.allowMetadataEdits && 'file metadata edits',
            ]
              .filter(Boolean)
              .join(', ')}
            .
          </p>
        )}
        <LibraryMaintenance />
        <fieldset className="glass-panel rounded-2xl p-6 space-y-4">
          <legend>Optional AI insights</legend>
          <p className="text-sm text-neutral-400">
            Only pressing the insight button sends a track title and artist to Google. Credentials are held in your operating system
            credential store.
          </p>
          <label className="block">
            Gemini API key
            <input
              className="block bg-neutral-900 rounded-lg p-3 mt-2 w-full"
              autoComplete="off"
              type="password"
              value={geminiKey}
              onChange={(event) => setGeminiKey(event.target.value)}
              placeholder={configured ? 'Key saved securely' : 'Enter API key'}
            />
          </label>
          <div className="flex gap-4">
            <button
              disabled={!geminiKey}
              onClick={() =>
                void run(async () => {
                  await invoke('credential_set', { service: 'gemini', key: geminiKey });
                  setGeminiKey('');
                  setConfigured(true);
                  localStorage.removeItem('rawh_gemini_api_key');
                })
              }
            >
              Save key
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await invoke('credential_delete', { service: 'gemini' });
                  setConfigured(false);
                  localStorage.removeItem('rawh_gemini_api_key');
                })
              }
            >
              Delete key
            </button>
          </div>
        </fieldset>
      </div>
    </ScrollArea>
  );
}
