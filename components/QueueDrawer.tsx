
import React, { useRef, useEffect } from 'react';
import { Track } from '../types';
import { Trash2, AudioWaveform, History, ListStart, ArrowDown, Shuffle, X, GripVertical } from 'lucide-react';

interface QueueDrawerProps {
  tracks: Track[];
  currentTrackId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (track: Track) => void;
  onRemove: (id: string) => void;
  onShuffle: () => void;
  onClear: () => void;
}

export const QueueItem: React.FC<{ 
    track: Track; 
    isActive?: boolean; 
    isHistory?: boolean;
    onClick: () => void; 
    onRemove: () => void; 
}> = ({ track, isActive, isHistory, onClick, onRemove }) => (
    <div 
        role="button"
        tabIndex={0}
        aria-label={`${isHistory ? 'History: ' : isActive ? 'Now Playing: ' : ''}Play ${track.name} by ${track.artist}`}
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
            }
        }}
        className={`group flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all border ${
            isActive 
            ? 'bg-white/10 border-white/10 shadow-lg' 
            : 'border-transparent hover:bg-white/5 hover:border-white/5'
        } ${isHistory ? 'opacity-50 grayscale hover:grayscale-0 hover:opacity-100' : ''} focus:outline-none focus:ring-1 focus:ring-primary-500`}
        onClick={onClick}
    >
        <div className="relative w-10 h-10 rounded-lg bg-neutral-900 overflow-hidden shrink-0 border border-white/10">
            {track.image ? (
                <img src={track.image} alt={`${track.name} album art`} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5">
                    <AudioWaveform size={14} className="text-neutral-500" />
                </div>
            )}
            {isActive && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="flex gap-0.5 items-end h-3">
                        <div className="w-1 bg-primary-500 h-full animate-[bounce_1s_infinite]" />
                        <div className="w-1 bg-primary-500 h-2/3 animate-[bounce_1.2s_infinite]" />
                        <div className="w-1 bg-primary-500 h-full animate-[bounce_0.8s_infinite]" />
                    </div>
                </div>
            )}
        </div>
        <div className="flex-1 min-w-0">
            <div className={`text-xs font-medium truncate ${isActive ? 'text-primary-400' : 'text-neutral-200'}`}>
                {track.name}
            </div>
            <div className="text-[10px] text-neutral-500 truncate">{track.artist}</div>
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="p-1.5 text-neutral-600 hover:text-white cursor-grab active:cursor-grabbing"><GripVertical size={12}/></button>
            <button 
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded text-neutral-500 transition-all"
            >
                <Trash2 size={12} />
            </button>
        </div>
    </div>
);

export const QueueDrawer: React.FC<QueueDrawerProps> = ({ 
    tracks, 
    currentTrackId, 
    isOpen, 
    onClose,
    onSelect, 
    onRemove,
    onShuffle,
    onClear
}) => {
    const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
    const historyTracks = currentIndex > 0 ? tracks.slice(0, currentIndex) : [];
    const currentTrack = currentIndex !== -1 ? tracks[currentIndex] : null;
    const nextTracks = currentIndex !== -1 ? tracks.slice(currentIndex + 1) : tracks;
    const showAllAsNext = currentIndex === -1 && tracks.length > 0;
    const drawerRef = useRef<HTMLDivElement>(null);

    // Close on click outside (if needed) or escape
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => { if(e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    return (
        <div 
            ref={drawerRef}
            className={`fixed right-0 bottom-24 top-0 w-full md:w-[400px] bg-neutral-900/95 backdrop-blur-3xl border-l border-white/10 z-[70] shadow-2xl flex flex-col transition-transform duration-500 cubic-bezier(0.32, 0.72, 0, 1) ${
                isOpen ? 'translate-x-0' : 'translate-x-[110%]'
            }`}
        >
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-500/10 rounded-lg text-primary-500">
                        <ListStart size={18} />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-white tracking-wide">Play Queue</h2>
                        <p className="text-[10px] text-neutral-500">{tracks.length} tracks</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button 
                        onClick={onShuffle} 
                        className="p-2 hover:bg-white/10 rounded-lg text-neutral-400 hover:text-white transition-colors" 
                        title="Shuffle"
                        aria-label="Shuffle queue"
                    >
                        <Shuffle size={16} />
                    </button>
                    <button 
                        onClick={onClear} 
                        className="p-2 hover:bg-red-500/10 rounded-lg text-neutral-400 hover:text-red-400 transition-colors" 
                        title="Clear Queue"
                        aria-label="Clear queue"
                    >
                        <Trash2 size={16} />
                    </button>
                    <button 
                        onClick={onClose} 
                        className="p-2 hover:bg-white/10 rounded-lg text-neutral-400 hover:text-white transition-colors ml-2"
                        aria-label="Close queue"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 pb-8 space-y-4">
                {tracks.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-3 opacity-50">
                        <ListStart size={48} strokeWidth={1} />
                        <span className="text-xs tracking-widest uppercase">Queue is empty</span>
                    </div>
                )}

                {historyTracks.length > 0 && (
                    <div className="space-y-1">
                        <div className="px-2 text-[10px] font-bold text-neutral-600 uppercase tracking-widest flex items-center gap-2 mb-2">
                            <History size={10} /> History
                        </div>
                        {historyTracks.map(t => (
                            <QueueItem key={t.id} track={t} isHistory onClick={() => onSelect(t)} onRemove={() => onRemove(t.id)} />
                        ))}
                    </div>
                )}

                {currentTrack && (
                    <div className="space-y-1 sticky top-0 z-10 -mx-3 px-3 py-2 bg-neutral-900/95 backdrop-blur border-y border-white/5 shadow-md">
                        <div className="px-2 text-[10px] font-bold text-primary-500 uppercase tracking-widest flex items-center gap-2 mb-2">
                            <AudioWaveform size={10} /> Now Playing
                        </div>
                        <QueueItem track={currentTrack} isActive onClick={() => {}} onRemove={() => onRemove(currentTrack.id)} />
                    </div>
                )}

                {(nextTracks.length > 0 || showAllAsNext) && (
                    <div className="space-y-1 mt-2">
                        <div className="px-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest flex items-center gap-2 mb-2">
                            <ArrowDown size={10} /> Up Next
                        </div>
                        {(showAllAsNext ? tracks : nextTracks).map(t => (
                            <QueueItem key={t.id} track={t} onClick={() => onSelect(t)} onRemove={() => onRemove(t.id)} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
