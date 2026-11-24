import { useEffect, useRef, useState } from 'react';
import { commands, type EqualizerResponse, type EqualizerSettings } from '../services/generated/native';

export function EqualizerGraph({ settings, sampleRate, enabled }: { settings: EqualizerSettings; sampleRate: number; enabled: boolean }) {
  const [result, setResult] = useState<EqualizerResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const native = Boolean(window.__TAURI_INTERNALS__);
  const limit = result ? Math.max(18, Math.ceil(Math.max(...result.points.map(({ gain }) => Math.min(48, Math.abs(gain)))) / 6) * 6) : 18;
  useEffect(() => {
    if (!native) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void commands
        .previewEqualizer(settings, sampleRate)
        .then((response) => {
          if (!active) return;
          setFailed(false);
          setResult(response);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    }, 40);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [native, settings, sampleRate]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !result) return;
    function paint() {
      if (!element || !result || result.points.length < 2) return;
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const theme = getComputedStyle(document.documentElement);
      const y = (gain: number) => height / 2 - (Math.max(-limit, Math.min(limit, gain)) / limit) * (height / 2 - 8);
      const firstFrequency = result.points[0].frequency;
      const frequencySpan = Math.log(result.points[result.points.length - 1].frequency / firstFrequency);
      ctx.lineWidth = 1.7;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = theme.getPropertyValue(enabled ? '--primary-500' : '--muted').trim();
      ctx.setLineDash(enabled ? [] : [4, 3]);
      ctx.beginPath();
      result.points.forEach(({ frequency, gain }, index) => {
        const x = (Math.log(frequency / firstFrequency) / frequencySpan) * width;
        if (index === 0) ctx.moveTo(x, y(gain));
        else ctx.lineTo(x, y(gain));
      });
      ctx.stroke();
    }
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    window.addEventListener('rawh-theme-changed', paint);
    paint();
    return () => {
      observer.disconnect();
      window.removeEventListener('rawh-theme-changed', paint);
    };
  }, [result, enabled, limit]);

  const max = result?.points.at(-1)?.frequency || Math.min(20000, sampleRate / 2);
  return (
    <div className="eq-response">
      <div className="eq-response-caption">
        <h3>Calculated response</h3>
        {result && !failed && (
          <span>
            {result.sampleRate / 1000} kHz · Applied preamp{' '}
            {Math.abs(result.appliedPreampDb) < 0.05 ? '0.0' : result.appliedPreampDb.toFixed(1)} dB
          </span>
        )}
      </div>
      <div className="eq-display">
        <canvas ref={canvas} aria-hidden="true" className="eq-curve" />
        <span className="eq-zero" aria-hidden="true">
          0 dB
        </span>
        {result && !failed && (
          <>
            <span className="eq-scale eq-scale-top" aria-hidden="true">
              +{limit} dB
            </span>
            <span className="eq-scale eq-scale-bottom" aria-hidden="true">
              −{limit} dB
            </span>
          </>
        )}
        {(!result || failed) && (
          <span className="eq-graph-status">
            {failed ? 'Response unavailable' : native ? 'Calculating…' : 'Response is available in the desktop app.'}
          </span>
        )}
      </div>
      <div className="eq-frequency-axis" aria-hidden="true">
        <span>20 Hz</span>
        <span>{Math.round(Math.sqrt(20 * max))} Hz</span>
        <span>{(max / 1000).toFixed(max >= 10000 ? 0 : 1)} kHz</span>
      </div>
    </div>
  );
}
