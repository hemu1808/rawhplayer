
import React, { useEffect, useRef, useState } from 'react';
import { EqualizerBand, EQ_PRESETS } from '../types';
import { RotateCcw, X, Activity, ChevronDown, Zap } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';

interface EqualizerProps {
  isOpen: boolean;
  onClose: () => void;
  bands: EqualizerBand[];
  onBandChange: (index: number, gain: number) => void;
  onReset: () => void;
  currentPresetId: string;
  onPresetChange: (presetId: string) => void;
}

export const Equalizer: React.FC<EqualizerProps> = ({ 
    isOpen, 
    onClose, 
    bands, 
    onBandChange, 
    onReset,
    currentPresetId,
    onPresetChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const fftDataRef = useRef<number[]>(new Array(512).fill(0));

  useEffect(() => {
    if (!isOpen) return;
    const unlisten = listen<{ fft: number[] }>('fft_data', (event) => {
      fftDataRef.current = event.payload.fft;
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [isOpen]);

  // RTA Visualization Loop
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
        const dataArray = fftDataRef.current;
        const bufferLength = dataArray.length;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const width = canvas.width;
        const height = canvas.height;
        const barWidth = width / 64; 
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';

        for (let i = 0; i < 64; i++) {
            const bin = Math.floor(Math.pow(i / 64, 2) * bufferLength); 
            // Normalize rustfft magnitude
            const value = Math.min((dataArray[bin] || 0) / 500, 1.0);
            const barHeight = value * height;

            if (barHeight > 0) {
                 ctx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
            }
        }
        rafRef.current = requestAnimationFrame(draw);
    };
    
    draw();
    
    return () => cancelAnimationFrame(rafRef.current);

  }, [isOpen]);

  if (!isOpen) return null;

  const formatFreq = (freq: number) => {
      return freq >= 1000 ? `${freq/1000}k` : freq.toString();
  };

  return (
    <div className="absolute inset-y-0 right-0 w-full md:w-[450px] bg-neutral-900/95 backdrop-blur-3xl border-l border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.9)] z-[90] animate-in slide-in-from-right duration-400 ease-out flex flex-col font-sans">
        
        {/* Pro Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent shrink-0">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-black/50 border border-white/10 flex items-center justify-center text-primary-500 shadow-inner">
                     <Activity size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-white tracking-wide text-sm">Parametric EQ</h3>
                    <p className="text-[11px] text-primary-500/80 font-mono flex items-center gap-1">
                        <Zap size={10} /> MASTER OUTPUT
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={onReset} 
                    className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-full text-neutral-400 hover:text-white transition-all active:scale-95" 
                    title="Reset to Flat"
                >
                    <RotateCcw size={16} />
                </button>
                <button 
                    onClick={onClose} 
                    className="p-2.5 bg-white/5 hover:bg-red-500/20 border border-white/5 rounded-full text-neutral-400 hover:text-red-400 transition-all active:scale-95"
                >
                    <X size={16} />
                </button>
            </div>
        </div>

        {/* Dynamic Visualization Area */}
        <div className="h-40 w-full bg-[#0a0a0a] relative overflow-hidden border-b border-white/5 shrink-0 shadow-inner">
            <canvas ref={canvasRef} width={450} height={160} className="absolute inset-0 w-full h-full opacity-50" />
            
            <div className="absolute inset-0 grid grid-cols-10 opacity-10 pointer-events-none">
                {[...Array(10)].map((_, i) => (
                    <div key={i} className="border-r border-white h-full" />
                ))}
            </div>

            <svg className="absolute inset-0 w-full h-full p-0 overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                 <defs>
                    <linearGradient id="eqGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary-500)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--primary-500)" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <path 
                    d={`M0,100 ` + bands.map((b, i) => `L${(i / (bands.length - 1)) * 100},${100 - ((b.gain + 12)/24)*100}`).join(' ') + ` L100,100 Z`}
                    fill="url(#eqGradient)" 
                    className="transition-all duration-300 ease-out"
                />
                <path 
                    d={`M0,${100 - ((bands[0].gain + 12)/24)*100} ` + bands.map((b, i) => `L${(i / (bands.length - 1)) * 100},${100 - ((b.gain + 12)/24)*100}`).join(' ')}
                    fill="none" 
                    stroke="var(--primary-400)" 
                    strokeWidth="2"
                    className="drop-shadow-[0_0_8px_rgba(var(--primary-500),0.8)] transition-all duration-300 ease-out"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
            
            <div className="absolute top-1/2 w-full h-[1px] bg-white/20 border-t border-dashed border-white/20" />
        </div>

        {/* Controls Container - Explicit Grid for precise label alignment */}
        <div className="flex-1 p-6 pb-2 overflow-y-auto custom-scrollbar bg-neutral-900/50">
             <div className="grid grid-cols-10 gap-1 h-full min-h-[300px]">
                {bands.map((band, index) => (
                    <div key={band.frequency} className="flex flex-col items-center h-full group relative">
                        
                        {/* Interactive Slider Track */}
                        <div className="relative flex-1 w-full flex justify-center py-4 group cursor-pointer">
                             <div className="absolute top-0 bottom-0 w-1.5 bg-black rounded-full overflow-hidden shadow-[inset_0_1px_3px_rgba(0,0,0,1)] border border-white/5">
                                 <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/20" />
                                 <div 
                                    className={`absolute left-0 right-0 bg-primary-500 transition-all duration-75 ${band.gain === 0 ? 'opacity-0' : 'opacity-100'}`}
                                    style={{ 
                                        top: band.gain > 0 ? `${50 - ((band.gain / 12) * 50)}%` : '50%',
                                        height: `${(Math.abs(band.gain) / 12) * 50}%`,
                                    }}
                                 />
                             </div>

                             <input 
                                type="range" 
                                min="-12" 
                                max="12" 
                                step="0.5"
                                value={band.gain}
                                onChange={(e) => onBandChange(index, parseFloat(e.target.value))}
                                className="absolute inset-0 h-full w-full appearance-none bg-transparent cursor-pointer z-10 opacity-0"
                                style={{ 
                                    WebkitAppearance: 'slider-vertical',
                                    writingMode: 'bt-lr' 
                                } as any} 
                             />
                             
                             <div 
                                className="absolute w-6 h-8 bg-gradient-to-b from-neutral-700 to-neutral-900 rounded-[4px] shadow-[0_4px_6px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.1)] pointer-events-none transition-transform duration-100 flex items-center justify-center border border-black group-hover:border-primary-500/50"
                                style={{ 
                                    bottom: `${((band.gain + 12) / 24) * 100}%`,
                                    transform: 'translateY(50%)'
                                }}
                             >
                                 <div className="w-full h-[2px] bg-white shadow-[0_0_5px_rgba(255,255,255,0.5)]" />
                             </div>
                        </div>

                        {/* Value & Label */}
                        <div className="h-14 flex flex-col items-center justify-start pt-2 gap-1 w-full text-center">
                            <span className={`text-[9px] font-mono font-bold transition-colors ${band.gain !== 0 ? 'text-primary-400' : 'text-neutral-600'}`}>
                                {band.gain > 0 ? '+' : ''}{band.gain.toFixed(0)}
                            </span>
                            <span className="text-[10px] font-bold text-white/80 group-hover:text-white transition-colors">
                                {formatFreq(band.frequency)}
                            </span>
                        </div>
                    </div>
                ))}
             </div>
        </div>

        {/* Footer: Preset Manager */}
        <div className="p-6 pt-4 border-t border-white/5 bg-black/20">
            <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">DSP Profile</label>
            <div className="relative group">
                <select 
                    value={currentPresetId}
                    onChange={(e) => onPresetChange(e.target.value)}
                    className="w-full appearance-none bg-neutral-800 border border-white/10 text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-all cursor-pointer hover:bg-neutral-700 shadow-lg"
                >
                    {EQ_PRESETS.map(preset => (
                        <option key={preset.id} value={preset.id} className="bg-neutral-900">
                            {preset.label}
                        </option>
                    ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400 group-hover:text-white transition-colors">
                    <ChevronDown size={16} />
                </div>
            </div>
        </div>
    </div>
  );
};
