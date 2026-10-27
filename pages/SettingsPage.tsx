import React from 'react';
import { Shield, Volume2, Palette, ToggleRight, ToggleLeft } from 'lucide-react';
import { ThemeColor, THEMES } from '../types';
import { ScrollArea } from '../components/ScrollArea';
import { invoke } from '@tauri-apps/api/core';

interface SettingsPageProps {
    currentThemeId: string;
    onThemeChange: (theme: ThemeColor) => void;
    isPuristMode: boolean;
    onTogglePurist: () => void;
    bufferSize?: number;
    processingPrecision?: '16-bit' | '32-bit float';
    onTogglePrecision?: () => void;
    onBufferSizeChange?: (size: number) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ 
    currentThemeId, 
    onThemeChange, 
    isPuristMode, 
    onTogglePurist, 
    bufferSize = 2048,
    processingPrecision = '32-bit float',
    onTogglePrecision,
    onBufferSizeChange
}) => {
    const [geminiKey, setGeminiKey] = React.useState(localStorage.getItem('rawh_gemini_api_key') || '');
    const [youtubeKey, setYoutubeKey] = React.useState(localStorage.getItem('rawh_youtube_api_key') || '');
    const [audioDevices, setAudioDevices] = React.useState<string[]>([]);
    const [selectedDevice, setSelectedDevice] = React.useState<string>('default');
    const [crossfade, setCrossfade] = React.useState<number>(0);

    React.useEffect(() => {
        invoke('list_audio_devices').then((devices: any) => {
            if (Array.isArray(devices)) {
                setAudioDevices(devices);
            }
        }).catch(e => console.error('Failed to list audio devices', e));
    }, []);

    const handleGeminiChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setGeminiKey(val);
        localStorage.setItem('rawh_gemini_api_key', val);
    };

    const handleYoutubeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setYoutubeKey(val);
        localStorage.setItem('rawh_youtube_api_key', val);
    };

    const handleCrossfadeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = Number(e.target.value);
        setCrossfade(val);
        invoke('set_crossfade_duration', { seconds: val }).catch(e => console.error('Failed to set crossfade', e));
    };

    const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedDevice(e.target.value);
        // Note: Actual device setting might need another invoke call depending on Rust implementation.
    };
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
            <fieldset className="glass-panel rounded-3xl p-6 md:p-8 border-transparent">
                <legend className="text-white font-medium mb-6 text-base px-1">Theme Engine</legend>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                    {THEMES.map(theme => (
                        <button 
                            key={theme.id}
                            onClick={() => onThemeChange(theme)}
                            aria-label={`Select ${theme.name} theme`}
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
            </fieldset>
        </section>

        {/* Audio Section */}
        <section>
            <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500">
                    <Volume2 size={16} />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Audio Engine</h3>
            </div>
            <fieldset className="glass-panel rounded-3xl p-0 overflow-hidden border-transparent">
                <legend className="sr-only">Audio Engine Configuration</legend>
                <div className="p-6 flex items-center justify-between border-b border-white/5 hover:bg-white/5 transition-colors">
                    <div>
                        <label htmlFor="audio-purist-switch" className="text-white text-base font-medium mb-1 flex items-center gap-2 cursor-pointer">
                             Audio Purist Mode <span className="px-1.5 py-0.5 rounded bg-primary-500 text-black text-[9px] font-bold">BIT PERFECT</span>
                        </label>
                        <div className="text-xs text-neutral-500">Bypasses EQ and DSP for transparent signal path.</div>
                    </div>
                    <button 
                        id="audio-purist-switch"
                        onClick={onTogglePurist} 
                        role="switch"
                        aria-checked={isPuristMode}
                        aria-label="Audio Purist Mode"
                        className={`transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/50 rounded-lg ${isPuristMode ? 'text-primary-500' : 'text-neutral-600'}`}
                    >
                        {isPuristMode ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                    </button>
                </div>
                
                <div className="p-6 flex items-center justify-between border-b border-white/5 hover:bg-white/5 transition-colors">
                    <div>
                        <label htmlFor="dsp-precision-switch" className="text-white text-base font-medium mb-1 cursor-pointer">32-Bit Floating Point</label>
                        <div className="text-xs text-neutral-500">Internal DSP precision resolution.</div>
                    </div>
                    <button 
                        id="dsp-precision-switch"
                        onClick={onTogglePrecision} 
                        role="switch"
                        aria-checked={processingPrecision === '32-bit float'}
                        aria-label="32-Bit Floating Point Precision"
                        className={`transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/50 rounded-lg ${processingPrecision === '32-bit float' ? 'text-primary-500' : 'text-neutral-600'}`}
                    >
                        {processingPrecision === '32-bit float' ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                    </button>
                </div>

                <div className="p-6 flex items-center justify-between hover:bg-white/5 transition-colors">
                    <div>
                        <label htmlFor="buffer-size-select" className="text-white text-base font-medium mb-1 cursor-pointer">Buffer Size</label>
                        <div className="text-xs text-neutral-500">Lower latency vs stability.</div>
                    </div>
                    <select 
                        id="buffer-size-select"
                        value={bufferSize}
                        onChange={(e) => onBufferSizeChange?.(Number(e.target.value))}
                        className="bg-black/50 border border-white/10 text-xs text-white rounded-lg px-3 py-2 outline-none focus:border-primary-500 transition-colors focus:ring-1 focus:ring-primary-500/50"
                    >
                        <option value={512}>512 samples (Low Latency)</option>
                        <option value={1024}>1024 samples (Balanced)</option>
                        <option value={2048}>2048 samples (Stable)</option>
                    </select>
                </div>

                <div className="p-6 flex items-center justify-between border-b border-white/5 hover:bg-white/5 transition-colors">
                    <div>
                        <label htmlFor="audio-device-select" className="text-white text-base font-medium mb-1 cursor-pointer">Audio Output Device</label>
                        <div className="text-xs text-neutral-500">Select playback hardware.</div>
                    </div>
                    <select 
                        id="audio-device-select"
                        value={selectedDevice}
                        onChange={handleDeviceChange}
                        className="bg-black/50 border border-white/10 text-xs text-white rounded-lg px-3 py-2 outline-none focus:border-primary-500 transition-colors focus:ring-1 focus:ring-primary-500/50 max-w-[200px] truncate"
                    >
                        <option value="default">System Default</option>
                        {audioDevices.map((d, i) => <option key={i} value={d}>{d}</option>)}
                    </select>
                </div>

                <div className="p-6 flex flex-col gap-2 hover:bg-white/5 transition-colors border-b border-white/5">
                    <div className="flex items-center justify-between">
                        <label htmlFor="crossfade-slider" className="text-white text-base font-medium mb-1 cursor-pointer">Crossfade</label>
                        <span className="text-xs font-bold bg-white/10 px-2 py-1 rounded text-white">{crossfade === 0 ? '0s (Gapless)' : `${crossfade}s`}</span>
                    </div>
                    <div className="text-xs text-neutral-500 mb-2">Smooth transition between tracks.</div>
                    <input 
                        id="crossfade-slider"
                        type="range"
                        min="0"
                        max="12"
                        step="1"
                        value={crossfade}
                        onChange={handleCrossfadeChange}
                        className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary-500"
                    />
                </div>
            </fieldset>
        </section>

        {/* API Section */}
        <section>
            <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500">
                    <Shield size={16} />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">API Configuration</h3>
            </div>
            <fieldset className="glass-panel rounded-3xl p-6 border-transparent">
                <legend className="sr-only">API Configuration Settings</legend>
                <div className="mb-4">
                    <label htmlFor="gemini-api-key" className="block text-xs text-neutral-400 mb-2 uppercase tracking-wider font-bold cursor-pointer">Gemini API Key</label>
                    <div className="relative">
                         <input 
                            id="gemini-api-key"
                            type="password" 
                            value={geminiKey}
                            onChange={handleGeminiChange}
                            placeholder="Enter Gemini API Key..."
                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-neutral-400 font-mono text-sm tracking-widest focus:border-primary-500 outline-none transition-colors focus:ring-1 focus:ring-primary-500/50"
                        />
                    </div>
                </div>
                <div className="mb-1">
                    <label htmlFor="youtube-api-key" className="block text-xs text-neutral-400 mb-2 uppercase tracking-wider font-bold cursor-pointer">YouTube API Key</label>
                    <div className="relative">
                         <input 
                            id="youtube-api-key"
                            type="password" 
                            value={youtubeKey}
                            onChange={handleYoutubeChange}
                            placeholder="Enter YouTube API Key..."
                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-neutral-400 font-mono text-sm tracking-widest focus:border-primary-500 outline-none transition-colors focus:ring-1 focus:ring-primary-500/50"
                        />
                    </div>
                </div>
            </fieldset>
        </section>

      </div>
    </ScrollArea>
  );
};
