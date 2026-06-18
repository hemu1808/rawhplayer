import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Track, AudioState, PlaybackMode, EqualizerBand, DEFAULT_EQ_BANDS, EQ_PRESETS } from './types';
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
import { Sparkles, Sliders, Waves, AudioWaveform, Zap } from 'lucide-react';
import { getTrackInsight } from './services/geminiService';
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type Page = 'player' | 'files' | 'settings' | 'connect' | 'search' | 'audiophile';

const App: React.FC = () => {
  const [activePage, setActivePage] = useState<Page>('player'); 
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [showEq, setShowEq] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  
  // Audio Engine State
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    playbackRate: 1.0,
    isPuristMode: true, 
    sampleRate: 44100, 
    bufferSize: 2048,
    processingPrecision: '32-bit float'
  });

  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(PlaybackMode.SEQUENCE);
  const [aiInsight, setAiInsight] = useState<string>("");
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [mouseIdle, setMouseIdle] = useState(false);
  
  const [eqBands, setEqBands] = useState<EqualizerBand[]>(DEFAULT_EQ_BANDS.map(b => ({ ...b })));
  const [currentPresetId, setCurrentPresetId] = useState<string>('manual');
  const [currentThemeId, setCurrentThemeId] = useState('reference');
  
  const mouseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTrack = tracks[currentTrackIndex];

  // Refs to prevent stale closures and event listener churn (H-5, H-6, H-7)
  const audioStateRef = useRef(audioState);
  audioStateRef.current = audioState;

  const currentTrackIndexRef = useRef(currentTrackIndex);
  currentTrackIndexRef.current = currentTrackIndex;

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const playbackModeRef = useRef(playbackMode);
  playbackModeRef.current = playbackMode;

  // --- MOUSE IDLE (Cinematic Feel) ---
  useEffect(() => {
    const handleMove = () => {
        setMouseIdle(false);
        if (mouseTimer.current) clearTimeout(mouseTimer.current);
        mouseTimer.current = setTimeout(() => {
            if (audioState.isPlaying && !showQueue && !showEq && !isDragging) {
                setMouseIdle(true);
            }
        }, 4000);
    };
    window.addEventListener('mousemove', handleMove);
    return () => {
        window.removeEventListener('mousemove', handleMove);
        if (mouseTimer.current) clearTimeout(mouseTimer.current);
    };
  }, [audioState.isPlaying, showQueue, showEq, isDragging]);

  // --- TAURI EVENT LISTENERS ---
  useEffect(() => {
      const unlistenPlayback = listen<{ current_time: number, duration: number, is_playing: boolean }>('playback_update', (event) => {
          setAudioState(s => ({
              ...s,
              currentTime: event.payload.current_time,
              duration: event.payload.duration,
              isPlaying: event.payload.is_playing
          }));
      });
      return () => { 
          unlistenPlayback.then(f => f()); 
      };
  }, []);

      // Manage revoking of track blob URLs to prevent memory leaks (C-4)
      const prevTracksRef = useRef<Track[]>([]);
      useEffect(() => {
          const removedTracks = prevTracksRef.current.filter(
              pt => !tracks.some(t => t.id === pt.id)
          );
          for (const track of removedTracks) {
              if (track.image && track.image.startsWith('blob:')) {
                  URL.revokeObjectURL(track.image);
              }
          }
          prevTracksRef.current = tracks;
      }, [tracks]);

      useEffect(() => {
          return () => {
              // Revoke all remaining blob URLs on unmount
              for (const track of prevTracksRef.current) {
                  if (track.image && track.image.startsWith('blob:')) {
                      URL.revokeObjectURL(track.image);
                  }
              }
          };
      }, []);

      const showToast = (msg: string) => setToastMsg(msg);

  // --- METADATA EXTRACTION ---
  const extractMetadata = async (file: File): Promise<Partial<Track>> => {
      return new Promise((resolve) => {
          const meta: Partial<Track> = {};
          if (!jsmediatags) { resolve(meta); return; }

          jsmediatags.read(file, {
              onSuccess: (tag: any) => {
                  if (tag.tags.title) meta.name = tag.tags.title;
                  if (tag.tags.artist) meta.artist = tag.tags.artist;
                  if (tag.tags.album) meta.album = tag.tags.album;
                  
                  if (tag.tags.picture) {
                      const { data, format } = tag.tags.picture;
                      // Safe, zero-copy object URL instead of slow base64 loop
                      const blob = new Blob([new Uint8Array(data)], { type: format });
                      meta.image = URL.createObjectURL(blob);
                  }
                  resolve(meta);
              },
              onError: () => resolve(meta)
          });
      });
  };

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const newTracks: Track[] = [];
    
    for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!['mp3','flac','wav','ogg','aac','m4a','aiff','dsf','dff'].includes(ext || '')) continue;

        const baseMeta = {
             id: crypto.randomUUID(),
             file,
             name: file.name.replace(/\.[^/.]+$/, ""),
             artist: "Unknown Artist",
             format: ext?.toUpperCase() || "RAW",
             dateAdded: Date.now(),
             bitrate: Math.round(file.size / 1024 / 3), // Rough estimation
        };

        const deepMeta = await extractMetadata(file);
        
        // Quick duration check
        const tempUrl = URL.createObjectURL(file);
        const tempAudio = new Audio(tempUrl);
        const duration = await new Promise<number>((resolve) => {
            tempAudio.onloadedmetadata = () => resolve(tempAudio.duration);
            tempAudio.onerror = () => resolve(0);
        });
        URL.revokeObjectURL(tempUrl);

        newTracks.push({ ...baseMeta, ...deepMeta, duration } as Track);
    }

    if (newTracks.length > 0) {
        setTracks(prev => {
            const updated = [...prev, ...newTracks];
            if (prev.length === 0) {
                 setCurrentTrackIndex(0);
                 setAudioState(p => ({ ...p, isPlaying: true }));
            }
            return updated;
        });
        showToast(`Imported ${newTracks.length} tracks`);
    }
  }, []);

  // --- GLOBAL DRAG AND DROP ---
  const handleDragDrop = useCallback((e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer?.files) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  useEffect(() => {
      const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
      const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); };
      
      window.addEventListener('drop', handleDragDrop);
      window.addEventListener('dragover', handleDragOver);
      window.addEventListener('dragleave', handleDragLeave);
      
      return () => {
          window.removeEventListener('drop', handleDragDrop);
          window.removeEventListener('dragover', handleDragOver);
          window.removeEventListener('dragleave', handleDragLeave);
      };
  }, [handleDragDrop]);

  // --- CONTROLS LOGIC ---
  const handleNext = useCallback(() => {
     if (tracksRef.current.length === 0) return;
     setCurrentTrackIndex(prevIdx => {
         let nextIdx = prevIdx + 1;
         if (playbackModeRef.current === PlaybackMode.SHUFFLE) {
             nextIdx = Math.floor(Math.random() * tracksRef.current.length);
         }
         if (nextIdx >= tracksRef.current.length) nextIdx = 0;
         return nextIdx;
     });
  }, []);

  const handlePrev = useCallback(() => {
      if (audioStateRef.current.currentTime > 3) {
          invoke('seek_audio', { position: 0.0 }).catch(console.error);
          return;
      }
      setCurrentTrackIndex(prevIdx => {
          let prev = prevIdx - 1;
          if (prev < 0) prev = tracksRef.current.length - 1;
          return prev;
      });
  }, []);

  const handlePlayPause = useCallback(() => {
      setCurrentTrackIndex(prevIdx => {
          if (prevIdx === -1 && tracksRef.current.length > 0) {
              return 0;
          }
          invoke('toggle_play').catch(console.error);
          return prevIdx;
      });
  }, []);

  const handleRemoveTrack = useCallback((id: string) => {
      setTracks(prev => {
          const idx = prev.findIndex(t => t.id === id);
          if (idx === -1) return prev;
          
          if (idx < currentTrackIndexRef.current) {
              setCurrentTrackIndex(curr => curr - 1);
          } else if (idx === currentTrackIndexRef.current) {
              if (prev.length <= 1) {
                  setCurrentTrackIndex(-1);
                  setAudioState(s => ({ ...s, isPlaying: false }));
              } else {
                  const nextIdx = idx >= prev.length - 1 ? idx - 1 : idx;
                  setCurrentTrackIndex(nextIdx);
              }
          }
          return prev.filter(t => t.id !== id);
      });
  }, []);

  const handlePlayNext = useCallback((id: string) => {
      setTracks(prev => {
          const idx = prev.findIndex(t => t.id === id);
          if (idx === -1) return prev;
          const targetIdx = currentTrackIndexRef.current + 1;
          if (idx === currentTrackIndexRef.current || idx === targetIdx) return prev;
          
          const nextTracks = [...prev];
          const [track] = nextTracks.splice(idx, 1);
          if (idx < currentTrackIndexRef.current) {
              setCurrentTrackIndex(curr => curr - 1);
              nextTracks.splice(targetIdx - 1, 0, track);
          } else {
              nextTracks.splice(targetIdx, 0, track);
          }
          return nextTracks;
      });
      showToast("Queued track next");
  }, []);

  const handleAddToQueue = useCallback((id: string) => {
      setTracks(prev => {
          const idx = prev.findIndex(t => t.id === id);
          if (idx === -1) return prev;
          if (idx === prev.length - 1) return prev;
          
          const nextTracks = [...prev];
          const [track] = nextTracks.splice(idx, 1);
          if (idx < currentTrackIndexRef.current) {
              setCurrentTrackIndex(curr => curr - 1);
          }
          nextTracks.push(track);
          return nextTracks;
      });
      showToast("Added track to end of queue");
  }, []);

  // Handle Playback File Selection
  useEffect(() => {
      if (currentTrack) {
          const path = (currentTrack.file as any).path || currentTrack.path;
          if (path) {
              invoke('play_file', { path }).catch(console.error);
          } else {
              showToast("Error: Missing absolute path for file (required for native engine).");
          }
      }
  }, [currentTrackIndex]); 

  // Handle Volume Synchronization
  useEffect(() => {
      invoke('set_volume', { volume: audioState.isMuted ? 0.0 : audioState.volume }).catch(console.error);
  }, [audioState.volume, audioState.isMuted]);

  // Track End Auto-Next logic via native events (H-1 / R-5 Fix)
  useEffect(() => {
      const unlistenEnded = listen('track_ended', () => {
          handleNext();
      });
      return () => {
          unlistenEnded.then(f => f());
      };
  }, [handleNext]);

  // AI Insights
  const generateInsight = async () => {
      if (!currentTrack) return;
      setIsLoadingInsight(true);
      const text = await getTrackInsight(currentTrack.artist, currentTrack.name);
      setAiInsight(text);
      setIsLoadingInsight(false);
  };

  // Keyboard Shortcuts (A-2)
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          // Ignore shortcuts when inside form elements
          if (document.activeElement?.tagName === 'INPUT' || 
              document.activeElement?.tagName === 'SELECT' || 
              document.activeElement?.tagName === 'TEXTAREA') {
              return;
          }
          
          if (e.code === 'Space') {
              e.preventDefault();
              handlePlayPause();
          } else if (e.code === 'ArrowRight') {
              e.preventDefault();
              invoke('seek_audio', { position: Math.min(audioState.duration, audioState.currentTime + 5.0) }).catch(console.error);
          } else if (e.code === 'ArrowLeft') {
              e.preventDefault();
              invoke('seek_audio', { position: Math.max(0.0, audioState.currentTime - 5.0) }).catch(console.error);
          }
      };
      
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- RENDER SECTION ---
  const renderContent = () => {
      switch (activePage) {
          case 'files':
              return <FilesPage 
                  tracks={tracks} 
                  onPlay={(t) => { setCurrentTrackIndex(tracks.findIndex(x => x.id === t.id)); setAudioState(s => ({ ...s, isPlaying: true })); setActivePage('player'); }}
                  onUpload={(e) => { if (e.target.files) processFiles(e.target.files); }}
                  onPlayNext={handlePlayNext}
                  onAddToQueue={handleAddToQueue}
                  onRemove={handleRemoveTrack}
              />;
          case 'search':
              return <SearchPage tracks={tracks} onPlay={(t) => {
                  setTracks(prev => [t, ...prev]); setCurrentTrackIndex(0); setAudioState(s => ({ ...s, isPlaying: true })); setActivePage('player');
              }} />;
          case 'audiophile':
              return <AudiophilePage sampleRate={audioState.sampleRate} />
          case 'connect':
              return <ConnectPage onPlayUrl={(url) => { /* stream logic */ }} />;
          case 'settings':
              return <SettingsPage 
                  currentThemeId={currentThemeId} 
                  onThemeChange={(t) => {
                      setCurrentThemeId(t.id);
                      document.documentElement.style.setProperty('--primary-500', t.colors[500]);
                      document.documentElement.style.setProperty('--primary-900', t.colors[900]);
                  }} 
                  isPuristMode={audioState.isPuristMode}
                  onTogglePurist={() => setAudioState(s => ({ ...s, isPuristMode: !s.isPuristMode }))}
                  processingPrecision={audioState.processingPrecision}
                  onTogglePrecision={() => setAudioState(s => ({ ...s, processingPrecision: s.processingPrecision === '16-bit' ? '32-bit float' : '16-bit' }))}
                  bufferSize={audioState.bufferSize}
                  onBufferSizeChange={(size) => setAudioState(s => ({ ...s, bufferSize: size }))}
              />;
          case 'player':
          default:
              return (
                <div className="h-full flex flex-col items-center justify-center p-6 relative overflow-hidden">
                    {/* Cinematic Background Blur */}
                    {currentTrack && (
                        <div className="absolute inset-0 z-0 select-none pointer-events-none">
                            <div className="absolute inset-0 bg-black/50 z-10" />
                            <img src={currentTrack.image} className="w-full h-full object-cover blur-[120px] opacity-40 scale-125" />
                        </div>
                    )}
                    
                    <div className="z-10 w-full max-w-7xl h-full flex flex-col md:flex-row gap-8 items-center justify-center">
                        {/* Center Stage: Visualizer / Art */}
                        <div className="flex-1 w-full max-h-[75vh] aspect-square max-w-[800px] relative group">
                            <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent rounded-[2rem] border border-white/10 shadow-2xl backdrop-blur-sm overflow-hidden">
                                
                                {/* Background Art Fade */}
                                {currentTrack?.image && (
                                    <div className="absolute inset-0 z-0 opacity-20 group-hover:opacity-10 transition-opacity duration-1000">
                                         <img src={currentTrack.image} className="w-full h-full object-cover" />
                                    </div>
                                )}
                                
                                <Visualizer isPlaying={audioState.isPlaying} />
                                
                                {/* Idle State */}
                                {!audioState.isPlaying && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="p-8 rounded-full bg-white/5 backdrop-blur-md border border-white/10 shadow-lg">
                                            <Sparkles className="text-white/40" size={64} strokeWidth={1} />
                                        </div>
                                    </div>
                                )}

                                {/* Top Info Area */}
                                <div className="absolute top-8 left-8 right-8 flex justify-between items-start pointer-events-none">
                                    <div className="space-y-2">
                                        {audioState.isPuristMode && (
                                            <div className="px-2 py-1 bg-primary-500 text-black text-[9px] font-extrabold tracking-widest uppercase rounded inline-flex items-center gap-1 shadow-glow">
                                                <Zap size={10} fill="currentColor" /> BIT PERFECT
                                            </div>
                                        )}
                                        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white tracking-tighter drop-shadow-2xl line-clamp-2">
                                            {currentTrack?.name || "Rawh Player"}
                                        </h1>
                                        <h2 className="text-xl md:text-2xl text-white/70 font-medium tracking-wide">
                                            {currentTrack?.artist || "High Fidelity Engine"}
                                        </h2>
                                    </div>
                                </div>

                                {/* Bottom Tech Badges */}
                                <div className="absolute bottom-8 left-8 flex items-center gap-3 select-none pointer-events-none">
                                     <div className="px-4 py-2 rounded-full bg-black/40 border border-white/10 backdrop-blur-md text-[10px] font-mono text-neutral-300 flex items-center gap-2">
                                         <AudioWaveform size={12} className="text-primary-500" />
                                         {currentTrack?.format || 'PCM'} • {currentTrack?.bitrate ? `${currentTrack.bitrate}kbps` : 'LOSSLESS'} • {audioState.sampleRate/1000}kHz
                                     </div>
                                     <div className="px-4 py-2 rounded-full bg-black/40 border border-white/10 backdrop-blur-md text-[10px] font-mono text-primary-500 font-bold uppercase">
                                         {audioState.processingPrecision}
                                     </div>
                                </div>
                                
                                {/* AI Action */}
                                <button 
                                    onClick={generateInsight}
                                    className="absolute bottom-8 right-8 p-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-md transition-all active:scale-95 group/ai"
                                    title="Generate Insight"
                                >
                                    <Sparkles size={24} className={isLoadingInsight ? 'animate-spin text-primary-500' : 'text-white'} />
                                </button>
                                
                                {aiInsight && (
                                    <div className="absolute bottom-24 right-8 max-w-sm p-6 bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-2xl text-sm text-neutral-200 shadow-2xl animate-in slide-in-from-bottom-5">
                                        {aiInsight}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Floating Tools Dock */}
                        <div className="hidden xl:flex flex-col gap-4 justify-center absolute right-8 top-1/2 -translate-y-1/2">
                            <button 
                                onClick={() => { setShowEq(true); setAudioState(s => ({ ...s, isPuristMode: false })); }} 
                                className={`w-14 h-14 rounded-2xl border flex items-center justify-center transition-all duration-300 shadow-xl ${!audioState.isPuristMode ? 'bg-primary-500 border-primary-400 text-black scale-110' : 'bg-black/40 border-white/10 backdrop-blur text-neutral-400 hover:text-white hover:bg-white/10'}`}
                                title="Equalizer"
                            >
                                <Sliders size={24} strokeWidth={1.5} />
                            </button>
                             <button 
                                className={`w-14 h-14 rounded-2xl border flex items-center justify-center transition-all bg-black/40 border-white/10 backdrop-blur text-neutral-600 cursor-not-allowed`}
                                title="Spatial Audio (Future)"
                            >
                                <Waves size={24} strokeWidth={1.5} />
                            </button>
                        </div>
                    </div>
                </div>
              );
      }
  };

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-white font-sans overflow-hidden selection:bg-primary-500/30">
      <TitleBar />
      <Toast message={toastMsg} isVisible={!!toastMsg} onClose={() => setToastMsg("")} />

      <div className="flex flex-1 overflow-hidden relative">
          <Navigation activePage={activePage} onNavigate={setActivePage} />
          
          <main className="flex-1 relative z-10 flex flex-col min-w-0">
              {renderContent()}
          </main>
          
          <QueueDrawer 
             tracks={tracks}
             currentTrackId={currentTrack?.id || null}
             isOpen={showQueue} 
             onClose={() => setShowQueue(false)}
             onSelect={(t) => { setCurrentTrackIndex(tracks.findIndex(x => x.id === t.id)); setAudioState(s => ({ ...s, isPlaying: true })); }}
             onRemove={handleRemoveTrack}
             onShuffle={() => {}}
             onClear={() => setTracks([])}
          />
          
          <Equalizer 
             isOpen={showEq} 
             onClose={() => setShowEq(false)}
             bands={eqBands}
             onBandChange={(i, val) => {
                 setEqBands(prev => {
                     const next = [...prev];
                     next[i] = { ...next[i], gain: val };
                     return next;
                 });
             }}
             onReset={() => setEqBands(DEFAULT_EQ_BANDS.map(b => ({ ...b })))}
             currentPresetId={currentPresetId}
             onPresetChange={(id) => {
                 setCurrentPresetId(id);
                 const p = EQ_PRESETS.find(x => x.id === id);
                 if (p) setEqBands(p.bands.map(b => ({ ...b })));
             }}
          />
      </div>

      <div className={`transition-transform duration-500 ease-in-out z-50 ${mouseIdle ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
        <Controls 
            state={audioState}
            currentTrack={currentTrack}
            onPlayPause={handlePlayPause}
            onNext={handleNext}
            onPrev={handlePrev}
            onSeek={(t) => invoke('seek_audio', { position: t })}
            onVolumeChange={(v) => setAudioState(s => ({ ...s, volume: v, isMuted: v === 0 }))}
            onToggleMute={() => setAudioState(s => ({ ...s, isMuted: !s.isMuted }))}
            playbackMode={playbackMode}
            onToggleMode={() => {}}
            onToggleLike={() => {}}
            onSpeedChange={(r) => setAudioState(s => ({ ...s, playbackRate: r }))}
            showQueue={showQueue}
            onToggleQueue={() => setShowQueue(!showQueue)}
        />
      </div>

      {isDragging && (
          <div className="absolute inset-0 z-[100] bg-neutral-900/80 backdrop-blur-xl flex flex-col items-center justify-center border-4 border-primary-500/50 m-4 rounded-[3rem] animate-pulse">
              <Sparkles size={64} className="text-primary-500 mb-4" />
              <div className="text-5xl font-black text-white uppercase tracking-[0.2em] drop-shadow-2xl">
                  Import Audio
              </div>
          </div>
      )}
    </div>
  );
};

export default App;