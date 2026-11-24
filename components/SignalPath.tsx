import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';

export function SignalPath() {
  const { nativeInfo: info } = usePlayer();
  const { currentTrack } = useLibrary();
  const rate = (value?: number | null) => (value ? `${value / 1000} kHz` : 'Unknown sample rate');

  return (
    <section aria-label="Audio signal path" className="signal-path">
      <h2>Signal path</h2>
      <ol className="grid grid-cols-3 gap-4">
        <li>
          <h3>Source</h3>
          <p>{currentTrack?.format || 'No track'}</p>
          {info?.sample_rate ? (
            <p>
              {rate(info.sample_rate)}
              {info.bit_depth ? ` · ${info.bit_depth}-bit` : ''}
            </p>
          ) : null}
        </li>
        <li>
          <h3>Processing</h3>
          {info?.resampler ? <p>{info.resampler}</p> : <p>Waiting for playback</p>}
          {info && (
            <p>
              {info.is_purist ? 'EQ bypassed' : info.eq_mode === 'parametric' ? 'Parametric EQ' : 'Graphic EQ'} · {info.playback_rate || 1}×
            </p>
          )}
        </li>
        <li>
          <h3>Output</h3>
          <p>{info?.device_name || 'System default'}</p>
          {info?.output_sample_rate ? (
            <p>
              {rate(info.output_sample_rate)} · {info.output_format}
            </p>
          ) : null}
        </li>
      </ol>
      <div className="signal-path-summary">
        <span>Clipped samples {info?.clipping_count || 0}</span>
        <span>Buffer underruns {info?.underrun_count || 0}</span>
        <span>ReplayGain {info?.normalization || 'off'}</span>
        {info && !info.is_purist && <span>EQ preamp {info.eq_preamp_db.toFixed(1)} dB</span>}
      </div>
    </section>
  );
}
