import React, { useState, useRef, useEffect } from 'react';
import { Controls } from './components/Controls';
import { Visualizer } from './components/Visualizer';
import { Navigation } from './components/Navigation';
import { TitleBar } from './components/TitleBar';
import { Equalizer } from './components/Equalizer';
import { Toast } from './components/Toast';
// import { VideoPlayer } from './components/VideoPlayer'; // Future YouTube video playback
import { Sparkles, Sliders, Waves, AudioWaveform, Zap } from 'lucide-react';
import { getTrackInsight } from './services/geminiService';

import { PlayerProvider, usePlayer } from './context/PlayerContext';
import { LibraryProvider, useLibrary } from './context/LibraryContext';
import { useTheme } from './hooks/useTheme';
import { useEqualizer } from './hooks/useEqualizer';
import { useDragDrop } from './hooks/useDragDrop';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDynamicTheme } from './hooks/useDynamicTheme';
import { invoke } from '@tauri-apps/api/core';
import { PlaybackQueue } from './components/PlaybackQueue';
import { LibraryPlaylists } from './components/LibraryPlaylists';
import type { Track } from './types';
import { SignalPath } from './components/SignalPath';
import { WaveformSeek } from './components/WaveformSeek';
import { APP_NAME } from './config';
import { MiniPlayer } from './components/MiniPlayer';
import { LyricsPanel } from './components/LyricsPanel';
import { CommandPalette } from './components/CommandPalette';
import { listen } from '@tauri-apps/api/event';

const FilesPage = React.lazy(() => import('./pages/FilesPage').then((m) => ({ default: m.FilesPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ConnectPage = React.lazy(() => import('./pages/ConnectPage').then((m) => ({ default: m.ConnectPage })));
const SearchPage = React.lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const AudiophilePage = React.lazy(() => import('./pages/AudiophilePage').then((m) => ({ default: m.AudiophilePage })));
const RadioPage = React.lazy(() => import('./pages/RadioPage').then((m) => ({ default: m.RadioPage })));

type PageType = 'player' | 'files' | 'settings' | 'connect' | 'search' | 'audiophile' | 'playlist' | 'radio';

const AppContent: React.FC = () => {
  const [activePage, setActivePage] = useState<PageType>('player');
  const [showEq, setShowEq] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [miniPlayer, setMiniPlayer] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [mouseIdle, setMouseIdle] = useState(false);
  const [aiInsight, setAiInsight] = useState<string>('');
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);
  const aiCache = useRef<Record<string, string>>({});
  const mouseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    state: audioState,
    dispatch: playerDispatch,
    seek,
    togglePlayPause,
    error: playerError,
    clearError: clearPlayerError,
    nativeInfo,
  } = usePlayer();
  const {
    state: libState,
    processFiles,
    handleNext,
    handlePrev,
    playTrack,
    currentTrack,
    cyclePlaybackMode,
    toggleLike,
    dispatch: libDispatch,
    playById,
    addTracks,
    error: libraryError,
    clearError: clearLibraryError,
  } = useLibrary();

  const { currentThemeId, setCurrentThemeId } = useTheme();
  const { eqBands, currentPresetId, updateBand, resetBands, setPreset } = useEqualizer(audioState.isPuristMode, nativeInfo?.device_name);

  const { isDragging } = useDragDrop(processFiles);
  useKeyboardShortcuts(audioState, togglePlayPause);
  useDynamicTheme(currentTrack || null, currentThemeId === 'dynamic');
  const setCompact = async (compact: boolean) => {
    try {
      if (window.__TAURI_INTERNALS__) await invoke('set_compact_mode', { compact });
      setMiniPlayer(compact);
    } catch (error) {
      setToastMsg(String(error));
    }
  };
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let active = true;
    let stop: (() => void) | undefined;
    void listen<boolean>('compact_mode_changed', (event) => {
      if (active) setMiniPlayer(event.payload);
    })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch((error) => setToastMsg(String(error)));
    return () => {
      active = false;
      stop?.();
    };
  }, []);

  useEffect(() => {
    const showControls = () => {
      setMouseIdle(false);
      if (mouseTimer.current) clearTimeout(mouseTimer.current);
      mouseTimer.current = setTimeout(() => {
        const hasFocus = document.activeElement && document.querySelector('[role="contentinfo"]')?.contains(document.activeElement);
        if (audioState.isPlaying && !showQueue && !showEq && !isDragging && !hasFocus) {
          setMouseIdle(true);
        }
      }, 4000);
    };
    window.addEventListener('mousemove', showControls);
    window.addEventListener('focusin', showControls);
    return () => {
      window.removeEventListener('mousemove', showControls);
      window.removeEventListener('focusin', showControls);
      if (mouseTimer.current) clearTimeout(mouseTimer.current);
    };
  }, [audioState.isPlaying, showQueue, showEq, isDragging]);

  const generateInsight = async () => {
    if (!currentTrack) return;
    if (aiCache.current[currentTrack.id]) {
      setAiInsight(aiCache.current[currentTrack.id]);
      return;
    }
    setIsLoadingInsight(true);
    const text = await getTrackInsight(currentTrack.artist, currentTrack.name);
    aiCache.current[currentTrack.id] = text;
    setAiInsight(text);
    setIsLoadingInsight(false);
  };

  const renderContent = () => {
    switch (activePage) {
      case 'files':
        return (
          <FilesPage
            onImport={async (folder) => {
              try {
                const tracks = await invoke<Track[]>('pick_music', { folder });
                addTracks(tracks);
              } catch (error) {
                setToastMsg(String(error));
              }
            }}
            tracks={libState.tracks}
            onPlay={(t) => {
              playTrack(libState.tracks.findIndex((x) => x.id === t.id));
              setActivePage('player');
            }}
            onUpload={(e) => {
              if (e.target.files) processFiles(e.target.files);
            }}
            onPlayNext={(id) => libDispatch({ type: 'PLAY_NEXT', payload: id })}
            onAddToQueue={(id) => libDispatch({ type: 'ADD_TO_QUEUE', payload: id })}
            onRemove={(id) => libDispatch({ type: 'REMOVE_TRACK', payload: id })}
          />
        );
      case 'search':
        return (
          <SearchPage
            tracks={libState.tracks}
            onPlay={(t) => {
              playById(t.id);
              setActivePage('player');
            }}
          />
        );
      case 'audiophile':
        return (
          <div className="h-full overflow-auto">
            <SignalPath />
            <AudiophilePage sampleRate={audioState.sampleRate} />
          </div>
        );
      case 'playlist':
        return <LibraryPlaylists />;
      case 'radio':
        return (
          <RadioPage
            onPlayUrl={async (track) => {
              libDispatch({ type: 'ADD_TRACKS', payload: [track] });
              // wait a tick
              setTimeout(() => {
                playTrack(libState.tracks.length);

                setActivePage('player');
              }, 50);
            }}
          />
        );
      case 'connect':
        return (
          <ConnectPage
            onPlayUrl={async (url) => {
              const fakeFile = new File([], url.split('/').pop() || 'stream');
              Object.defineProperty(fakeFile, 'path', { value: url });
              await processFiles([fakeFile]);
            }}
          />
        );
      case 'settings':
        return (
          <SettingsPage
            currentThemeId={currentThemeId}
            onThemeChange={(t) => setCurrentThemeId(t.id)}
            isPuristMode={audioState.isPuristMode}
            onTogglePurist={() => playerDispatch({ type: 'SET_PURIST_MODE', payload: !audioState.isPuristMode })}
            processingPrecision={audioState.processingPrecision}
            onTogglePrecision={() =>
              playerDispatch({ type: 'SET_PRECISION', payload: audioState.processingPrecision === '16-bit' ? '32-bit float' : '16-bit' })
            }
            bufferSize={audioState.bufferSize}
            onBufferSizeChange={(s) => playerDispatch({ type: 'SET_BUFFER_SIZE', payload: s })}
          />
        );
      case 'player':
      default:
        return (
          <div className="h-full flex flex-col items-center justify-center p-6 relative overflow-hidden">
            {currentTrack && (
              <div className="absolute inset-0 z-0 select-none pointer-events-none">
                <div className="absolute inset-0 bg-black/50 z-10" />
                <img
                  src={currentTrack.image}
                  alt=""
                  role="presentation"
                  className="w-full h-full object-cover blur-[120px] opacity-40 scale-125"
                />
              </div>
            )}
            <div className="z-10 w-full max-w-7xl h-full flex flex-col md:flex-row gap-8 items-center justify-center">
              <div className="flex-1 w-full max-h-[75vh] aspect-square max-w-[800px] relative group">
                <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent rounded-[2rem] border border-white/10 shadow-2xl backdrop-blur-sm overflow-hidden">
                  {currentTrack?.image && (
                    <div className="absolute inset-0 z-0 opacity-20 group-hover:opacity-10 transition-opacity duration-1000">
                      <img src={currentTrack.image} alt="" role="presentation" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <Visualizer isPlaying={audioState.isPlaying} />
                  {currentTrack && (
                    <div className="absolute bottom-24 left-8 right-8 z-20">
                      <WaveformSeek trackId={currentTrack.id} time={audioState.currentTime} duration={audioState.duration} onSeek={seek} />
                    </div>
                  )}
                  {!audioState.isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="p-8 rounded-full bg-white/5 backdrop-blur-md border border-white/10 shadow-lg">
                        <Sparkles className="text-white/40" size={64} strokeWidth={1} />
                      </div>
                    </div>
                  )}
                  <div className="absolute top-8 left-8 right-8 flex justify-between items-start pointer-events-none">
                    <div className="space-y-2">
                      {audioState.isPuristMode && (
                        <div className="px-2 py-1 bg-primary-500 text-black text-[9px] font-extrabold tracking-widest uppercase rounded inline-flex items-center gap-1 shadow-glow">
                          <Zap size={10} fill="currentColor" /> EQ BYPASSED
                        </div>
                      )}
                      <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white tracking-tighter drop-shadow-2xl line-clamp-2">
                        {currentTrack?.name || APP_NAME}
                      </h1>
                      <h2 className="text-xl md:text-2xl text-white/70 font-medium tracking-wide">
                        {currentTrack?.artist || 'High Fidelity Engine'}
                      </h2>
                    </div>
                  </div>
                  <div className="absolute bottom-8 left-8 flex items-center gap-3 select-none pointer-events-none">
                    <div className="px-4 py-2 rounded-full bg-black/40 border border-white/10 backdrop-blur-md text-[10px] font-mono text-neutral-300 flex items-center gap-2">
                      <AudioWaveform size={12} className="text-primary-500" />
                      {currentTrack?.format || 'PCM'} • {currentTrack?.bitrate ? `${currentTrack.bitrate}kbps` : 'Bitrate unknown'} •{' '}
                      {audioState.sampleRate / 1000}kHz
                    </div>
                    <div className="px-4 py-2 rounded-full bg-black/40 border border-white/10 backdrop-blur-md text-[10px] font-mono text-primary-500 font-bold uppercase">
                      {audioState.processingPrecision}
                    </div>
                  </div>
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
              <div className="hidden xl:flex flex-col gap-4 justify-center absolute right-8 top-1/2 -translate-y-1/2">
                <button
                  onClick={() => {
                    setShowEq(true);
                    playerDispatch({ type: 'SET_PURIST_MODE', payload: false });
                  }}
                  className={`w-14 h-14 rounded-2xl border flex items-center justify-center transition-all duration-300 shadow-xl ${!audioState.isPuristMode ? 'bg-primary-500 border-primary-400 text-black scale-110' : 'bg-black/40 border-white/10 backdrop-blur text-neutral-400 hover:text-white hover:bg-white/10'}`}
                >
                  <Sliders size={24} strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => setShowLyrics(!showLyrics)}
                  className={`w-14 h-14 rounded-2xl border flex items-center justify-center transition-all duration-300 shadow-xl ${showLyrics ? 'bg-primary-500 border-primary-400 text-black scale-110' : 'bg-black/40 border-white/10 backdrop-blur text-neutral-400 hover:text-white hover:bg-white/10'}`}
                >
                  <Waves size={24} strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => void setCompact(true)}
                  className="w-14 h-14 rounded-2xl border flex items-center justify-center transition-all bg-black/40 border-white/10 backdrop-blur text-neutral-400 hover:text-white hover:bg-white/10"
                >
                  <Sparkles size={24} strokeWidth={1.5} />
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
      {(playerError || libraryError) && (
        <div role="alert" className="bg-red-950 text-white px-5 py-3 flex justify-between gap-4">
          <span>{playerError || libraryError}</span>
          <button
            onClick={() => {
              clearPlayerError();
              clearLibraryError();
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <Toast message={toastMsg} isVisible={!!toastMsg} onClose={() => setToastMsg('')} />
      {!miniPlayer && (
        <CommandPalette
          commands={[
            { id: 'play', label: 'Play or pause', run: togglePlayPause },
            { id: 'next', label: 'Next track', run: handleNext },
            { id: 'library', label: 'Open library', run: () => setActivePage('files') },
            { id: 'playlists', label: 'Open playlists', run: () => setActivePage('playlist') },
            { id: 'settings', label: 'Open settings', run: () => setActivePage('settings') },
            { id: 'queue', label: 'Show queue', run: () => setShowQueue(true) },
            { id: 'compact', label: 'Open compact player', run: () => void setCompact(true) },
          ]}
        />
      )}
      <div className={miniPlayer ? 'hidden' : 'flex flex-1 overflow-hidden relative'}>
        <Navigation activePage={activePage} onNavigate={setActivePage} />
        <main className="flex-1 relative z-10 flex flex-col min-w-0">
          <React.Suspense
            fallback={
              <div className="h-full flex flex-col items-center justify-center bg-[#050505]">
                <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mb-4 shadow-glow" />
              </div>
            }
          >
            {renderContent()}
          </React.Suspense>
        </main>

        {showQueue && <PlaybackQueue onClose={() => setShowQueue(false)} />}
        <Equalizer
          isOpen={showEq}
          onClose={() => setShowEq(false)}
          bands={eqBands}
          onBandChange={updateBand}
          onReset={resetBands}
          currentPresetId={currentPresetId}
          onPresetChange={setPreset}
        />
        <LyricsPanel
          currentTime={audioState.currentTime}
          isOpen={showLyrics}
          onClose={() => setShowLyrics(false)}
          track={currentTrack || null}
        />
      </div>

      {!miniPlayer && (
        <div
          className={`transition-transform duration-500 ease-in-out z-50 ${mouseIdle ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}
        >
          <Controls
            state={audioState}
            currentTrack={currentTrack}
            onPlayPause={togglePlayPause}
            onNext={handleNext}
            onPrev={() => handlePrev(audioState.currentTime)}
            onSeek={seek}
            onVolumeChange={(v) => playerDispatch({ type: 'SET_VOLUME', payload: v })}
            onToggleMute={() => playerDispatch({ type: 'TOGGLE_MUTE' })}
            playbackMode={libState.playbackMode}
            onToggleMode={cyclePlaybackMode}
            onToggleLike={() => currentTrack && toggleLike(currentTrack.id)}
            onSpeedChange={(r) => playerDispatch({ type: 'SET_PLAYBACK_RATE', payload: r })}
            showQueue={showQueue}
            onToggleQueue={() => setShowQueue(!showQueue)}
          />
        </div>
      )}
      {miniPlayer && (
        <MiniPlayer
          track={currentTrack || null}
          audioState={audioState}
          onPlayPause={togglePlayPause}
          onNext={handleNext}
          onMaximize={() => void setCompact(false)}
        />
      )}

      {isDragging && (
        <div className="absolute inset-0 z-[100] bg-neutral-900/80 backdrop-blur-xl flex flex-col items-center justify-center border-4 border-primary-500/50 m-4 rounded-[3rem] animate-pulse">
          <Sparkles size={64} className="text-primary-500 mb-4" />
          <div className="text-5xl font-black text-white uppercase tracking-[0.2em] drop-shadow-2xl">Import Audio</div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <PlayerProvider>
      <LibraryProvider>
        <AppContent />
      </LibraryProvider>
    </PlayerProvider>
  );
}
