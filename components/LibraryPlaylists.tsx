import { useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { ScrollArea } from './ScrollArea';
import type { SmartRule } from '../types';

export function LibraryPlaylists() {
  const library = useLibrary();
  const [name, setName] = useState('');
  const [rule, setRule] = useState('manual');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [filters, setFilters] = useState<SmartRule>({});
  return (
    <ScrollArea title="Playlists" subtitle="Your collections, separate from the play queue">
      <div className="px-8 pb-28 space-y-6">
        <form
          className="flex gap-3 flex-wrap"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const smartRule =
                rule === 'manual'
                  ? undefined
                  : {
                      ...filters,
                      ...(rule === 'liked'
                        ? { likedOnly: true }
                        : rule === 'unplayed'
                          ? { unplayedOnly: true }
                          : rule === 'recent'
                            ? { addedWithinDays: 30 }
                            : {}),
                    };
              if (editing) library.updatePlaylist(editing, { name, smartRule });
              else library.createPlaylist(name, rule === 'manual' ? library.queueEntries.map((entry) => entry.trackId) : [], smartRule);
              setName('');
              setEditing(null);
              setFilters({});
              setError('');
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not create playlist');
            }
          }}
        >
          <input
            aria-label="Playlist name"
            required
            maxLength={256}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="bg-neutral-900 rounded-lg px-4 py-2"
            placeholder="Name your playlist"
          />
          <select
            aria-label="Playlist contents"
            value={rule}
            onChange={(event) => setRule(event.target.value)}
            className="bg-neutral-900 rounded-lg px-4 py-2"
          >
            <option value="manual">Save current queue</option>
            <option value="liked">Smart: favorites</option>
            <option value="unplayed">Smart: unplayed</option>
            <option value="recent">Smart: added this month</option>
            <option value="custom">Smart: custom rules</option>
          </select>
          <button className="rounded-lg bg-white text-black px-4 py-2">{editing ? 'Save playlist' : 'Create playlist'}</button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setName('');
                setFilters({});
              }}
            >
              Cancel editing
            </button>
          )}
          {rule !== 'manual' && (
            <fieldset className="w-full grid grid-cols-2 gap-3 border border-white/20 rounded-lg p-4">
              <legend>Match all rules</legend>
              {(['query', 'artist', 'genre', 'format'] as const).map((field) => (
                <label key={field} className="capitalize">
                  {field[0].toUpperCase() + field.slice(1)}
                  <input
                    className="block w-full bg-neutral-900 rounded p-2"
                    maxLength={512}
                    value={filters[field] || ''}
                    onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))}
                  />
                </label>
              ))}
              <label>
                Minimum sample rate (Hz)
                <input
                  className="block bg-neutral-900 rounded p-2 w-full"
                  type="number"
                  min="0"
                  max="768000"
                  value={filters.minSampleRate || ''}
                  onChange={(event) => setFilters((current) => ({ ...current, minSampleRate: Number(event.target.value) }))}
                />
              </label>
              <label>
                Added within days
                <input
                  className="block bg-neutral-900 rounded p-2 w-full"
                  type="number"
                  min="0"
                  max="36500"
                  value={filters.addedWithinDays || ''}
                  onChange={(event) => setFilters((current) => ({ ...current, addedWithinDays: Number(event.target.value) }))}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(filters.likedOnly)}
                  onChange={(event) => setFilters((current) => ({ ...current, likedOnly: event.target.checked }))}
                />{' '}
                Favorites only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(filters.unplayedOnly)}
                  onChange={(event) => setFilters((current) => ({ ...current, unplayedOnly: event.target.checked }))}
                />{' '}
                Unplayed only
              </label>
            </fieldset>
          )}
        </form>
        {error && <p role="alert">{error}</p>}
        {!library.playlists.length && (
          <p className="text-neutral-400">Save your queue or create a collection that updates as your library changes.</p>
        )}
        {library.playlists.map((playlist) => (
          <section key={playlist.id} className="rounded-2xl border border-white/10 p-5 flex justify-between gap-4">
            <div>
              <h2 className="font-semibold">{playlist.name}</h2>
              <p className="text-sm text-neutral-400">
                {library.getPlaylistTracks(playlist.id).length} tracks · {playlist.smartRule ? 'Smart playlist' : 'Saved playlist'}
              </p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  setEditing(playlist.id);
                  setName(playlist.name);
                  setRule(playlist.smartRule ? 'custom' : 'manual');
                  setFilters(playlist.smartRule || {});
                }}
                aria-label={`Edit ${playlist.name}`}
              >
                Edit
              </button>
              <button onClick={() => library.playPlaylist(playlist.id)} aria-label={`Play ${playlist.name}`}>
                Play
              </button>
              <button onClick={() => library.deletePlaylist(playlist.id)} aria-label={`Delete ${playlist.name}`}>
                Delete
              </button>
            </div>
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}
