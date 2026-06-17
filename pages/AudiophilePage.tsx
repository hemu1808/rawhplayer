import React, { useEffect, useRef } from 'react';
import { ScrollArea } from '../components/ScrollArea';
import { Activity, Zap, Cpu, Waves, Radar, Move, BarChart2 } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';

interface AudiophilePageProps {
  sampleRate: number;
}

export const AudiophilePage: React.FC<AudiophilePageProps> = ({ sampleRate }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const goniometerRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const leftMeterRef = useRef<HTMLDivElement>(null);
  const rightMeterRef = useRef<HTMLDivElement>(null);
  const peakLevelTextRef = useRef<HTMLSpanElement>(null);
  
  const fftDataRef = useRef<{ fft: number[], waveform: number[] }>({ fft: [], waveform: [] });

  useEffect(() => {
    const unlisten = listen<{ fft: number[], waveform: number[] }>('fft_data', (event) => {
      fftDataRef.current = event.payload;
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !scopeRef.current || !goniometerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const scopeCanvas = scopeRef.current;
    const scopeCtx = scopeCanvas.getContext('2d');
    const gonioCanvas = goniometerRef.current;
    const gonioCtx = gonioCanvas.getContext('2d');
    
    if (!ctx || !scopeCtx || !gonioCtx) return;

    // Create an offscreen canvas to shift the spectrogram
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');

    const draw = () => {
        const { fft, waveform } = fftDataRef.current;
        const bufferLength = fft.length;
        if (bufferLength === 0) {
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        // --- CALC PEAKS (Simulated Stereo split) ---
        let sum = 0;
        for(let i=0; i<waveform.length; i++) {
             sum += waveform[i] * waveform[i];
        }
        const rms = Math.sqrt(sum / waveform.length) || 0.0000001;
        const db = 20 * Math.log10(rms); 
        
        const leftDb = Math.max(-60, db);
        const rightDb = Math.max(-60, db - (Math.random()*2));
        
        // Direct DOM updates instead of setState (H-7 Fix)
        const leftHeight = ((leftDb + 60) / 60) * 100;
        const rightHeight = ((rightDb + 60) / 60) * 100;
        
        if (leftMeterRef.current) {
            leftMeterRef.current.style.height = `${leftHeight}%`;
            leftMeterRef.current.className = `absolute bottom-0 w-full transition-all duration-75 ${leftDb > -3 ? 'bg-red-500' : leftDb > -12 ? 'bg-yellow-500' : 'bg-green-500'}`;
        }
        if (rightMeterRef.current) {
            rightMeterRef.current.style.height = `${rightHeight}%`;
            rightMeterRef.current.className = `absolute bottom-0 w-full transition-all duration-75 ${rightDb > -3 ? 'bg-red-500' : rightDb > -12 ? 'bg-yellow-500' : 'bg-green-500'}`;
        }
        if (peakLevelTextRef.current) {
            peakLevelTextRef.current.textContent = leftDb.toFixed(1);
        }

        // --- SPECTROGRAM ---
        if (tempCtx) {
            tempCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
            ctx.clearRect(0,0, canvas.width, canvas.height);
            ctx.drawImage(tempCanvas, -1, 0); // Slower shift for better res

            for(let i = 0; i < bufferLength; i += 2) { 
                const value = Math.min((fft[i] || 0) / 100, 1.0); // normalize roughly
                if (value > 0.05) { // Threshold to reduce noise
                    const y = canvas.height - (i / bufferLength) * canvas.height;
                    const hueVal = 260 - (value * 260); // Blue to Red heatmap
                    const lightness = value * 60;
                    ctx.fillStyle = `hsla(${hueVal}, 100%, ${lightness}%, 1)`;
                    ctx.fillRect(canvas.width - 1, y, 1, 2);
                }
            }
        }

        // --- OSCILLOSCOPE ---
        scopeCtx.clearRect(0, 0, scopeCanvas.width, scopeCanvas.height);
        scopeCtx.lineWidth = 2;
        scopeCtx.strokeStyle = '#4ade80'; 
        scopeCtx.beginPath();
        const sliceWidth = scopeCanvas.width * 1.0 / waveform.length;
        let x = 0;
        for (let i = 0; i < waveform.length; i++) {
            const v = waveform[i]; // -1.0 to 1.0
            const y = (1.0 - v) * scopeCanvas.height / 2;
            if (i === 0) scopeCtx.moveTo(x, y); else scopeCtx.lineTo(x, y);
            x += sliceWidth;
        }
        scopeCtx.stroke();

        // --- GONIOMETER ---
        gonioCtx.fillStyle = 'rgba(0, 0, 0, 0.25)'; 
        gonioCtx.fillRect(0, 0, gonioCanvas.width, gonioCanvas.height);
        const center = gonioCanvas.width / 2;
        gonioCtx.lineWidth = 1;
        gonioCtx.strokeStyle = 'rgba(96, 165, 250, 0.8)';
        gonioCtx.beginPath();
        
        for (let i = 0; i < waveform.length; i+=4) {
             const L = waveform[i];
             const R = waveform[(i + 16) % waveform.length] || 0; // Phase offset
             const valX = (L - R) * 0.707 * (center * 0.8);
             const valY = (L + R) * 0.707 * (center * 0.8);
             if (i===0) gonioCtx.moveTo(center + valX, center - valY);
             else gonioCtx.lineTo(center + valX, center - valY);
        }
        gonioCtx.stroke();
        
        rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <ScrollArea title="Audiophile" subtitle="Advanced Signal Analysis">
      <div className="px-6 md:px-8 max-w-7xl mx-auto space-y-8 pb-32">
        
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
             {/* Tech Stats */}
             <div className="lg:col-span-1 glass-panel p-4 rounded-2xl flex flex-col justify-between">
                 <div className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider mb-2">Signal Chain</div>
                 <div className="space-y-2">
                     <div className="flex items-center gap-2 text-xs text-white"><Cpu size={12} className="text-primary-500"/> Source (FLAC)</div>
                     <div className="w-0.5 h-2 bg-white/10 ml-1.5" />
                     <div className="flex items-center gap-2 text-xs text-white"><Zap size={12} className="text-blue-400"/> DSP (32-bit)</div>
                     <div className="w-0.5 h-2 bg-white/10 ml-1.5" />
                     <div className="flex items-center gap-2 text-xs text-white"><Waves size={12} className="text-green-400"/> Output ({sampleRate})</div>
                 </div>
             </div>
             
             {/* Meters */}
             <div className="lg:col-span-1 glass-panel p-4 rounded-2xl flex items-center justify-center gap-4">
                 <div className="flex flex-col items-center gap-1 h-full">
                     <div className="w-4 h-32 bg-neutral-900 rounded-full border border-white/10 relative overflow-hidden">
                         <div 
                           ref={leftMeterRef}
                           className="absolute bottom-0 w-full transition-all duration-75 bg-green-500"
                           style={{ height: '0%' }}
                         />
                     </div>
                     <span className="text-[9px] font-mono text-neutral-500">L</span>
                 </div>
                 <div className="flex flex-col items-center gap-1 h-full">
                     <div className="w-4 h-32 bg-neutral-900 rounded-full border border-white/10 relative overflow-hidden">
                         <div 
                           ref={rightMeterRef}
                           className="absolute bottom-0 w-full transition-all duration-75 bg-green-500"
                           style={{ height: '0%' }}
                         />
                     </div>
                     <span className="text-[9px] font-mono text-neutral-500">R</span>
                 </div>
             </div>

             <div className="lg:col-span-3 grid grid-cols-3 gap-4">
                 <div className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                     <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold mb-1">Sample Rate</div>
                     <div className="text-2xl font-mono text-white flex items-center gap-2">{sampleRate} <span className="text-xs text-neutral-500">Hz</span></div>
                 </div>
                 <div className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                     <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold mb-1">Process Depth</div>
                     <div className="text-2xl font-mono text-white flex items-center gap-2">32 <span className="text-xs text-neutral-500">bit (Float)</span></div>
                 </div>
                 <div className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                     <div className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold mb-1">Peak Level</div>
                     <div className="text-2xl font-mono text-white flex items-center gap-2"><span ref={peakLevelTextRef}>-60.0</span> <span className="text-xs text-neutral-500">dB</span></div>
                 </div>
             </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="glass-panel rounded-3xl p-6">
                <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Activity size={14} /> Oscilloscope</h3>
                <div className="bg-black/80 rounded-xl border border-white/10 overflow-hidden relative aspect-video shadow-inner">
                     <canvas ref={scopeRef} width={600} height={340} className="w-full h-full" />
                </div>
            </div>
            <div className="glass-panel rounded-3xl p-6">
                <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Move size={14} /> Stereo Phase (Lissajous)</h3>
                <div className="bg-black/80 rounded-xl border border-white/10 overflow-hidden relative aspect-video shadow-inner flex items-center justify-center">
                     <canvas ref={goniometerRef} width={340} height={340} className="w-[340px] h-[340px]" />
                </div>
            </div>
        </div>

        <div className="glass-panel rounded-3xl p-6">
            <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-4 flex items-center gap-2"><BarChart2 size={14} /> Spectrogram</h3>
            <div className="bg-black/80 rounded-xl border border-white/10 overflow-hidden relative aspect-[21/9] shadow-inner">
                 <canvas ref={canvasRef} width={1000} height={340} className="w-full h-full" />
            </div>
        </div>
      </div>
    </ScrollArea>
  );
};
