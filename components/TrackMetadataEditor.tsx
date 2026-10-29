import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Track } from '../types';
import { useLibrary } from '../context/LibraryContext';
import { parseTrack } from '../services/libraryStore';

export function TrackMetadataEditor({ track, onClose }: { track: Track; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { addTracks } = useLibrary();
  const [values, setValues] = useState({
    name: track.name,
    artist: track.artist,
    album: track.album || '',
    genre: track.genre || '',
    year: track.year || '',
    trackNumber: track.trackNumber?.toString() || '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function apply(undo: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const result = parseTrack(
        await invoke(undo ? 'library_undo_metadata' : 'library_update_metadata', {
          trackId: track.id,
          ...(undo
            ? {}
            : {
                edit: {
                  ...values,
                  year: values.year ? Number(values.year) : null,
                  trackNumber: values.trackNumber ? Number(values.trackNumber) : null,
                },
              }),
        }),
      );
      addTracks([result]);
      setValues({
        name: result.name,
        artist: result.artist,
        album: result.album || '',
        genre: result.genre || '',
        year: result.year || '',
        trackNumber: result.trackNumber?.toString() || '',
      });
      setMessage(undo ? 'The previous file tags were restored.' : 'Tags saved. You can undo this edit.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const editable = Boolean(window.__TAURI_INTERNALS__) && !track.missing;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="metadata-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      className="bg-neutral-950 text-white border border-white/20 rounded-2xl p-6 w-[32rem] max-w-[95vw] backdrop:bg-black/70"
    >
      <h2 id="metadata-title" className="text-xl mb-3">
        Edit track metadata
      </h2>
      <p className="text-sm text-neutral-400 mb-4">
        Saving writes tags to the audio file. A local recovery copy supports undo. Audio files are never deleted by this editor.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void apply(false);
        }}
        className="space-y-3"
      >
        {(['name', 'artist', 'album', 'genre', 'year', 'trackNumber'] as const).map((field) => (
          <label className="block" key={field}>
            {{ name: 'Title', artist: 'Artist', album: 'Album', genre: 'Genre', year: 'Year', trackNumber: 'Track number' }[field]}
            <input
              className="block bg-neutral-900 border border-white/20 rounded p-2 w-full"
              value={values[field]}
              disabled={busy || !editable}
              required={field === 'name'}
              maxLength={4096}
              type={field === 'year' || field === 'trackNumber' ? 'number' : 'text'}
              min={field === 'year' || field === 'trackNumber' ? 1 : undefined}
              max={field === 'year' ? 9999 : field === 'trackNumber' ? 99999 : undefined}
              onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
            />
          </label>
        ))}
        {!editable && <p>Open an available local file in the desktop app to edit its tags.</p>}
        {message && <p role="status">{message}</p>}
        <div className="flex gap-4 pt-3">
          <button disabled={busy || !editable} type="submit">
            Save tags
          </button>
          <button disabled={busy || !editable} type="button" onClick={() => void apply(true)}>
            Undo last edit
          </button>
          <button disabled={busy} type="button" onClick={onClose}>
            Close editor
          </button>
        </div>
      </form>
    </dialog>
  );
}
