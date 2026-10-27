import React from 'react';
import { Track, AudioState } from '../types';
import { Play, Pause, SkipForward, Maximize2 } from 'lucide-react';

interface MiniPlayerProps {
  track: Track | null;
  audioState: AudioState;
  onPlayPause: () => void;
  onNext: () => void;
  onMaximize: () => void;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({ track, audioState, onPlayPause, onNext, onMaximize }) => {
  if (!track) return null;
  
  const progressPercent = audioState.duration > 0 ? (audioState.currentTime / audioState.duration) * 100 : 0;

  return (
    <div className="fixed bottom-4 right-4 bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl flex items-center gap-4 w-[320px] z-50">
      <div className="w-14 h-14 rounded-lg bg-neutral-800 overflow-hidden flex-shrink-0">
        {track.image ? (
          <img src={track.image} alt={track.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-primary-500/20" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-bold text-sm truncate">{track.name}</h4>
        <p className="text-xs text-white/50 truncate">{track.artist}</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onPlayPause} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
          {audioState.isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
        <button onClick={onNext} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/70 hover:text-white">
          <SkipForward size={16} />
        </button>
        <button onClick={onMaximize} className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white ml-1">
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-primary-500" style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
};
