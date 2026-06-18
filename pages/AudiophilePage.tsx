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
    let active = true;
    let unlistenFn: (() => void) | null = null;
    
    const setupListener = async () => {
      const u = await listen<{ fft: number[], waveform: number[] }>('fft_data', (event) => {
        if (active) {
          fftDataRef.current = event.payload;
        }
      });
      if (active) {
        unlistenFn = u;
      } else {
        u();
      }
    };
    
    setupListener();

    return () => {
      active = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  useEffect(() => {
    // Create offscreen canvas for spectrogram shifting
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 1000;
    tempCanvas.height = 340;
    const tempCtx = tempCanvas.getContext('2d');

    const draw = () => {
        const canvas = canvasRef.current;
        const scopeCanvas = scopeRef.current;
        const gonioCanvas = goniometerRef.current;
        
        // Safety check inside loop to handle cases where canvas refs aren't mounted on frame 1 (H-4 Fix)
        if (!canvas || !scopeCanvas || !gonioCanvas) {
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        const ctx = canvas.getContext('2d');
        const scopeCtx = scopeCanvas.getContext('2d');
        const gonioCtx = gonioCanvas.getContext('2d');
        
        if (!ctx || !scopeCtx || !gonioCtx) {
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        const { fft, waveform } = fftDataRef.current;
        const bufferLength = fft.length;
        if (bufferLength === 0) {
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        // --- REAL STEREO PEAKS EXTRACTION (H-17, H-18, H-19) ---
        let sumL = 0;
        let sumR = 0;
        let count = 0;
        
        // Extract L and R channels from interleaved data
        if (waveform.length >= 2) {
            for (let i = 0; i < waveform.length - 1; i += 2) {
                const l = waveform[i];
                const r = waveform[i + 1] !== undefined ? waveform[i + 1] : l;
                sumL += l * l;
                sumR += r * r;
                count++;
            }
        } else {
            // Fallback for empty or invalid waveform
            for (let i = 0; i < waveform.length; i++) {
                sumL += waveform[i] * waveform[i];
            }
            sumR = sumL;
            count = waveform.length;
        }
        
        const rmsL = count > 0 ? Math.sqrt(sumL / count) : 0.0000001;
        const rmsR = count > 0 ? Math.sqrt(sumR / count) : 0.0000001;
        
        const dbL = 20 * Math.log10(rmsL || 0.0000001);
        const dbR = 20 * Math.log10(rmsR || 0.0000001);
        
        const leftDb = Math.max(-60, dbL);
        const rightDb = Math.max(-60, dbR);
        
        const leftHeight = ((leftDb + 60) / 60) * 100;
        const rightHeight = ((rightDb + 60) / 60) * 100;
        
        if (leftMeterRef.current) {
            leftMeterRef.current.style.height = `${leftHeight}%`;
            leftMeterRef.current.className = `absolute bottom-0 w-full transition-all duration-75 ${leftDb > -3 ? 'bg-red-500 animate-[pulse_0.2s_infinite]' : leftDb > -12 ? 'bg-yellow-500' : 'bg-green-500'}`;
        }
        if (rightMeterRef.current) {
            rightMeterRef.current.style.height = `${rightHeight}%`;
            rightMeterRef.current.className = `absolute bottom-0 w-full transition-all duration-75 ${rightDb > -3 ? 'bg-red-500 animate-[pulse_0.2s_infinite]' : rightDb > -12 ? 'bg-yellow-500' : 'bg-green-500'}`;
        }
        if (peakLevelTextRef.current) {
            peakLevelTextRef.current.textContent = Math.max(leftDb, rightDb).toFixed(1);
        }

        // --- SPECTROGRAM ---
        if (tempCtx) {
            tempCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(tempCanvas, -1, 0); // shift left by 1 pixel

            for (let i = 0; i < bufferLength; i += 2) { 
                const value = Math.min((fft[i] || 0) / 100, 1.0);
                if (value > 0.05) {
                    const y = canvas.height - (i / bufferLength) * canvas.height;
                    const hueVal = 260 - (value * 260); // Blue (cold) to Red (hot)
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

        // --- REAL PHASE CORRELATION GONIOMETER (Lissajous plot L vs R) ---
        gonioCtx.fillStyle = 'rgba(0, 0, 0, 0.25)'; 
        gonioCtx.fillRect(0, 0, gonioCanvas.width, gonioCanvas.height);
        const center = gonioCanvas.width / 2;
        gonioCtx.lineWidth = 1;
        gonioCtx.strokeStyle = 'rgba(96, 165, 250, 0.8)';
        gonioCtx.beginPath();
        
        if (waveform.length >= 2) {
            for (let i = 0; i < waveform.length - 1; i += 4) {
                 const L = waveform[i];
                 const R = waveform[i + 1] !== undefined ? waveform[i + 1] : L;
                 
                 // Rotate 45 degrees to match standard stereo correlation plot
                 const valX = (L - R) * 0.707 * (center * 0.8);
                 const valY = (L + R) * 0.707 * (center * 0.8);
                 
                 if (i === 0) gonioCtx.moveTo(center + valX, center - valY);
                 else gonioCtx.lineTo(center + valX, center - valY);
            }
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
