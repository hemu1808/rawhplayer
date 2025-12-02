
import React from 'react';
import { Shield, Zap, Volume2, Palette, Image, ToggleRight, ToggleLeft, Cpu } from 'lucide-react';
import { ThemeColor } from '../types';
import { ScrollArea } from '../components/ScrollArea';

interface SettingsPageProps {
    currentThemeId: string;
    onThemeChange: (theme: ThemeColor) => void;
    isPuristMode: boolean;
    onTogglePurist: () => void;
    bufferSize?: number;
    processingPrecision?: '16-bit' | '32-bit float';
    onTogglePrecision?: () => void;
}

const THEMES: ThemeColor[] = [
    { name: 'Immersive Glass', id: 'immersive', colors: { 300: '#ffffff', 400: '#e5e5e5', 500: '#ffffff', 600: '#a3a3a3', 900: '#262626' } },
    { name: 'Rawh Gold', id: 'gold', colors: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 900: '#78350f' } },
    { name: 'Reference', id: 'reference', colors: { 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 900: '#171717' } },
    { name: 'Analog Warm', id: 'analog', colors: { 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 900: '#431407' } },
    { name: 'Cyber Blue', id: 'cyber', colors: { 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 900: '#164e63' } },
    { name: 'Forest Studio', id: 'forest', colors: { 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 900: '#14532d' } },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({ 
    currentThemeId, 
    onThemeChange, 
    isPuristMode, 
    onTogglePurist, 
    bufferSize = 2048,
    processingPrecision = '32-bit float',
    onTogglePrecision
}) => {
  return (
    <ScrollArea title="Settings" subtitle="Preferences & Customization">
      <div className="px-6 md:px-8 space-y-8 max-w-[1600px]">
        
        {/* Personalization Section */}
        <section>
            <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500">
                    <Palette size={16} />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Look & Feel</h3>
            </div>
            <div className="glass-panel rounded-3xl p-6 md:p-8">
                <div className="text-white font-medium mb-6 text-base">Theme Engine</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                    {THEMES.map(theme => (
                        <button 
                            key={theme.id}
                            onClick={() => onThemeChange(theme)}
                            className={`relative h-28 rounded-xl border transition-all duration-300 group overflow-hidden ${
                                currentThemeId === theme.id 
                                ? 'border-primary-500 ring-2 ring-primary-500/30 scale-105 z-10' 
                                : 'border-white/10 hover:border-white/30'
                            }`}
                        >
                            {/* Theme Preview Background */}
                            <div className="absolute inset-0 bg-neutral-900" />
                            <div className="absolute inset-0 opacity-50" style={{ background: `linear-gradient(135deg, ${theme.colors[900]}, ${theme.colors[500]})` }} />
                            
                            {theme.id === 'immersive' && <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent backdrop-blur-md" />}
                            
                            <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/80 to-transparent" />

                            <div className="absolute top-3 right-3 w-4 h-4 rounded-full border border-white/20" style={{ background: theme.colors[500] }} />

                            {currentThemeId === theme.id && (
                                <div className="absolute inset-0 flex items-center justify-center z-10">
                                    <div className="w-2 h-2 bg-white rounded-full shadow-[0_0_10px_white]" />
                                </div>
                            )}
                            <span className="absolute bottom-3 left-3 text-[10px] text-white font-bold uppercase tracking-wider">
                                {theme.name}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </section>

        {/* Audio Section */}
        <section>
            <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500">
                    <Volume2 size={16} />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Audio Engine</h3>
            </div>
            <div className="glass-panel rounded-3xl p-0 overflow-hidden">
                <div className="p-6 flex items-center justify-between border-b border-white/5 hover:bg-white/5 transition-colors">
                    <div>
                        <div className="text-white text-base font-medium mb-1 flex items-center gap-2">
                             Audio Purist Mode <span className="px-1.5 py-0.5 rounded bg-primary-500 text-black text-[9px] font-bold">BIT PERFECT</span>
                        </div>
                        <div className="text-xs text-neutral-500">Bypasses EQ and DSP for transparent signal path.</div>
                    </div>
                    <div onClick={onTogglePurist} className={`cursor-pointer transition-colors ${isPuristMode ? 'text-primary-500' : 'text-neutral-600'}`}>
                        {isPuristMode ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                    </div>
                </div>
                
                <div className="p-6 flex items-center justify-between border-b border-white/5 hover:bg-white/5 transition-colors">
                    <div>
                        <div className="text-white text-base font-medium mb-1">32-Bit Floating Point</div>
                        <div className="text-xs text-neutral-500">Internal DSP precision resolution.</div>
                    </div>
                    <div onClick={onTogglePrecision} className={`cursor-pointer transition-colors ${processingPrecision === '32-bit float' ? 'text-primary-500' : 'text-neutral-600'}`}>
                        {processingPrecision === '32-bit float' ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                    </div>
                </div>

                <div className="p-6 flex items-center justify-between hover:bg-white/5 transition-colors">
                    <div>
                        <div className="text-white text-base font-medium mb-1">Buffer Size</div>
                        <div className="text-xs text-neutral-500">Lower latency vs stability.</div>
                    </div>
                    <select 
                        defaultValue={bufferSize === 2048 ? "2048 samples (Stable)" : "512 samples (Low Latency)"}
                        className="bg-black/50 border border-white/10 text-xs text-white rounded-lg px-3 py-2 outline-none focus:border-primary-500 transition-colors"
                    >
                        <option>512 samples (Low Latency)</option>
                        <option>1024 samples (Balanced)</option>
                        <option>2048 samples (Stable)</option>
                    </select>
                </div>
            </div>
        </section>

        {/* API Section */}
        <section>
            <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500">
                    <Shield size={16} />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">API Configuration</h3>
            </div>
            <div className="glass-panel rounded-3xl p-6">
                <div className="mb-1">
                    <label className="block text-xs text-neutral-400 mb-2 uppercase tracking-wider font-bold">Gemini API Key</label>
                    <div className="relative">
                         <input 
                            type="text" 
                            value="••••••••••••••••••••••••" 
                            disabled
                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-neutral-400 font-mono text-sm tracking-widest"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-primary-500 bg-primary-500/10 px-2 py-1 rounded border border-primary-500/20">
                            SECURE
                        </div>
                    </div>
                </div>
            </div>
        </section>

      </div>
    </ScrollArea>
  );
};
