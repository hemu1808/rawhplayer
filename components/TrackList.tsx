import React from 'react';
import { Track } from '../types';
import { ListMusic, Plus, Trash2, Play, Heart, Music, Search } from 'lucide-react';

interface TrackListProps {
  tracks: Track[];
  currentTrackId: string | null;
  onSelect: (track: Track) => void;
  onRemove: (id: string) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const formatTime = (seconds?: number) => {
  if (seconds === undefined || seconds === null || isNaN(seconds) || !isFinite(seconds) || seconds === 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const TrackList: React.FC<TrackListProps> = ({ 
  tracks, 
  currentTrackId, 
  onSelect, 
  onRemove,
  onUpload
}) => {
  const [filter, setFilter] = React.useState('');

  const filteredTracks = React.useMemo(() => {
    return tracks.filter(track => 
      track.name.toLowerCase().includes(filter.toLowerCase()) ||
      track.artist.toLowerCase().includes(filter.toLowerCase())
    );
  }, [tracks, filter]);

  return (
    <div className="flex flex-col h-full w-full md:w-[340px] shrink-0 border-l border-white/5 bg-black/40 backdrop-blur-xl shadow-2xl relative">
      {/* Glossy Overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
      
      {/* Header */}
      <div className="p-6 z-10">
        <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3 text-white/90">
                <ListMusic size={18} strokeWidth={1.5} />
                <span className="font-medium tracking-wide text-sm uppercase">Your Collection</span>
            </div>
            <label className="p-2 bg-white/5 hover:bg-amber-500/20 border border-white/5 hover:border-amber-500/30 rounded-full cursor-pointer transition-all duration-300 text-neutral-400 hover:text-amber-400 group shadow-lg" title="Add Music">
                 <Plus size={16} strokeWidth={1.5} className="group-hover:rotate-90 transition-transform duration-300" />
                 <input 
                    type="file" 
                    accept="audio/*,.flac,.mp3,.wav,.ogg" 
                    multiple 
                    className="hidden" 
                    onChange={onUpload}
                />
            </label>
        </div>
        
        {/* Search Placeholder / Filter */}
        <div className="relative mb-4 group">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 group-focus-within:text-white transition-colors" strokeWidth={1.5} />
            <input 
                type="text" 
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tracks..." 
                className="w-full bg-black/20 border border-white/5 focus:border-white/20 rounded-lg py-2 pl-9 pr-4 text-xs text-white placeholder:text-neutral-600 outline-none transition-all"
            />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1 custom-scrollbar z-10">
        {filteredTracks.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-48 text-center p-6 border border-dashed border-white/5 rounded-xl mx-3 bg-white/[0.02]">
                <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-4 text-neutral-600">
                    <Music size={20} strokeWidth={1} />
                </div>
                <h3 className="font-medium text-white/80 mb-1 text-sm">{filter ? 'No results found' : 'Library Empty'}</h3>
                <p className="text-[11px] text-neutral-500 font-light">
                    {filter ? 'Try a different filter term' : 'Drag files here to play'}
                </p>
            </div>
        ) : (
            filteredTracks.map((track, index) => (
            <div 
                key={track.id}
                role="button"
                tabIndex={0}
                aria-label={`${currentTrackId === track.id ? 'Now Playing: ' : ''}Play ${track.name} by ${track.artist}`}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(track);
                    }
                }}
                className={`group relative flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-300 border ${
                    currentTrackId === track.id 
                    ? 'bg-white/10 border-white/10 shadow-lg backdrop-blur-md' 
                    : 'border-transparent hover:bg-white/5 hover:border-white/5'
                } focus:outline-none focus:ring-1 focus:ring-primary-500`}
                onClick={() => onSelect(track)}
            >
                {/* Track Number / Playing Indicator */}
                <div className="w-6 flex justify-center shrink-0 text-neutral-600 text-[10px] font-mono">
                    {currentTrackId === track.id ? (
                         <div className="flex gap-0.5 items-end h-3">
                            <div className="w-0.5 bg-amber-500 h-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-0.5 bg-amber-500 h-2/3 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-0.5 bg-amber-500 h-full animate-bounce" style={{ animationDelay: '300ms' }} />
                         </div>
                    ) : (
                        <span className="group-hover:hidden font-light">{index + 1}</span>
                    )}
                    <Play size={10} className="hidden group-hover:block text-white fill-white" />
                </div>

                <div className="min-w-0 flex-1">
                    <div className={`font-medium truncate text-sm mb-0.5 transition-colors ${currentTrackId === track.id ? 'text-amber-400' : 'text-neutral-300 group-hover:text-white'}`}>
                        {track.name}
                    </div>
                    <div className="text-[11px] text-neutral-500 truncate group-hover:text-neutral-400 font-light">
                        {track.artist}
                    </div>
                </div>

                <div className="text-[10px] font-mono text-neutral-600 group-hover:text-neutral-500 mr-2 min-w-[30px] text-right">
                    {formatTime(track.duration)}
                </div>

                {track.isLiked && <Heart size={12} className="text-amber-500 fill-amber-500 shrink-0 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />}

                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove(track.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-2 text-neutral-500 hover:text-red-400 transition absolute right-2 hover:bg-white/10 rounded-md bg-black/50 backdrop-blur-sm focus:opacity-100"
                    title="Remove"
                    aria-label={`Remove ${track.name} from collection`}
                >
                    <Trash2 size={12} strokeWidth={1.5} />
                </button>
            </div>
            ))
        )}
      </div>
    </div>
  );
};