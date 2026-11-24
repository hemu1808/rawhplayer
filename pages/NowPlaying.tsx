import { useState } from 'react';
import { FileAudio, FileText, FolderOpen, Info, Minimize2 } from 'lucide-react';
import { TrackArtwork } from '../components/TrackArtwork';
import { Visualizer } from '../components/Visualizer';
import { ScrollArea } from '../components/ScrollArea';
import { getTrackInsight } from '../services/geminiService';
import type { AudioInfo } from '../services/generated/native';
import type { Track } from '../types';

interface NowPlayingProps {
  track?: Track;
  info: AudioInfo | null;
  isPlaying: boolean;
  onImport: () => void;
  onBrowse: () => void;
  onEqualizer: () => void;
  onLyrics: () => void;
  lyricsOpen: boolean;
  onCompact?: () => void;
}

function TrackInsight({ track }: { track: Track }) {
  const [insight, setInsight] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  async function toggle() {
    setOpen(!open);
    if (open || insight || busy) return;
    setBusy(true);
    try {
      setInsight(await getTrackInsight(track.artist, track.name));
    } catch {
      setInsight('Track insight is unavailable.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="track-insight">
      <button className="button" type="button" aria-expanded={open} onClick={() => void toggle()}>
        <Info size={15} /> Track insight
      </button>
      {open && <p role="status">{busy ? 'Loading insight…' : insight}</p>}
    </div>
  );
}

export function NowPlaying({ track, info, isPlaying, onImport, onBrowse, onEqualizer, onLyrics, lyricsOpen, onCompact }: NowPlayingProps) {
  const details = [
    ['Format', track?.format],
    ['Sample rate', info?.sample_rate ? `${info.sample_rate / 1000} kHz` : track?.sampleRate ? `${track.sampleRate / 1000} kHz` : null],
    ['Bit depth', info?.bit_depth ? `${info.bit_depth}-bit` : track?.bitDepth ? `${track.bitDepth}-bit` : null],
  ].filter(([, value]) => value);
  const showInsight = Boolean(track && window.__TAURI_INTERNALS__);
  return (
    <ScrollArea
      title="Now playing"
      action={
        <button className="button" onClick={onImport}>
          <FileAudio size={16} /> Import files
        </button>
      }
    >
      <div className="now-playing">
        <section className="now-deck" aria-label="Current track">
          <TrackArtwork src={track?.image} cover />
          <div className="now-info">
            <h2 title={track?.name}>{track?.name || 'No track selected'}</h2>
            {track ? (
              <>
                <p className="now-byline">{[track.artist, track.album].filter(Boolean).join(' · ')}</p>
                {details.length > 0 && (
                  <dl className="track-details">
                    {details.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="now-actions">
                  <button className="button" onClick={onEqualizer} aria-haspopup="dialog">
                    Equalizer
                  </button>
                  <button className="button" onClick={onLyrics} aria-pressed={lyricsOpen}>
                    <FileText size={15} /> Lyrics
                  </button>
                  {onCompact && (
                    <button className="button" onClick={onCompact}>
                      <Minimize2 size={15} /> Compact
                    </button>
                  )}
                </div>
                {showInsight && <TrackInsight key={track.id} track={track} />}
              </>
            ) : (
              <>
                <p className="now-byline">Open a song from your library or import local audio.</p>
                <button className="button button--primary" onClick={onBrowse}>
                  <FolderOpen size={17} /> Browse library
                </button>
              </>
            )}
          </div>
        </section>
        <Visualizer isPlaying={isPlaying} />
      </div>
    </ScrollArea>
  );
}
