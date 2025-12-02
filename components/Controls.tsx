import React, { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Shuffle, Heart, Zap, ListMusic, Maximize2, Minimize2 } from 'lucide-react';
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
  onToggleExpand
}) => {
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [isHoveringTime, setIsHoveringTime] = useState(false);

  return (
    <div className="fixed bottom-0 left-0 right-0 h-24 bg-neutral-950/90 border-t border-white/5 backdrop-blur-3xl px-6 md:px-8 flex items-center justify-between z-[80] text-white shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
      
      {/* Left: Track Info */}
      <div className="flex items-center w-[30%] min-w-[240px] gap-4">
        {currentTrack ? (
             <div className="flex items-center gap-4 overflow-hidden group">
                 <div 
                    className="w-14 h-14 bg-gradient-to-br from-neutral-900 to-black rounded-lg flex items-center justify-center shrink-0 border border-white/10 shadow-lg relative overflow-hidden cursor-pointer hover:scale-105 transition-transform"
                    onClick={onToggleExpand}
                    style={customThumbnailGradient ? { background: customThumbnailGradient } : undefined}
                 >
                    {currentTrack.image ? (
                        <img src={currentTrack.image} alt="Art" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-white/5">
                            {state.isPlaying ? (
                                <div className="flex gap-0.5 items-end h-4 opacity-80">
                                    <div className="w-0.5 bg-primary-400 h-2 animate-[bounce_1s_infinite]" />
                                    <div className="w-0.5 bg-primary-400 h-4 animate-[bounce_1.2s_infinite]" />
                                    <div className="w-0.5 bg-primary-400 h-1.5 animate-[bounce_0.8s_infinite]" />
                                </div>
                            ) : (
                                <div className="text-neutral-700 text-[9px] font-bold tracking-widest">{currentTrack.format || 'FLAC'}</div>
                            )}
                        </div>
                    )}
                    {/* Expand overlay hint */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </div>
                 </div>
                 <div className="flex flex-col overflow-hidden justify-center">
                     <span className="text-base font-medium truncate text-white/90 group-hover:text-white transition cursor-default">{currentTrack.name}</span>
                     <span className="text-xs text-neutral-500 truncate group-hover:text-neutral-400 transition cursor-default font-light">{currentTrack.artist}</span>
                 </div>
                 <button 
                    onClick={onToggleLike}
                    className={`ml-2 transition-all duration-300 hover:scale-110 ${currentTrack.isLiked ? 'text-primary-500' : 'text-neutral-600 hover:text-white'}`}
                >
                     <Heart size={16} strokeWidth={currentTrack.isLiked ? 0 : 1.5} fill={currentTrack.isLiked ? "currentColor" : "none"} />
                 </button>
             </div>
        ) : (
            <div className="flex items-center gap-4 opacity-30 pointer-events-none">
                <div className="w-14 h-14 bg-white/5 rounded-lg" />
                <div className="space-y-2">
                    <div className="h-3 w-24 bg-white/10 rounded" />
                    <div className="h-2 w-16 bg-white/5 rounded" />
                </div>
            </div>
        )}
      </div>

      {/* Center: Controls */}
      <div className="flex flex-col items-center justify-center w-[40%] max-w-2xl z-20">
          <div className="flex items-center gap-6 mb-2">
            <button 
                onClick={onToggleMode} 
                className={`transition-all duration-300 ${playbackMode !== PlaybackMode.SEQUENCE ? 'text-primary-500 drop-shadow-[0_0_10px_rgba(var(--primary-500),0.4)]' : 'text-neutral-500 hover:text-white'}`}
            >
                {playbackMode === PlaybackMode.SHUFFLE ? <Shuffle size={16} strokeWidth={1.5} /> : <Repeat size={16} strokeWidth={1.5} />}
            </button>

            <button onClick={onPrev} className="text-neutral-400 hover:text-white transition-all hover:scale-105 active:scale-95">
                <SkipBack size={20} strokeWidth={1.5} fill="currentColor" className="opacity-80 hover:opacity-100" />
            </button>
            
            <button 
                onClick={onPlayPause}
                className="w-12 h-12 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.15)] hover:shadow-[0_0_25px_rgba(255,255,255,0.3)]"
            >
                {state.isPlaying ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" className="ml-0.5" strokeWidth={0} />}
            </button>

            <button onClick={onNext} className="text-neutral-400 hover:text-white transition-all hover:scale-105 active:scale-95">
                <SkipForward size={20} strokeWidth={1.5} fill="currentColor" className="opacity-80 hover:opacity-100" />
            </button>

            <div className="relative">
                <button 
                    onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                    className={`transition-colors hover:scale-105 ${state.playbackRate !== 1 ? 'text-primary-500' : 'text-neutral-500 hover:text-white'}`}
                    title="Playback Speed"
                >
                    <Zap size={16} strokeWidth={1.5} />
                </button>
                {showSpeedMenu && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 bg-black/90 border border-white/10 backdrop-blur-xl rounded-xl shadow-2xl py-2 min-w-[80px] flex flex-col gap-1 z-50 overflow-hidden">
                        {[0.5, 0.8, 1.0, 1.2, 1.5, 2.0].map(speed => (
                            <button
                                key={speed}
                                onClick={() => { onSpeedChange(speed); setShowSpeedMenu(false); }}
                                className={`px-4 py-1.5 text-xs font-medium text-left hover:bg-white/10 transition-colors ${state.playbackRate === speed ? 'text-primary-500' : 'text-white'}`}
                            >
                                {speed}x
                            </button>
                        ))}
                    </div>
                )}
            </div>
          </div>

          <div className="w-full flex items-center gap-3 text-xs font-mono text-neutral-500 group" onMouseEnter={() => setIsHoveringTime(true)} onMouseLeave={() => setIsHoveringTime(false)}>
              <span className={`w-10 text-right ${isHoveringTime ? 'text-white' : ''}`}>{formatTime(state.currentTime)}</span>
              <div className="flex-1 h-1 bg-white/10 rounded-full relative cursor-pointer group/bar">
                  <div 
                    className="absolute inset-y-0 left-0 bg-white rounded-full group-hover/bar:bg-primary-500 transition-colors"
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

      {/* Right: Volume & Queue */}
      <div className="flex items-center justify-end w-[30%] min-w-[240px] gap-4">
          <button 
            onClick={onToggleMute}
            className="text-neutral-500 hover:text-white transition-colors"
          >
              {state.isMuted || state.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <div className="w-24 h-1 bg-white/10 rounded-full relative group cursor-pointer hidden xl:block">
              <div 
                className="absolute inset-y-0 left-0 bg-white group-hover:bg-primary-500 rounded-full transition-colors"
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
          
          <div className="h-6 w-px bg-white/10 mx-2" />
          
          <button 
            onClick={onToggleQueue}
            className={`transition-colors p-2 rounded-lg ${showQueue ? 'text-primary-500 bg-white/5' : 'text-neutral-500 hover:text-white'}`}
            title="Toggle Queue"
          >
            <ListMusic size={20} />
          </button>
      </div>

    </div>
  );
};