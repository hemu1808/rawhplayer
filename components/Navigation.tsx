import { AudioLines, Disc3, FolderOpen, ListMusic, Search, Settings, SlidersHorizontal } from 'lucide-react';

const destinations = [
  { id: 'player', icon: Disc3, label: 'Now playing', accessible: 'Player' },
  { id: 'files', icon: FolderOpen, label: 'Library', accessible: 'Library' },
  { id: 'playlist', icon: ListMusic, label: 'Playlists', accessible: 'Playlist' },
  { id: 'search', icon: Search, label: 'Search', accessible: 'Search' },
  { id: 'audiophile', icon: AudioLines, label: 'Audio', accessible: 'Audio' },
  { id: 'settings', icon: Settings, label: 'Settings', accessible: 'Setup' },
] as const;

export type PlayerPage = (typeof destinations)[number]['id'];

interface NavigationProps {
  activePage: PlayerPage;
  onNavigate: (page: PlayerPage) => void;
  onEqualizer: () => void;
  equalizerOpen: boolean;
}

export function Navigation({ activePage, onNavigate, onEqualizer, equalizerOpen }: NavigationProps) {
  return (
    <nav className="player-nav" aria-label="Main navigation">
      {destinations.map(({ id, icon: Icon, label, accessible }) => (
        <button
          key={id}
          type="button"
          onClick={() => onNavigate(id)}
          aria-label={`Go to ${accessible} page`}
          aria-current={activePage === id ? 'page' : undefined}
          title={label}
        >
          <Icon size={19} />
          <span>{label}</span>
        </button>
      ))}
      <button type="button" onClick={onEqualizer} aria-haspopup="dialog" aria-expanded={equalizerOpen} title="Equalizer">
        <SlidersHorizontal size={19} />
        <span>Equalizer</span>
      </button>
    </nav>
  );
}
