
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Track, AudioState, PlaybackMode, EqualizerBand, DEFAULT_EQ_BANDS, ThemeColor, EQ_PRESETS } from './types';
import { Controls } from './components/Controls';
import { Visualizer } from './components/Visualizer';
import { Navigation } from './components/Navigation';
import { TitleBar } from './components/TitleBar';
import { FilesPage } from './pages/FilesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ConnectPage } from './pages/ConnectPage';
import { SearchPage } from './pages/SearchPage';
import { AudiophilePage } from './pages/AudiophilePage'; 
import { Equalizer } from './components/Equalizer';
import { Toast } from './components/Toast';
import { QueueDrawer } from './components/QueueDrawer';
import { Sparkles, FileDigit, Shrink, Sliders, Activity, Disc } from 'lucide-react';
import { getTrackInsight } from './services/geminiService';
import { Logo } from './components/Logo';
import { NativeAudioService } from './services/nativeAudio';

type Page = 'files' | 'player' | 'settings' | 'connect' | 'search' | 'audiophile';

const App: React.FC = () => {
  // DEFAULT PAGE IS NOW PLAYER
  const [activePage, setActivePage] = useState<Page>('player');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [showEq, setShowEq] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [isFullPlayer, setIsFullPlayer] = useState(true); // Default to full player view
  
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    playbackRate: 1.0,
    isPuristMode: true, // Default to Bit-Perfect mode
    sampleRate: 44100,
    bufferSize: 2048,
    processingPrecision: '32-bit float' 
  });

  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(PlaybackMode.SEQUENCE);
  const [aiInsight, setAiInsight] = useState<string>("");
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  
  const [eqBands, setEqBands] = useState<EqualizerBand[]>(DEFAULT_EQ_BANDS.map(b => ({...b})));
  const [currentPresetId, setCurrentPresetId] = useState<string>('manual');
  const [currentThemeId, setCurrentThemeId] = useState('immersive');
  
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const isTauri = useMemo(() => !!(window as any).__TAURI__, []);

  const [bgImageLayer1, setBgImageLayer1] = useState<string | null>(null);
  const [bgImageLayer2, setBgImageLayer2] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<1 | 2>(1);

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqNodesRef = useRef<BiquadFilterNode[]>([]);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null); 

  const showToast = (message: string) => {
    setToastMsg(message);
  };

  // --- AUDIO ENGINE ---
  useEffect(() => {
    if (currentTrackIndex !== -1 && tracks[currentTrackIndex]) {
      const track = tracks[currentTrackIndex];
      
      let newUrl = '';
      if (track.path && (track.path.startsWith('http') || track.path.startsWith('blob:'))) {
          newUrl = track.path;
      } else {
          newUrl = URL.createObjectURL(track.file);
      }
      
      setBlobUrl(newUrl);

      // Transitions
      const newImage = track.image || null;
      if (activeLayer === 1) {
          setBgImageLayer2(newImage);
          setActiveLayer(2);
      } else {
          setBgImageLayer1(newImage);
          setActiveLayer(1);
      }
      
      if(audioRef.current) {
          audioRef.current.src = newUrl;
          if(audioState.isPlaying) audioRef.current.play().catch(() => {});
      }

      if (audioState.isPuristMode && isTauri && track.path && !track.path.startsWith('http')) {
          NativeAudioService.play(track.path).then(success => {
              if (success && audioRef.current) {
                  audioRef.current.volume = 0; 
              }
          });
      }

      return () => {
        if (!newUrl.startsWith('http')) URL.revokeObjectURL(newUrl); 
        if (isTauri && audioState.isPuristMode) NativeAudioService.stop();
      };
    }
  }, [currentTrackIndex, tracks, audioState.isPuristMode, isTauri]);

  const reconnectGraph = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !sourceNodeRef.current || !analyserNodeRef.current || !gainNodeRef.current) return;

    const source = sourceNodeRef.current;
    const analyser = analyserNodeRef.current;
    const gainNode = gainNodeRef.current;
    const destination = ctx.destination;

    try {
        source.disconnect();
        eqNodesRef.current.forEach(n => n.disconnect());
        analyser.disconnect();
        gainNode.disconnect();
    } catch(e) { }

    let currentNode: AudioNode = source;

    if (!audioState.isPuristMode) {
      if (eqNodesRef.current.length === 0) {
        eqNodesRef.current = eqBands.map(band => {
            const filter = ctx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = band.frequency;
            filter.gain.value = band.gain;
            filter.Q.value = 1; 
            return filter;
        });
      }
      eqNodesRef.current.forEach(filter => {
          currentNode.connect(filter);
          currentNode = filter;
      });
    }

    currentNode.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(destination);

  }, [audioState.isPuristMode, eqBands]);

  useEffect(() => {
      if (!audioRef.current) return;
      const initAudioGraph = () => {
          if (!audioContextRef.current) {
             const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
             audioContextRef.current = new AudioContext({ latencyHint: 'playback' });
          }
          const ctx = audioContextRef.current;
          if (ctx.state === 'suspended') ctx.resume();
          setAudioState(prev => ({...prev, sampleRate: ctx.sampleRate}));
          if (!sourceNodeRef.current) {
              try { sourceNodeRef.current = ctx.createMediaElementSource(audioRef.current); } catch (e) { return; }
          }
          if (!analyserNodeRef.current) {
              analyserNodeRef.current = ctx.createAnalyser();
              analyserNodeRef.current.fftSize = 8192; 
              analyserNodeRef.current.smoothingTimeConstant = 0.85;
          }
          if (!gainNodeRef.current) {
              gainNodeRef.current = ctx.createGain();
              gainNodeRef.current.gain.value = 1.0;
          }
          reconnectGraph();
      };
      if (audioState.isPlaying) initAudioGraph();
      document.addEventListener('click', initAudioGraph, { once: true });
  }, [audioState.isPlaying, reconnectGraph]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioState.isPlaying) { 
        audio.play().catch(console.warn); 
        if (isTauri && audioState.isPuristMode) NativeAudioService.resume(); 
    } else { 
        audio.pause(); 
        if (isTauri && audioState.isPuristMode) NativeAudioService.pause(); 
    }
  }, [audioState.isPlaying, isTauri, audioState.isPuristMode]);

  useEffect(() => {
      if (!audioState.isPuristMode && audioContextRef.current) {
        eqNodesRef.current.forEach((node, i) => {
            if (node && eqBands[i]) {
                node.gain.setValueAtTime(eqBands[i].gain, audioContextRef.current?.currentTime || 0);
            }
        });
      }
  }, [eqBands, audioState.isPuristMode]);

  const handleImportPlaylist = (newTracks: Track[], name: string) => {
      setTracks(prev => [...prev, ...newTracks]);
      showToast(`Imported "${name}" (${newTracks.length} tracks)`);
      if (currentTrackIndex === -1 && newTracks.length > 0) {
          setCurrentTrackIndex(tracks.length); 
          setAudioState(prev => ({...prev, isPlaying: true}));
      }
  };

  const processFiles = async (files: File[] | FileList) => {
      const fileList = Array.from(files);
      const initialTracks: Track[] = fileList.map(file => ({
          id: crypto.randomUUID(), 
          file, 
          path: (file as any).path, 
          name: file.name.replace(/\.[^/.]+$/, ""), 
          artist: "Unknown Artist", 
          format: file.name.split('.').pop()?.toUpperCase() || "RAW", 
          isLiked: false, 
          dateAdded: Date.now(), 
          fileSize: file.size, 
          source: 'local'
      }));
      setTracks(prev => [...prev, ...initialTracks]);
      showToast(`Imported ${fileList.length} tracks`);
  };

  const handlePlayPause = () => {
      if (currentTrackIndex === -1 && tracks.length > 0) { 
          setCurrentTrackIndex(0); 
          setAudioState(prev => ({ ...prev, isPlaying: true })); 
      } else if (currentTrackIndex !== -1) { 
          setAudioState(prev => ({ ...prev, isPlaying: !prev.isPlaying })); 
      }
  };

  const handleNext = useCallback((force: boolean = false) => {
    if (tracks.length === 0) return;
    if (playbackMode === PlaybackMode.SHUFFLE) {
         setCurrentTrackIndex(Math.floor(Math.random() * tracks.length));
    } else {
         setCurrentTrackIndex(prev => (prev + 1) % tracks.length);
    }
    setAudioState(prev => ({ ...prev, isPlaying: true }));
  }, [tracks.length, playbackMode]);

  const handlePrev = () => {
    if (tracks.length === 0) return;
    if (audioRef.current && audioRef.current.currentTime > 3) { audioRef.current.currentTime = 0; return; }
    setCurrentTrackIndex(prev => (prev - 1 + tracks.length) % tracks.length);
    setAudioState(prev => ({ ...prev, isPlaying: true }));
  };

  const handleSeek = (time: number) => {
      if (audioRef.current) {
          audioRef.current.currentTime = time;
          setAudioState(prev => ({ ...prev, currentTime: time }));
          if (isTauri && audioState.isPuristMode) NativeAudioService.seek(time);
      }
  };

  const generateInsight = async () => {
      if (currentTrackIndex === -1) return;
      setIsLoadingInsight(true);
      const track = tracks[currentTrackIndex];
      const text = await getTrackInsight(track.artist, track.name);
      setAiInsight(text);
      setIsLoadingInsight(false);
  };

  const currentTrack = tracks[currentTrackIndex];
  const isImmersive = currentThemeId === 'immersive';
  
  const NowPlayingView = () => (
    <div className="h-full flex flex-col p-6 animate-in fade-in duration-500 justify-center">
         <div className="flex gap-12 items-center justify-center max-w-6xl mx-auto w-full">
             
             {/* Art & Viz */}
             <div className="w-[40vw] max-w-[500px] aspect-square rounded-[32px] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative group bg-neutral-900 border border-white/10 ring-1 ring-white/5">
                 {currentTrack?.image ? (
                     <img src={currentTrack.image} className="w-full h-full object-cover transition-transform duration-[10s] ease-linear group-hover:scale-105" />
                 ) : (
                     <Visualizer isPlaying={audioState.isPlaying} analyser={analyserNodeRef.current} />
                 )}
                 <button 
                    onClick={() => { setActivePage('files'); setIsFullPlayer(false); }}
                    className="absolute top-4 right-4 p-2.5 bg-black/40 hover:bg-black/80 backdrop-blur-xl rounded-full text-white opacity-0 group-hover:opacity-100 transition-all border border-white/10"
                    title="Minimize"
                >
                    <Shrink size={18} />
                </button>
             </div>
             
             {/* Info & Tools */}
             <div className="flex-1 max-w-md space-y-8">
                 <div className="space-y-2">
                     <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white leading-[1.1] drop-shadow-2xl">
                         {currentTrack?.name || "Rawh Player"}
                     </h1>
                     <p className="text-2xl text-white/60 font-light tracking-wide">{currentTrack?.artist || "Ready to Play"}</p>
                 </div>

                 {/* Tech Badges */}
                 {currentTrack && (
                     <div className="flex flex-wrap gap-2 text-[10px] font-bold tracking-widest uppercase text-neutral-400">
                         <span className="px-2 py-1 rounded bg-white/5 border border-white/5 flex items-center gap-1.5">
                            <FileDigit size={12} className="text-primary-500" />
                            {currentTrack.format || 'FLAC'}
                         </span>
                         <span className="px-2 py-1 rounded bg-white/5 border border-white/5 flex items-center gap-1.5">
                            <Activity size={12} className="text-blue-400" />
                            {currentTrack.bitrate ? `${currentTrack.bitrate} kbps` : 'Lossless'}
                         </span>
                         <span className="px-2 py-1 rounded bg-white/5 border border-white/5 flex items-center gap-1.5">
                            <Activity size={12} className="text-green-400" />
                            {audioState.sampleRate / 1000} kHz
                         </span>
                     </div>
                 )}

                 {/* Tools */}
                 <div className="flex gap-3 pt-4">
                     <button onClick={() => setShowEq(!showEq)} className={`px-5 py-2.5 rounded-full border border-white/10 flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-all hover:scale-105 ${showEq ? 'bg-primary-500 text-black shadow-[0_0_20px_rgba(var(--primary-500),0.4)]' : 'bg-white/5 text-neutral-300 hover:text-white hover:bg-white/10'}`}>
                         <Sliders size={14} /> Equalizer
                     </button>
                     <button onClick={generateInsight} className="px-5 py-2.5 rounded-full border border-white/10 flex items-center gap-2 text-xs font-bold uppercase tracking-wider bg-white/5 text-neutral-300 hover:text-white hover:bg-white/10 transition-all hover:scale-105">
                        <Sparkles size={14} className="text-purple-400" /> {isLoadingInsight ? 'Analyzing...' : 'AI Insight'}
                     </button>
                 </div>
                 
                 {aiInsight && (
                     <div className="p-5 bg-white/5 border border-white/10 rounded-2xl text-sm text-neutral-200 leading-relaxed backdrop-blur-md shadow-inner">
                         {aiInsight}
                     </div>
                 )}
             </div>
         </div>
    </div>
  );

  return (
    <div className={`flex flex-col h-screen bg-black text-white overflow-hidden relative font-sans selection:bg-primary-500/30`}>
      <audio ref={audioRef} crossOrigin="anonymous" onTimeUpdate={() => setAudioState(p => ({...p, currentTime: audioRef.current?.currentTime || 0}))} onEnded={() => handleNext()} />
      <Toast message={toastMsg} isVisible={!!toastMsg} onClose={() => setToastMsg("")} />
      <TitleBar />

      {/* --- BACKGROUND --- */}
      {isImmersive ? (
        <div className="absolute inset-0 z-0 overflow-hidden bg-neutral-950">
             <div className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[2000ms] ${activeLayer === 1 ? 'opacity-50' : 'opacity-0'}`} style={{ backgroundImage: bgImageLayer1 ? `url(${bgImageLayer1})` : undefined, filter: 'blur(120px) saturate(1.2)' }} />
             <div className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[2000ms] ${activeLayer === 2 ? 'opacity-50' : 'opacity-0'}`} style={{ backgroundImage: bgImageLayer2 ? `url(${bgImageLayer2})` : undefined, filter: 'blur(120px) saturate(1.2)' }} />
             <div className="absolute inset-0 bg-black/40" />
        </div>
      ) : (
          <div className="absolute inset-0 overflow-hidden -z-10 bg-black">
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03] scale-[2.5] pointer-events-none"><Logo /></div>
             <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-primary-900/15 via-black to-black" />
          </div>
      )}

      {/* --- LAYOUT --- */}
      <div className="flex flex-1 overflow-hidden relative z-10 bg-transparent">
          
          <Navigation activePage={activePage} onNavigate={(p) => { 
              setActivePage(p); 
              setIsFullPlayer(p === 'player'); 
          }} />
          
          <div className={`flex-1 flex flex-col relative transition-all duration-300`}>
              <div className="flex-1 overflow-hidden pb-24 relative">
                 {activePage === 'player' ? (
                     <NowPlayingView />
                 ) : (
                    <>
                        {activePage === 'files' && <FilesPage tracks={tracks} onPlay={(t) => {
                            const idx = tracks.findIndex(x => x.id === t.id);
                            if(idx !== currentTrackIndex) { setCurrentTrackIndex(idx); setAudioState(s=>({...s, isPlaying: true})); }
                            else { setAudioState(s=>({...s, isPlaying: !s.isPlaying})); }
                        }} onUpload={(e) => e.target.files && processFiles(e.target.files)} onPlayNext={id => {
                            const t = tracks.find(x => x.id === id); if(t) { const idx = tracks.indexOf(t); const n = [...tracks]; n.splice(idx,1); n.splice(currentTrackIndex+1,0,t); setTracks(n); }
                        }} onAddToQueue={id => {
                            const t = tracks.find(x => x.id === id); if(t) { const idx = tracks.indexOf(t); const n = [...tracks]; n.push(t); setTracks(n); }
                        }} onRemove={id => setTracks(p => p.filter(x => x.id !== id))} />}
                        
                        {activePage === 'search' && <SearchPage tracks={tracks} onPlay={(t) => {
                            const idx = tracks.findIndex(x => x.id === t.id);
                            if (idx === -1) { setTracks(p => [...p, t]); setCurrentTrackIndex(tracks.length); }
                            else { setCurrentTrackIndex(idx); }
                            setAudioState(s => ({...s, isPlaying: true}));
                        }} />}
                        
                        {activePage === 'connect' && <ConnectPage onPlayUrl={url => {
                            const t: Track = { id: crypto.randomUUID(), file: new File([], 'stream'), path: url, name: 'Stream', artist: 'Network', format: 'STREAM', dateAdded: Date.now(), fileSize: 0, source: 'local' };
                            setTracks(p => [...p, t]); setCurrentTrackIndex(tracks.length); setAudioState(s => ({...s, isPlaying: true}));
                        }} onImportPlaylist={handleImportPlaylist} />}
                        
                        {activePage === 'audiophile' && <AudiophilePage analyserNode={analyserNodeRef.current} sampleRate={audioState.sampleRate} />}
                        
                        {activePage === 'settings' && <SettingsPage currentThemeId={currentThemeId} onThemeChange={t => { setCurrentThemeId(t.id); document.documentElement.style.setProperty('--primary-500', t.colors[500]); }} isPuristMode={audioState.isPuristMode} onTogglePurist={() => setAudioState(p => ({...p, isPuristMode: !p.isPuristMode}))} processingPrecision={audioState.processingPrecision} onTogglePrecision={() => setAudioState(p => ({...p, processingPrecision: p.processingPrecision === '16-bit' ? '32-bit float' : '16-bit'}))} />}
                    </>
                 )}
              </div>
          </div>

          {/* QUEUE DRAWER */}
          <QueueDrawer 
             tracks={tracks} 
             currentTrackId={currentTrack?.id || null} 
             isOpen={showQueue} 
             onClose={() => setShowQueue(false)}
             onSelect={(t) => { setCurrentTrackIndex(tracks.findIndex(x=>x.id===t.id)); setAudioState(p=>({...p, isPlaying:true})); }}
             onRemove={(id) => setTracks(p => p.filter(x => x.id !== id))}
             onShuffle={() => { /* Shuffle logic */ }}
             onClear={() => setTracks([])}
          />
      </div>

      {isDragging && (
          <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur flex items-center justify-center pointer-events-none">
              <div className="text-center animate-bounce text-primary-500"><FileDigit size={64} /><h2 className="text-2xl font-bold mt-4">DROP TO IMPORT</h2></div>
          </div>
      )}

      <Controls 
          state={audioState} 
          currentTrack={currentTrack} 
          onPlayPause={handlePlayPause} 
          onNext={() => handleNext(false)} 
          onPrev={handlePrev} 
          onSeek={handleSeek} 
          onVolumeChange={(v) => setAudioState(p => ({...p, volume: v, isMuted: v === 0}))} 
          onToggleMute={() => setAudioState(p => ({...p, isMuted: !p.isMuted}))} 
          playbackMode={playbackMode} 
          onToggleMode={() => {}} 
          onToggleLike={() => {}} 
          onSpeedChange={(s) => setAudioState(p => ({...p, playbackRate: s}))}
          showQueue={showQueue}
          onToggleQueue={() => setShowQueue(!showQueue)}
          isExpanded={isFullPlayer}
          onToggleExpand={() => { 
              if(isFullPlayer) { setIsFullPlayer(false); setActivePage('files'); }
              else { setIsFullPlayer(true); setActivePage('player'); }
          }}
      />

      <Equalizer 
        isOpen={showEq} 
        onClose={() => setShowEq(false)} 
        bands={eqBands} 
        onBandChange={(i, g) => { 
            const n = [...eqBands]; n[i].gain = g; setEqBands(n); setCurrentPresetId('manual'); 
        }} 
        onReset={() => { /* Reset */ }} 
        currentPresetId={currentPresetId} 
        onPresetChange={(id) => { 
            setCurrentPresetId(id); 
            const p = EQ_PRESETS.find(x => x.id === id); 
            if(p) setEqBands(p.bands.map(b => ({...b}))); 
        }} 
        analyser={analyserNodeRef.current} 
      />

    </div>
  );
};

export default App;
