import { SlidersHorizontal } from 'lucide-react';
import { ScrollArea } from '../components/ScrollArea';
import { SignalPath } from '../components/SignalPath';
import { Visualizer } from '../components/Visualizer';
import { usePlayer } from '../context/PlayerContext';

export function AudiophilePage({ onEqualizer }: { onEqualizer: () => void }) {
  const { state } = usePlayer();
  return (
    <ScrollArea
      title="Audio"
      action={
        <button className="button" onClick={onEqualizer} aria-haspopup="dialog">
          <SlidersHorizontal size={16} /> Equalizer
        </button>
      }
    >
      <div className="audio-workspace">
        <SignalPath />
        <Visualizer isPlaying={state.isPlaying} showLevels />
      </div>
    </ScrollArea>
  );
}
