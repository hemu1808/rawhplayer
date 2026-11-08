import { useEffect, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { commands, type MaintenancePage } from '../services/generated/native';
import { parseTrack } from '../services/libraryStore';

export function LibraryMaintenance() {
  const library = useLibrary();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<MaintenancePage | null>(null);
  const [missingOffset, setMissingOffset] = useState(0);
  const [duplicateOffset, setDuplicateOffset] = useState(0);
  const { ready, catalogRevision } = library;
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__ || !ready) return;
    let active = true;
    void commands
      .libraryMaintenance(missingOffset, duplicateOffset)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch(() => {
        if (active) setMessage('Could not load library maintenance results.');
      });
    return () => {
      active = false;
    };
  }, [ready, catalogRevision, missingOffset, duplicateOffset]);
  const missing = page ? page.missing.map(parseTrack) : library.state.tracks.filter((track) => track.missing);
  const duplicates = page ? page.duplicates.map((group) => group.tracks.map(parseTrack)) : library.duplicateGroups;
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
        <summary>{page?.missingTotal ?? missing.length} missing files</summary>
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
        {page && (
          <div className="flex gap-4 text-sm">
            <button disabled={!missingOffset} onClick={() => setMissingOffset(Math.max(0, missingOffset - 100))}>
              Previous missing files
            </button>
            <button disabled={missingOffset + 100 >= page.missingTotal} onClick={() => setMissingOffset(missingOffset + 100)}>
              Next missing files
            </button>
          </div>
        )}
      </details>
      <details>
        <summary>{page?.duplicateTotal ?? duplicates.length} possible duplicate groups</summary>
        <p className="text-sm text-neutral-400">
          Matches use metadata and duration. Compare paths before removing an entry. Audio files remain on disk; watched folders may import
          them again.
        </p>
        <div className="max-h-64 overflow-auto space-y-4 mt-3">
          {duplicates.map((group) => (
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
        {page && (
          <>
            <p className="text-xs text-neutral-400">Showing up to 50 entries per group. Remove an entry to reveal further matches.</p>
            <div className="flex gap-4 text-sm">
              <button disabled={!duplicateOffset} onClick={() => setDuplicateOffset(Math.max(0, duplicateOffset - 10))}>
                Previous duplicate groups
              </button>
              <button disabled={duplicateOffset + 10 >= page.duplicateTotal} onClick={() => setDuplicateOffset(duplicateOffset + 10)}>
                Next duplicate groups
              </button>
            </div>
          </>
        )}
      </details>
    </fieldset>
  );
}
