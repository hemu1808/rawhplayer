import {
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat1,
  ListOrdered,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { PLAYBACK_RATES } from '../config';
import { PlaybackMode, type AudioState, type Track } from '../types';
import { SeekBar } from './SeekBar';
import { TrackArtwork } from './TrackArtwork';

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
  showQueue: boolean;
  onToggleQueue: () => void;
  showEq: boolean;
  onEqualizer: () => void;
  onOpenPlayer: () => void;
}

const modes = {
  [PlaybackMode.SEQUENCE]: { label: 'In order', icon: ListOrdered },
  [PlaybackMode.LOOP]: { label: 'Repeat track', icon: Repeat1 },
  [PlaybackMode.SHUFFLE]: { label: 'Shuffle', icon: Shuffle },
};

export function Controls({
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
  showQueue,
  onToggleQueue,
  showEq,
  onEqualizer,
  onOpenPlayer,
}: ControlsProps) {
  const { icon: ModeIcon, label: modeLabel } = modes[playbackMode];
  const volume = state.isMuted ? 0 : state.volume;
  const rates: readonly number[] = PLAYBACK_RATES.includes(state.playbackRate as (typeof PLAYBACK_RATES)[number])
    ? PLAYBACK_RATES
    : [...PLAYBACK_RATES, state.playbackRate].sort((a, b) => a - b);
  return (
    <footer className="transport">
      <div className="transport-track">
        <button className="transport-artwork" onClick={onOpenPlayer} aria-label="Open now playing" title="Now playing">
          <TrackArtwork src={currentTrack?.image} />
        </button>
        <div className="transport-meta">
          <p>{currentTrack?.name || 'No track selected'}</p>
          {currentTrack?.artist && <span>{currentTrack.artist}</span>}
        </div>
        {currentTrack && (
          <button
            className="icon-button transport-favorite"
            aria-label="Toggle favorite"
            aria-pressed={Boolean(currentTrack.isLiked)}
            onClick={onToggleLike}
            title="Favorite"
          >
            <Heart size={17} fill={currentTrack.isLiked ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      <div className="transport-center">
        <div className="transport-buttons">
          <button
            className="icon-button"
            aria-label="Cycle playback mode"
            onClick={onToggleMode}
            title={modeLabel}
            data-active={playbackMode !== PlaybackMode.SEQUENCE}
          >
            <ModeIcon size={16} />
          </button>
          <button className="icon-button" aria-label="Previous track" onClick={onPrev} title="Previous track">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button className="transport-play" onClick={onPlayPause} aria-label={state.isPlaying ? 'Pause' : 'Play'}>
            {state.isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button className="icon-button" aria-label="Next track" onClick={onNext} title="Next track">
            <SkipForward size={18} fill="currentColor" />
          </button>
          <select
            className="transport-speed"
            aria-label="Playback speed"
            value={state.playbackRate}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
          >
            {rates.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </div>
        <SeekBar key={currentTrack?.id} time={state.currentTime} duration={state.duration} onSeek={onSeek} />
      </div>

      <div className="transport-tools">
        <button
          className="icon-button"
          aria-label="Open equalizer"
          aria-haspopup="dialog"
          aria-expanded={showEq}
          onClick={onEqualizer}
          title="Equalizer"
        >
          <SlidersHorizontal size={18} />
        </button>
        <button className="icon-button" aria-label="Queue" aria-expanded={showQueue} onClick={onToggleQueue} title="Play queue">
          <ListMusic size={20} />
        </button>
        <div className="transport-volume">
          <button
            className="icon-button"
            onClick={onToggleMute}
            aria-label={state.isMuted ? 'Unmute' : 'Mute'}
            title={state.isMuted ? 'Unmute' : 'Mute'}
          >
            {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            className="player-range volume-input"
            style={{ '--range-progress': `${volume * 100}%` } as CSSProperties}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolumeChange(e.currentTarget.valueAsNumber)}
            aria-label="Volume level"
            aria-valuetext={`${Math.round(volume * 100)}%`}
          />
        </div>
      </div>
    </footer>
  );
}
