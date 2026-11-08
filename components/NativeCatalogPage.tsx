import { useEffect, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { errorMessage } from '../context/PlayerContext';
import { ScrollArea } from './ScrollArea';
import { TrackMetadataEditor } from './TrackMetadataEditor';
import type { Track } from '../types';
import { commands, type CatalogGroup, type CatalogSort } from '../services/generated/native';

export function NativeCatalogPage({
  onPlay,
  onImport,
  search = false,
}: {
  onPlay: (track: Track) => void;
  onImport?: (folder: boolean) => void;
  search?: boolean;
}) {
  const { queryCatalog, catalogRevision, ready, enqueueTrack, removeTrack, toggleLike, state } = useLibrary();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CatalogSort>('recent');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ tracks: Track[]; total: number }>({ tracks: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Track | null>(null);
  const [group, setGroup] = useState<'tracks' | 'artist' | 'album'>('tracks');
  const [groups, setGroups] = useState<CatalogGroup[]>([]);
  const [filter, setFilter] = useState<{ artist?: string; album?: string }>({});
  const [favorites, setFavorites] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      const request =
        group === 'tracks'
          ? queryCatalog({ search: query || null, sort, offset, limit: 100, ...filter, favoritesOnly: favorites }).then((page) => {
              if (active) setResult(page);
            })
          : commands.libraryGroups(group, offset).then((rows) => {
              if (active) setGroups(rows);
            });
      void request
        .catch((reason) => {
          if (active) setError(errorMessage(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [queryCatalog, catalogRevision, ready, query, sort, offset, group, filter, favorites]);
  const cached = new Map(state.tracks.map((track) => [track.id, track]));
  return (
    <ScrollArea
      title={search ? 'Search' : 'Library'}
      subtitle={group === 'tracks' ? `${result.total.toLocaleString()} items` : `Browse by ${group}`}
      action={
        onImport && (
          <div className="flex gap-4">
            <button onClick={() => onImport(false)}>Import files</button>
            <button onClick={() => onImport(true)}>Import folder</button>
          </div>
        )
      }
    >
      <div className="px-6 pb-28 space-y-5">
        <div className="flex flex-wrap gap-3">
          <input
            aria-label="Search library"
            placeholder="Search your entire library"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
              setGroup('tracks');
            }}
            maxLength={500}
            className="bg-neutral-900 rounded-lg p-3 flex-1 min-w-40"
          />
          <select
            aria-label="Sort library"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as CatalogSort);
              setOffset(0);
            }}
            className="bg-neutral-900 rounded-lg p-3"
          >
            <option value="recent">Recent</option>
            <option value="title">Title A–Z</option>
            <option value="artist">Artist A–Z</option>
          </select>
          <select
            aria-label="Browse library"
            value={group}
            onChange={(event) => {
              setGroup(event.target.value as typeof group);
              setOffset(0);
              setFilter({});
            }}
            className="bg-neutral-900 rounded-lg p-3"
          >
            <option value="tracks">Tracks</option>
            <option value="artist">Artists</option>
            <option value="album">Albums</option>
          </select>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={favorites}
              onChange={(event) => {
                setFavorites(event.target.checked);
                setOffset(0);
                setGroup('tracks');
              }}
            />
            Favorites
          </label>
        </div>
        {(filter.artist !== undefined || filter.album !== undefined) && (
          <button
            onClick={() => {
              setFilter({});
              setOffset(0);
            }}
          >
            Clear {filter.artist || filter.album || 'Unknown'} filter
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        <p role="status" className="text-sm text-neutral-400">
          {loading
            ? 'Loading…'
            : group === 'tracks'
              ? `${result.total ? offset + 1 : 0}–${Math.min(offset + 100, result.total)} of ${result.total.toLocaleString()}`
              : `${offset + 1}–${offset + groups.length}`}
        </p>
        {group !== 'tracks' ? (
          <ul className="grid sm:grid-cols-2 gap-3">
            {groups.map((item) => (
              <li key={item.name}>
                <button
                  className="text-left w-full border border-white/10 rounded-xl p-4"
                  aria-label={`Browse ${group} ${item.name || 'Unknown'} (${item.tracks} tracks)`}
                  onClick={() => {
                    setFilter({ [group]: item.name });
                    setGroup('tracks');
                    setOffset(0);
                  }}
                >
                  <span className="block">{item.name || 'Unknown'}</span>
                  <span className="text-neutral-400 text-sm">{item.tracks} tracks</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ol className="divide-y divide-white/10">
            {result.tracks.map((row) => {
              const track = cached.get(row.id) ?? row;
              return (
                <li key={track.id} className="py-3 flex flex-wrap gap-3 items-center">
                  <button
                    onClick={() => onPlay(track)}
                    aria-label={`Play ${track.name} by ${track.artist}`}
                    className="text-left flex-1 min-w-48"
                  >
                    <span className="block font-medium">{track.name}</span>
                    <span className="text-xs text-neutral-400">
                      {track.artist} · {track.album || 'Unknown album'} · {track.format || 'Audio'}
                      {track.missing ? ' · Missing file' : ''}
                    </span>
                    {track.analysis && (
                      <span className="block text-xs text-neutral-400">
                        {track.analysis.bpm ? `≈ ${Math.round(track.analysis.bpm)} BPM · ` : ''}
                        {track.analysis.musicalKey || 'Key undetermined'}
                        {track.analysis.integratedLufs !== null ? ` · ${track.analysis.integratedLufs.toFixed(1)} LUFS` : ''}
                      </span>
                    )}
                  </button>
                  <button aria-label={`Favorite ${track.name}`} aria-pressed={!!track.isLiked} onClick={() => toggleLike(track.id)}>
                    {track.isLiked ? '♥' : '♡'}
                  </button>
                  <button className="text-xs" onClick={() => enqueueTrack(track.id, true)}>
                    Play next
                  </button>
                  <button className="text-xs" onClick={() => enqueueTrack(track.id)}>
                    Add to queue
                  </button>
                  <button className="text-xs" onClick={() => setEditing(track)}>
                    Edit tags
                  </button>
                  <button className="text-xs" onClick={() => void removeTrack(track.id)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {!loading && group === 'tracks' && !result.total && (
          <p className="text-neutral-400">
            {query ? 'No tracks match this search.' : 'Import files or a music folder to build your library.'}
          </p>
        )}
        <nav aria-label="Library pages" className="flex gap-5">
          <button disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - 100))}>
            Previous
          </button>
          <button
            disabled={loading || (group === 'tracks' ? offset + 100 >= result.total : groups.length < 100)}
            onClick={() => setOffset(offset + 100)}
          >
            Next
          </button>
        </nav>
      </div>
      {editing && <TrackMetadataEditor track={editing} onClose={() => setEditing(null)} />}
    </ScrollArea>
  );
}
