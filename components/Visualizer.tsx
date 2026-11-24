import { useEffect, useRef, type RefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AudioLines, AudioWaveform, ChartColumnIncreasing, CircleDot } from 'lucide-react';
import { usePersistence } from '../hooks/usePersistence';

const modes = [
  { id: 'spectrum', label: 'Spectrum', icon: ChartColumnIncreasing },
  { id: 'waveform', label: 'Waveform', icon: AudioWaveform },
  { id: 'spectrogram', label: 'Spectrogram', icon: AudioLines },
  { id: 'stereo', label: 'Stereo', icon: CircleDot },
] as const;
type Mode = (typeof modes)[number]['id'];
interface AudioFrame {
  fft: number[];
  waveform: number[];
}
type Surface = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; width: number; height: number; ratio: number };

const dbLevel = (sample: number) => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(sample, 0.0001)) + 74) / 74));
const sampleAt = (data: number[], index: number) => data[index] || 0;

function spectrumIndex(progress: number, length: number) {
  return Math.min(length - 1, Math.max(1, Math.floor(2 ** (progress * Math.log2(length)))));
}

function drawPlot(surface: Surface, mode: Mode, frame: AudioFrame, accent: string) {
  const { canvas, context: ctx, width, height, ratio } = surface;
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.35;
  ctx.lineJoin = 'round';
  if (mode === 'spectrogram') {
    const step = Math.max(2, Math.round(width / 144));
    const sourceOffset = step * ratio;
    if (width > step) ctx.drawImage(canvas, sourceOffset, 0, canvas.width - sourceOffset, canvas.height, 0, 0, width - step, height);
    ctx.clearRect(width - step, 0, step, height);
    const bands = 52;
    for (let band = 0; band < bands; band++) {
      const index = spectrumIndex(band / (bands - 1), frame.fft.length);
      ctx.globalAlpha = dbLevel(sampleAt(frame.fft, index)) ** 2;
      ctx.fillRect(width - step, height - ((band + 1) * height) / bands, step, height / bands + 0.5);
    }
    ctx.globalAlpha = 1;
    return;
  }

  ctx.clearRect(0, 0, width, height);
  if (mode === 'spectrum') {
    const bars = Math.max(20, Math.min(70, Math.floor(width / 8)));
    const step = width / bars;
    const baseline = height - 5;
    for (let bar = 0; bar < bars; bar++) {
      const start = spectrumIndex(bar / bars, frame.fft.length);
      const end = Math.max(start + 1, spectrumIndex((bar + 1) / bars, frame.fft.length));
      let peak = 0;
      for (let bin = start; bin < end; bin++) peak = Math.max(peak, sampleAt(frame.fft, bin));
      const amplitude = dbLevel(peak);
      const size = Math.max(2, amplitude * (height - 12));
      ctx.globalAlpha = 0.25 + amplitude * 0.75;
      ctx.fillRect(bar * step + 1, baseline - size, Math.max(1, step - 3), size);
    }
    ctx.globalAlpha = 1;
    return;
  }

  ctx.beginPath();
  if (mode === 'waveform') {
    const points = Math.min(320, Math.floor(frame.waveform.length / 2));
    for (let i = 0; i < points; i++) {
      const frameIndex = Math.floor((i * frame.waveform.length) / (points * 2)) * 2;
      const amplitude = (sampleAt(frame.waveform, frameIndex) + sampleAt(frame.waveform, frameIndex + 1)) / 2;
      const y = height / 2 - Math.max(-1, Math.min(1, amplitude)) * height * 0.43;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo((i * width) / Math.max(1, points - 1), y);
    }
  } else {
    const radius = Math.min(width, height) * 0.68;
    for (let i = 0; i + 1 < frame.waveform.length; i += 4) {
      const left = sampleAt(frame.waveform, i);
      const right = sampleAt(frame.waveform, i + 1);
      const x = width / 2 + Math.max(-0.65, Math.min(0.65, (left - right) / 2)) * radius;
      const y = height / 2 - Math.max(-0.65, Math.min(0.65, (left + right) / 2)) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function useVisualization(ref: RefObject<HTMLDivElement | null>, selection: string, playing: boolean, showLevels: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!root || (!selection && !showLevels)) return;
    const canvases = [...root.querySelectorAll<HTMLCanvasElement>('canvas[data-mode]')];
    const surfaces = new Map<HTMLCanvasElement, Surface>();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let accent = getComputedStyle(document.documentElement).getPropertyValue('--primary-500').trim();
    let frame: AudioFrame | null = null;
    let request: number | null = null;
    let active = true;
    let unlisten: (() => void) | undefined;
    const meters = [...root.querySelectorAll<HTMLElement>('[data-meter]')].map((meter) => ({
      bar: meter.querySelector<HTMLElement>('.audio-meter-track span'),
      text: meter.querySelector('output'),
    }));
    for (const meter of meters) {
      if (meter.bar) meter.bar.style.width = '0';
      if (meter.text) meter.text.value = '– dBFS';
    }

    function paint() {
      request = null;
      if (!frame || motion.matches || document.hidden) return;
      for (const surface of surfaces.values()) drawPlot(surface, surface.canvas.dataset.mode as Mode, frame, accent);
      for (const [channel, meter] of meters.entries()) {
        let energy = 0;
        let count = 0;
        for (let i = channel; i < frame.waveform.length; i += 2) {
          const sample = sampleAt(frame.waveform, i);
          energy += sample * sample;
          count++;
        }
        const db = Math.max(-60, 10 * Math.log10(energy / Math.max(1, count)));
        if (meter.bar) meter.bar.style.width = `${Math.min(100, ((db + 60) / 60) * 100)}%`;
        if (meter.text) meter.text.value = `${db.toFixed(1)} dBFS`;
      }
    }

    function schedule() {
      if (request === null && !motion.matches && !document.hidden) request = requestAnimationFrame(paint);
    }

    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const canvas = entry.target as HTMLCanvasElement;
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) continue;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        surfaces.set(canvas, { canvas, context, width, height, ratio });
      }
      schedule();
    });

    function refresh() {
      accent = getComputedStyle(document.documentElement).getPropertyValue('--primary-500').trim();
      for (const surface of surfaces.values()) surface.context.clearRect(0, 0, surface.width, surface.height);
      schedule();
    }

    canvases.forEach((canvas) => resize.observe(canvas));
    window.addEventListener('rawh-theme-changed', refresh);
    motion.addEventListener('change', refresh);
    if (playing && window.__TAURI_INTERNALS__) {
      void listen<AudioFrame>('fft_data', ({ payload }) => {
        if (!active || motion.matches || document.hidden) return;
        frame = payload;
        schedule();
      })
        .then((stop) => {
          if (active) unlisten = stop;
          else stop();
        })
        .catch(() => {});
    }
    return () => {
      active = false;
      unlisten?.();
      resize.disconnect();
      if (request !== null) cancelAnimationFrame(request);
      window.removeEventListener('rawh-theme-changed', refresh);
      motion.removeEventListener('change', refresh);
    };
  }, [ref, selection, playing, showLevels]);
}

export function Visualizer({ isPlaying, showLevels = false }: { isPlaying: boolean; showLevels?: boolean }) {
  const [stored, setStored] = usePersistence<Mode[]>('rawh_visualizers_v2', ['spectrum']);
  const selected = Array.isArray(stored) ? modes.filter(({ id }) => stored.includes(id)) : [modes[0]];
  const root = useRef<HTMLDivElement>(null);
  useVisualization(root, selected.map(({ id }) => id).join(','), isPlaying, showLevels);

  return (
    <section className="visualizer" aria-label="Visualizers">
      <div className="visualizer-toolbar">
        <h2>Visualizers</h2>
        <div className="visualizer-options" role="group" aria-label="Choose visualizers">
          {modes.map(({ id, label, icon: Icon }) => {
            const checked = selected.some((mode) => mode.id === id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={checked}
                onClick={() =>
                  setStored(
                    checked ? selected.filter((mode) => mode.id !== id).map((mode) => mode.id) : [...selected.map((mode) => mode.id), id],
                  )
                }
              >
                <Icon size={15} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div ref={root}>
        {showLevels && (
          <div className="audio-meter" aria-label="Left and right RMS levels">
            {['Left', 'Right'].map((channel) => (
              <div key={channel} data-meter>
                <span>{channel}</span>
                <span className="audio-meter-track" aria-hidden="true">
                  <span />
                </span>
                <output aria-live="off">– dBFS</output>
              </div>
            ))}
          </div>
        )}
        {selected.length > 0 && (
          <div className="visualizer-grid" data-count={selected.length}>
            {selected.map(({ id, label }) => (
              <figure className="visualizer-figure" key={id}>
                <figcaption>{label}</figcaption>
                <div className="visualizer-plot" data-plot={id}>
                  <canvas aria-hidden="true" data-mode={id} />
                  {!isPlaying && <span className="visualizer-idle">Waiting for playback</span>}
                </div>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
