import React from 'react';
import { Track } from '../types';
import { Trash2, AudioWaveform, History, ListStart, ArrowDown, Shuffle, X } from 'lucide-react';

interface QueueSidebarProps {
  tracks: Track[];
  currentTrackId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (track: Track) => void;
  onRemove: (id: string) => void;
  onShuffle: () => void;
  onClear: () => void;
}

const QueueItem: React.FC<{ 
    track: Track; 
    isActive?: boolean; 
    isHistory?: boolean;
    onClick: () => void; 
    onRemove: () => void; 
}> = ({ track, isActive, isHistory, onClick, onRemove }) => (
    <div 
        className={`group flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all border ${
            isActive 
            ? 'bg-white/10 border-white/10' 
            : 'border-transparent hover:bg-white/5 hover:border-white/5'
        } ${isHistory ? 'opacity-50 grayscale hover:grayscale-0 hover:opacity-100' : ''}`}
        onClick={onClick}
    >
        <div className="relative w-10 h-10 rounded bg-neutral-900 overflow-hidden shrink-0 border border-white/10">
            {track.image ? (
                <img src={track.image} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5">
                    <AudioWaveform size={14} className="text-neutral-500" />
                </div>
            )}
            {isActive && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-1 h-3 bg-primary-500 animate-pulse" />
                </div>
            )}
        </div>
        <div className="flex-1 min-w-0">
            <div className={`text-xs font-medium truncate ${isActive ? 'text-primary-400' : 'text-neutral-200'}`}>
                {track.name}
            </div>
            <div className="text-[10px] text-neutral-500 truncate">{track.artist}</div>
        </div>
        <button 
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded text-neutral-500 transition-all"
        >
            <Trash2 size={12} />
        </button>
    </div>
);

export const QueueSidebar: React.FC<QueueSidebarProps> = ({ 
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

    return (
        <div className={`fixed top-0 right-0 bottom-24 w-80 bg-neutral-900/95 backdrop-blur-2xl border-l border-white/10 z-[60] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-2xl flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/20">
                <h2 className="text-xs font-bold uppercase tracking-widest text-white flex items-center gap-2">
                    <ListStart size={14} className="text-primary-500" /> Playing Next
                </h2>
                <div className="flex items-center gap-1">
                    <button onClick={onShuffle} className="p-2 hover:bg-white/10 rounded-lg text-neutral-400 hover:text-white transition-colors" title="Shuffle">
                        <Shuffle size={14} />
                    </button>
                    <button onClick={onClear} className="p-2 hover:bg-red-500/10 rounded-lg text-neutral-400 hover:text-red-400 transition-colors" title="Clear Queue">
                        <Trash2 size={14} />
                    </button>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-neutral-400 hover:text-white transition-colors md:hidden">
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
                {tracks.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-3 opacity-50">
                        <ListStart size={32} />
                        <span className="text-xs">Queue is empty</span>
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
                    <div className="space-y-1">
                        <div className="px-2 text-[10px] font-bold text-primary-500 uppercase tracking-widest flex items-center gap-2 mb-2 sticky top-0 bg-neutral-900/95 backdrop-blur py-2 z-10 border-b border-white/5">
                            <AudioWaveform size={10} /> Now Playing
                        </div>
                        <QueueItem track={currentTrack} isActive onClick={() => {}} onRemove={() => onRemove(currentTrack.id)} />
                    </div>
                )}

                {(nextTracks.length > 0 || showAllAsNext) && (
                    <div className="space-y-1">
                        <div className="px-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest flex items-center gap-2 mb-2 mt-4">
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