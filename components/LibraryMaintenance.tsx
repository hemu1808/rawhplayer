import { useState } from 'react';
import { useLibrary } from '../context/LibraryContext';

export function LibraryMaintenance() {
  const library = useLibrary();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const missing = library.state.tracks.filter((track) => track.missing);
  async function repair(id: string) {
    setBusy(true);
    try {
      await library.repairTrack(id);
      setMessage('File selection completed.');
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="glass-panel rounded-2xl p-6 space-y-4">
      <legend>Library maintenance</legend>
      {message && <p role="status">{message}</p>}
      <details>
        <summary>{missing.length} missing files</summary>
        <p className="text-sm text-neutral-400">Locate a moved file to preserve its playlists, favorites and listening history.</p>
        <ul className="max-h-64 overflow-auto space-y-3 mt-3">
          {missing.map((track) => (
            <li key={track.id} className="flex gap-3">
              <span className="flex-1 break-all">
                {track.name}
                <small className="block">{track.path}</small>
              </span>
              <button disabled={busy} onClick={() => void repair(track.id)}>
                Locate file
              </button>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>{library.duplicateGroups.length} possible duplicate groups</summary>
        <p className="text-sm text-neutral-400">
          Matches use metadata and duration. Compare paths before removing an entry. Audio files remain on disk; watched folders may import
          them again.
        </p>
        <div className="max-h-64 overflow-auto space-y-4 mt-3">
          {library.duplicateGroups.map((group) => (
            <ul key={group[0].id} className="border border-white/10 rounded-lg p-3 space-y-2">
              {group.map((track) => (
                <li key={track.id} className="flex gap-3">
                  <span className="flex-1 break-all">
                    {track.name}
                    <small className="block">{track.path}</small>
                  </span>
                  <button onClick={() => void library.removeTrack(track.id)} aria-label={`Remove library entry ${track.path}`}>
                    Remove entry
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
