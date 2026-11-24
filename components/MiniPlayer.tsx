import type { Track, AudioState } from '../types';
import { Play, Pause, SkipForward, Maximize2, SlidersHorizontal } from 'lucide-react';
import { TrackArtwork } from './TrackArtwork';
import { SeekBar } from './SeekBar';

interface MiniPlayerProps {
  track: Track | null;
  audioState: AudioState;
  onPlayPause: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onEqualizer: () => void;
  onMaximize: () => void;
}

export function MiniPlayer({ track, audioState, onPlayPause, onNext, onSeek, onEqualizer, onMaximize }: MiniPlayerProps) {
  return (
    <section className="compact-player" aria-label="Compact player">
      <div className="compact-player-row">
        <TrackArtwork src={track?.image} />
        <div className="transport-meta">
          <p>{track?.name || 'No track selected'}</p>
          {track?.artist && <span>{track.artist}</span>}
        </div>
        <button className="transport-play" type="button" aria-label={audioState.isPlaying ? 'Pause' : 'Play'} onClick={onPlayPause}>
          {audioState.isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button className="icon-button" type="button" aria-label="Next track" onClick={onNext}>
          <SkipForward size={16} />
        </button>
        <button className="icon-button" type="button" aria-label="Open equalizer" onClick={onEqualizer}>
          <SlidersHorizontal size={16} />
        </button>
        <button className="icon-button" type="button" aria-label="Restore full player" onClick={onMaximize}>
          <Maximize2 size={16} />
        </button>
      </div>
      <SeekBar key={track?.id} time={audioState.currentTime} duration={audioState.duration} onSeek={onSeek} compact />
    </section>
  );
}
