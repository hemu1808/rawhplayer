import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';

export function SoftwareUpdates() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('Updates are unavailable in this build.');
  const [version, setVersion] = useState<string>();
  const [busy, setBusy] = useState(false);
  const update = useRef<Update | null>(null);
  const active = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    if (window.__TAURI_INTERNALS__)
      void invoke<{ enabled: boolean; managed: boolean }>('update_status')
        .then((status) => {
          if (!active.current) return;
          setEnabled(status.enabled);
          setMessage(
            status.managed
              ? 'Updates are managed by your administrator.'
              : status.enabled
                ? 'Updates are checked only when you choose.'
                : 'Updates are unavailable in this build.',
          );
        })
        .catch(() => {
          if (active.current) setMessage('Update configuration could not be read.');
        });
    return () => {
      active.current = false;
      if (!running.current) {
        void update.current?.close().catch(() => {});
        update.current = null;
      }
    };
  }, []);

  async function run(install: boolean) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (install) {
        const candidate = update.current;
        if (!candidate) return;
        setMessage('Downloading and verifying the update…');
        let bytes = 0;
        await candidate.download(
          (event) => {
            if (event.event === 'Progress') bytes += event.data.chunkLength;
            if (active.current) setMessage(`Downloading update: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
          },
          { timeout: 120_000 },
        );
        // Navigating away cancels installation; downloading alone never closes the app.
        if (!active.current) return;
        setMessage('Installing update…');
        await candidate.install();
        if (active.current) setMessage('Update installed. Close and reopen RawhPlayer to finish.');
        await candidate.close();
        update.current = null;
        if (active.current) setVersion(undefined);
      } else {
        await update.current?.close();
        update.current = null;
        setVersion(undefined);
        setMessage('Checking for updates…');
        update.current = await check({ timeout: 20_000 });
        if (active.current) {
          setVersion(update.current?.version);
          setMessage(
            update.current
              ? `Version ${update.current.version} is available. Installation may close the player.`
              : 'You have the latest version.',
          );
        }
      }
    } catch (error) {
      if (active.current) setMessage(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
      else {
        await update.current?.close().catch(() => {});
        update.current = null;
      }
    }
  }

  return (
    <fieldset className="glass-panel rounded-2xl p-6 space-y-4">
      <legend>Software updates</legend>
      <p role="status" className="text-sm text-neutral-400">
        {message}
      </p>
      <div className="flex gap-4">
        <button disabled={!enabled || busy} onClick={() => void run(false)}>
          Check for updates
        </button>
        {version && (
          <button disabled={busy} onClick={() => void run(true)}>
            Install {version}
          </button>
        )}
      </div>
    </fieldset>
  );
}
