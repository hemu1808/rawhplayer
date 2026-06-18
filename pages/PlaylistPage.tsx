import React, { memo } from 'react';
import { Track } from '../types';
import { Trash2, Shuffle, XCircle, AudioWaveform, History, ListStart, ArrowDown } from 'lucide-react';
import { ScrollArea } from '../components/ScrollArea';

interface PlaylistPageProps {
  tracks: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onSelect: (track: Track) => void;
  onRemove: (id: string) => void;
  onShuffle: () => void;
  onClear: () => void;
}

interface TrackRowProps {
  track: Track; 
  isHistory?: boolean; 
  isPlaying?: boolean;
  onSelect: (track: Track) => void;
  onRemove: (id: string) => void;
}

// Optimization: Memoized component defined OUTSIDE the parent
const TrackRow: React.FC<TrackRowProps> = memo(({ 
  track, 
  isHistory = false, 
  isPlaying = false,
  onSelect,
  onRemove
}) => (
    <div 
        role="button"
        tabIndex={0}
        aria-label={`${isHistory ? 'Previously played: ' : isPlaying ? 'Now Playing: ' : ''}Play ${track.name} by ${track.artist}`}
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(track);
            }
        }}
        className={`flex items-center gap-4 p-3 rounded-xl border transition-all duration-300 group cursor-pointer ${
            isPlaying
            ? 'bg-white/10 backdrop-blur-md border-primary-500/30 shadow-lg scale-[1.02] z-10' 
            : isHistory 
                ? 'opacity-50 hover:opacity-100 border-transparent hover:bg-white/5' 
                : 'bg-white/[0.02] border-white/5 hover:bg-white/10 hover:border-white/10'
        } focus:outline-none focus:ring-1 focus:ring-primary-500`}
        onClick={() => onSelect(track)}
    >
        <div className="w-10 h-10 rounded-lg bg-neutral-900 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center">
            {track.image ? (
                <img src={track.image} className={`w-full h-full object-cover ${isHistory ? 'grayscale' : ''}`} alt={`${track.name} album art`} />
            ) : (
                <AudioWaveform size={16} className="text-neutral-600" />
            )}
            {isPlaying && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="flex gap-0.5 items-end h-3">
                        <div className="w-1 bg-primary-500 h-full animate-[bounce_1s_infinite]" />
                        <div className="w-1 bg-primary-500 h-2/3 animate-[bounce_1.2s_infinite]" />
                        <div className="w-1 bg-primary-500 h-full animate-[bounce_0.8s_infinite]" />
                    </div>
                </div>
            )}
        </div>

        <div className="flex-1 min-w-0">
            <h3 className={`font-medium text-sm truncate ${isPlaying ? 'text-primary-400' : 'text-white'}`}>
                {track.name}
            </h3>
            <p className="text-xs text-neutral-500 truncate">{track.artist}</p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
            <span className="text-[9px] text-neutral-600 font-bold uppercase tracking-wider bg-black/20 px-1.5 py-0.5 rounded border border-white/5">{track.format || 'RAW'}</span>
            <button 
                onClick={(e) => { e.stopPropagation(); onRemove(track.id); }}
                className="w-6 h-6 flex items-center justify-center text-neutral-600 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                title="Remove from queue"
                aria-label={`Remove ${track.name} from queue`}
            >
                <Trash2 size={14} />
            </button>
        </div>
    </div>
));

TrackRow.displayName = 'TrackRow';

export const PlaylistPage: React.FC<PlaylistPageProps> = ({
  tracks,
  currentTrackId,
  isPlaying,
  onSelect,
  onRemove,
  onShuffle,
  onClear
}) => {
    
  const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
  const historyTracks = currentIndex > 0 ? tracks.slice(0, currentIndex) : [];
  const currentTrack = currentIndex !== -1 ? tracks[currentIndex] : null;
  const nextTracks = currentIndex !== -1 ? tracks.slice(currentIndex + 1) : tracks;

  // If no track is playing but list exists, show all as next
  const showAllAsNext = currentIndex === -1 && tracks.length > 0;

  const ActionButtons = (
    <div className="flex gap-2">
        <button 
           onClick={onShuffle}
           className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-full text-xs font-bold text-white transition-all hover:scale-105"
        >
           <Shuffle size={14} /> Shuffle
       </button>
       <button 
           onClick={onClear}
           className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/10 rounded-full text-xs font-bold text-red-400 hover:text-red-300 transition-all hover:scale-105"
       >
           <XCircle size={14} /> Clear
       </button>
   </div>
  );

  return (
    <ScrollArea title="Queue" subtitle={`${tracks.length} tracks`} action={ActionButtons}>
      <div className="px-6 md:px-8 space-y-6 pb-32">
        {tracks.length === 0 && (
            <div className="h-[60vh] flex flex-col items-center justify-center text-neutral-600 italic space-y-6">
                <div className="w-24 h-24 bg-white/5 rounded-3xl flex items-center justify-center border border-white/5">
                    <ListStart size={40} className="opacity-30" />
                </div>
                <p className="font-light tracking-wide">Queue is empty.</p>
            </div>
        )}

        {/* History Section */}
        {historyTracks.length > 0 && (
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-neutral-600 uppercase tracking-widest px-1">
                    <History size={12} /> Previously
                </div>
                {historyTracks.map(t => <TrackRow key={t.id} track={t} isHistory onSelect={onSelect} onRemove={onRemove} />)}
            </div>
        )}

        {/* Current Track */}
        {currentTrack && (
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-primary-500 uppercase tracking-widest px-1">
                    <AudioWaveform size={12} /> Now Playing
                </div>
                <TrackRow track={currentTrack} isPlaying onSelect={onSelect} onRemove={onRemove} />
            </div>
        )}

        {/* Up Next */}
        {(nextTracks.length > 0 || showAllAsNext) && (
            <div className="space-y-2">
                 <div className="flex items-center gap-2 text-xs font-bold text-neutral-400 uppercase tracking-widest px-1 pt-4 border-t border-white/5">
                    <ArrowDown size={12} /> Up Next
                </div>
                {(showAllAsNext ? tracks : nextTracks).map(t => <TrackRow key={t.id} track={t} onSelect={onSelect} onRemove={onRemove} />)}
            </div>
        )}
      </div>
    </ScrollArea>
  );
};