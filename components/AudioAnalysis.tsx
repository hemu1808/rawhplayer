import { useEffect, useState } from 'react';
import { commands, events, type AnalysisProgress } from '../services/generated/native';
import { useLibrary } from '../context/LibraryContext';
import { errorMessage } from '../context/PlayerContext';

export function AudioAnalysis() {
  const { currentTrack, totalTracks } = useLibrary();
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let active = true;
    let stop: (() => void) | undefined;
    void commands
      .analysisStatus()
      .then((status) => {
        if (active) setProgress(status);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    void events.analysisProgress
      .listen(({ payload }) => {
        if (active) setProgress(payload);
      })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  async function start(ids: string[] | null, force = false) {
    setStarting(true);
    setError('');
    try {
      setProgress(await commands.analysisStart(ids, force));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setStarting(false);
    }
  }
  const analysis = currentTrack?.analysis;
  const disabled = starting || !!progress?.running || !window.__TAURI_INTERNALS__;
  return (
    <section aria-label="Local audio analysis" className="border border-white/10 rounded-2xl p-5 space-y-4">
      <h2 className="font-semibold">Local audio analysis</h2>
      <p className="text-sm text-neutral-400">
        Measure loudness and true peak, and estimate tempo, musical key, and energy. Audio stays on your device. Results help explain queue
        suggestions. Each track is analyzed for up to one hour; longer tracks are marked as partial.
      </p>
      <div className="flex flex-wrap gap-4">
        <button disabled={disabled || !totalTracks} onClick={() => void start(null)}>
          Analyze library
        </button>
        <button disabled={disabled || !currentTrack} onClick={() => void start([currentTrack!.id])}>
          Analyze current track
        </button>
        <button disabled={disabled || !currentTrack} onClick={() => void start([currentTrack!.id], true)}>
          Reanalyze current track
        </button>
        {progress?.running && (
          <button onClick={() => void commands.analysisCancel().catch((reason) => setError(errorMessage(reason)))}>Cancel analysis</button>
        )}
      </div>
      {progress?.jobId && (
        <div role="status" className="text-sm space-y-2">
          <p>
            {progress.running ? 'Analyzing' : progress.cancelled ? 'Cancelled' : 'Finished'}: {progress.processed} / {progress.total} tracks
            · {progress.cached} cached · {progress.failed} failed
          </p>
          {progress.running && (
            <progress
              aria-label="Analysis progress"
              className="w-full"
              value={progress.processed + progress.percent}
              max={Math.max(1, progress.total)}
            />
          )}
          {progress.error && <p>{progress.error}</p>}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {analysis && (
        <div className="text-sm space-y-2">
          <h3>{currentTrack.name}</h3>
          <p>
            {analysis.complete ? 'Full track' : 'Partial result'} · {Math.round(analysis.analyzedSeconds)} seconds
          </p>
          <p>
            Tempo estimate:{' '}
            {analysis.bpm ? `${analysis.bpm.toFixed(1)} BPM (${Math.round(analysis.bpmConfidence * 100)}% confidence)` : 'Undetermined'}
          </p>
          <p>
            Key estimate:{' '}
            {analysis.musicalKey ? `${analysis.musicalKey} (${Math.round(analysis.keyConfidence * 100)}% confidence)` : 'Undetermined'}
          </p>
          <p>
            Integrated loudness: {analysis.integratedLufs === null ? 'Unavailable' : `${analysis.integratedLufs.toFixed(1)} LUFS`} · True
            peak: {analysis.truePeakDb === null ? 'Unavailable' : `${analysis.truePeakDb.toFixed(1)} dBTP`}
          </p>
          <p>Energy (RMS): {analysis.energy.toFixed(3)}. Loudness and true peak measurements support mono and stereo files.</p>
        </div>
      )}
    </section>
  );
}
