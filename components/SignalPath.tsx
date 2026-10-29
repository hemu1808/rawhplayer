import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';

export function SignalPath() {
  const { nativeInfo: info } = usePlayer();
  const { currentTrack } = useLibrary();
  return (
    <section aria-label="Audio signal path" className="rounded-2xl border border-white/10 p-5 m-5 text-sm">
      <h2 className="font-semibold mb-3">Your signal path</h2>
      <ol className="grid grid-cols-3 gap-4">
        <li>
          <p className="text-neutral-400">Source</p>
          <p>{currentTrack?.format || 'No track'}</p>
          <p>
            {info?.sample_rate ? `${info.sample_rate / 1000} kHz` : 'Rate unknown'} · {info?.bit_depth || 'Unknown'} bit
          </p>
        </li>
        <li>
          <p className="text-neutral-400">Processing</p>
          <p>{info?.is_purist ? 'EQ bypassed' : 'Equalizer'}</p>
          <p>
            {info?.normalization || 'off'} ReplayGain · {info?.playback_rate || 1}×
          </p>
        </li>
        <li>
          <p className="text-neutral-400">Output</p>
          <p>{info?.device_name || 'System default'}</p>
          <p>
            {info?.output_sample_rate ? `${info.output_sample_rate / 1000} kHz` : 'Rate unknown'} ·{' '}
            {info?.output_format || 'Format unknown'}
          </p>
        </li>
      </ol>
      <p className="text-neutral-400 mt-3">
        {info?.sample_rate && info.output_sample_rate
          ? info.sample_rate === info.output_sample_rate
            ? 'Sample rates match.'
            : 'Sample rate conversion is active.'
          : 'Play a track to inspect the output.'}{' '}
        System audio mixer enabled.
      </p>
      <p className="text-neutral-400 mt-2">
        Clipping: {info?.clipping_count || 0} · Buffer underruns: {info?.underrun_count || 0}
      </p>
    </section>
  );
}
