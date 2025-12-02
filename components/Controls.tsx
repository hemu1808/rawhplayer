
import React, { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Shuffle, Heart, Zap, ListMusic } from 'lucide-react';
import { AudioState, PlaybackMode, Track } from '../types';

interface ControlsProps {
  state: AudioState;
  currentTrack: Track | undefined;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  playbackMode: PlaybackMode;
  onToggleMode: () => void;
  onToggleLike: () => void;
  onSpeedChange: (speed: number) => void;
  customThumbnailGradient?: string | null;
  showQueue?: boolean;
  onToggleQueue?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const formatTime = (seconds: number) => {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const Controls: React.FC<ControlsProps> = ({
  state,
  currentTrack,
  onPlayPause,
  onNext,
  onPrev,
  onSeek,
  onVolumeChange,
  onToggleMute,
  playbackMode,
  onToggleMode,
  onToggleLike,
  onSpeedChange,
  customThumbnailGradient,
  showQueue,
  onToggleQueue,
  isExpanded,
  onToggleExpand,
}) => {
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [isHoveringTime, setIsHoveringTime] = useState(false);

  return (
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-neutral-950/80 border-t border-white/5 backdrop-blur-2xl px-6 md:px-8 flex items-center justify-between z-[80] text-white transition-all duration-300">
      
      {/* Left: Track Info */}
      <div className="flex items-center w-[30%] min-w-[240px] gap-4">
        {currentTrack ? (
             <div className="flex items-center gap-4 overflow-hidden group">
                 <div 
                    className="w-12 h-12 bg-neutral-900 rounded-md flex items-center justify-center shrink-0 border border-white/10 relative overflow-hidden cursor-pointer"
                    onClick={onToggleExpand}
                 >
                    {currentTrack.image ? (
                        <img src={currentTrack.image} alt="Art" className="w-full h-full object-cover" />
                    ) : (
                        <div className="text-[10px] font-bold text-neutral-500">{currentTrack.format || 'FILE'}</div>
                    )}
                 </div>
                 <div className="flex flex-col overflow-hidden justify-center">
                     <span className="text-sm font-medium truncate text-white/90 cursor-default">{currentTrack.name}</span>
                     <span className="text-xs text-neutral-500 truncate font-light">{currentTrack.artist}</span>
                 </div>
             </div>
        ) : (
             <div className="text-xs text-neutral-600 font-mono">READY</div>
        )}
      </div>

      {/* Center: Controls */}
      <div className="flex flex-col items-center justify-center w-[40%] max-w-2xl z-20">
          <div className="flex items-center gap-6 mb-2">
            <button onClick={onPrev} className="text-neutral-400 hover:text-white transition-all hover:scale-105 active:scale-95">
                <SkipBack size={18} fill="currentColor" />
            </button>
            
            <button 
                onClick={onPlayPause}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-all shadow-[0_0_15px_rgba(255,255,255,0.1)]"
            >
                {state.isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
            </button>

            <button onClick={onNext} className="text-neutral-400 hover:text-white transition-all hover:scale-105 active:scale-95">
                <SkipForward size={18} fill="currentColor" />
            </button>
          </div>

          <div className="w-full flex items-center gap-3 text-xs font-mono text-neutral-500 group" onMouseEnter={() => setIsHoveringTime(true)} onMouseLeave={() => setIsHoveringTime(false)}>
              <span className={`w-10 text-right ${isHoveringTime ? 'text-white' : ''}`}>{formatTime(state.currentTime)}</span>
              <div className="flex-1 h-1 bg-white/10 rounded-full relative cursor-pointer group/bar">
                  <div 
                    className="absolute inset-y-0 left-0 bg-primary-500 rounded-full transition-all duration-75"
                    style={{ width: `${(state.currentTime / (state.duration || 1)) * 100}%` }}
                  />
                  <input
                    type="range"
                    min="0"
                    max={state.duration || 1}
                    value={state.currentTime}
                    onChange={(e) => onSeek(Number(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
              </div>
              <span className="w-10">{formatTime(state.duration)}</span>
          </div>
      </div>

      {/* Right: Volume & Tools */}
      <div className="flex items-center justify-end w-[30%] min-w-[240px] gap-3">
          <button onClick={onToggleMute} className="text-neutral-500 hover:text-white">
              {state.isMuted || state.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <div className="w-20 h-1 bg-white/10 rounded-full relative group cursor-pointer hidden xl:block">
              <div 
                className="absolute inset-y-0 left-0 bg-white group-hover:bg-primary-500 rounded-full"
                style={{ width: `${state.isMuted ? 0 : state.volume * 100}%` }}
              />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={state.isMuted ? 0 : state.volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
          </div>
          
          <div className="h-4 w-px bg-white/10 mx-2" />

          <button 
            onClick={onToggleQueue}
            className={`transition-colors p-2 rounded-lg ${showQueue ? 'text-primary-500 bg-white/5' : 'text-neutral-500 hover:text-white'}`}
            title="Queue"
          >
            <ListMusic size={18} />
          </button>
      </div>
    </div>
  );
};
