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
import { QueueItem } from './QueueDrawer';

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