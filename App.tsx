import { lazy, Suspense, useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Controls } from './components/Controls';
import { Navigation, type PlayerPage } from './components/Navigation';
import { TitleBar } from './components/TitleBar';
import { Equalizer } from './components/Equalizer';
import { Toast } from './components/Toast';
import { PlayerProvider, usePlayer } from './context/PlayerContext';
import { LibraryProvider, useLibrary } from './context/LibraryContext';
import { useTheme } from './hooks/useTheme';
import { useEqualizer } from './hooks/useEqualizer';
import { useDragDrop } from './hooks/useDragDrop';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDynamicTheme } from './hooks/useDynamicTheme';
import { PlaybackQueue } from './components/PlaybackQueue';
import { LibraryPlaylists } from './components/LibraryPlaylists';
import { MiniPlayer } from './components/MiniPlayer';
import { LyricsPanel } from './components/LyricsPanel';
import { CommandPalette } from './components/CommandPalette';
import { NowPlaying } from './pages/NowPlaying';
import type { Track } from './types';

const FilesPage = lazy(() => import('./pages/FilesPage').then((m) => ({ default: m.FilesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const AudiophilePage = lazy(() => import('./pages/AudiophilePage').then((m) => ({ default: m.AudiophilePage })));

function AppContent() {
  const [activePage, setActivePage] = useState<PlayerPage>('player');
  const [showEq, setShowEq] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [compact, setCompactView] = useState(false);
  const [toast, setToast] = useState('');
  const { state: audio, dispatch, seek, togglePlayPause, error: playerError, clearError: clearPlayerError, nativeInfo } = usePlayer();
  const library = useLibrary();
  const { currentTrack, handleNext, handlePrev } = library;
  const { currentThemeId, setCurrentThemeId } = useTheme();
  const equalizer = useEqualizer(audio.isPuristMode, nativeInfo?.device_name);
  const { isDragging } = useDragDrop(library.processFiles);
  const native = Boolean(window.__TAURI_INTERNALS__);

  useKeyboardShortcuts(audio, togglePlayPause);
  useDynamicTheme(currentTrack || null, currentThemeId === 'dynamic');

  useEffect(() => {
    if (!native) return;
    let active = true;
    let stop: (() => void) | undefined;
    void listen<boolean>('compact_mode_changed', ({ payload }) => {
      if (active) setCompactView(payload);
    })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch((error) => {
        if (active) setToast(String(error));
      });
    return () => {
      active = false;
      stop?.();
    };
  }, [native]);

  async function setCompact(enabled: boolean) {
    try {
      if (native) await invoke('set_compact_mode', { compact: enabled });
      setCompactView(enabled);
      return true;
    } catch (error) {
      setToast(String(error));
      return false;
    }
  }

  function openEqualizer() {
    if (!compact) setShowEq(true);
    else
      void setCompact(false).then((restored) => {
        if (restored) setShowEq(true);
      });
  }

  function setEqEnabled(enabled: boolean) {
    dispatch({ type: 'SET_PURIST_MODE', payload: !enabled });
  }

  function openTrack(track: Track) {
    library.playById(track.id);
    setActivePage('player');
  }

  const renderPage = () => {
    switch (activePage) {
      case 'files':
        return (
          <FilesPage
            onImport={library.pickMusic}
            tracks={library.state.tracks}
            onPlay={openTrack}
            onUpload={(event) => {
              if (event.target.files) void library.processFiles(event.target.files);
            }}
            onPlayNext={(id) => library.dispatch({ type: 'PLAY_NEXT', payload: id })}
            onAddToQueue={(id) => library.dispatch({ type: 'ADD_TO_QUEUE', payload: id })}
            onRemove={(id) => library.dispatch({ type: 'REMOVE_TRACK', payload: id })}
          />
        );
      case 'search':
        return <SearchPage tracks={library.state.tracks} onPlay={openTrack} />;
      case 'audiophile':
        return <AudiophilePage onEqualizer={openEqualizer} />;
      case 'playlist':
        return <LibraryPlaylists />;
      case 'settings':
        return (
          <SettingsPage
            currentThemeId={currentThemeId}
            onThemeChange={(theme) => setCurrentThemeId(theme.id)}
            isPuristMode={audio.isPuristMode}
            onTogglePurist={() => setEqEnabled(audio.isPuristMode)}
            onEqualizer={openEqualizer}
          />
        );
      case 'player':
        return (
          <NowPlaying
            track={currentTrack}
            info={nativeInfo}
            isPlaying={audio.isPlaying}
            onImport={() => (native ? void library.pickMusic(false) : setActivePage('files'))}
            onBrowse={() => setActivePage('files')}
            onEqualizer={openEqualizer}
            onLyrics={() => setShowLyrics((open) => !open)}
            lyricsOpen={showLyrics}
            onCompact={native ? () => void setCompact(true) : undefined}
          />
        );
    }
  };

  return (
    <div className="app-shell" data-compact={compact}>
      {!compact && currentTrack?.image && <img className="app-artwork-light" src={currentTrack.image} alt="" aria-hidden="true" />}
      <TitleBar>
        {!compact && (
          <CommandPalette
            commands={[
              { id: 'play', label: 'Play or pause', run: togglePlayPause },
              { id: 'next', label: 'Next track', run: handleNext },
              { id: 'library', label: 'Open library', run: () => setActivePage('files') },
              { id: 'playlists', label: 'Open playlists', run: () => setActivePage('playlist') },
              { id: 'settings', label: 'Open settings', run: () => setActivePage('settings') },
              { id: 'equalizer', label: 'Open equalizer', run: openEqualizer },
              { id: 'queue', label: 'Show queue', run: () => setShowQueue(true) },
              { id: 'compact', label: 'Open compact player', run: () => void setCompact(true) },
            ]}
          />
        )}
      </TitleBar>
      {(playerError || library.error) && (
        <div role="alert" className="app-error">
          <span>{playerError || library.error}</span>
          <button
            className="button"
            onClick={() => {
              clearPlayerError();
              library.clearError();
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <Toast message={toast} isVisible={!!toast} onClose={() => setToast('')} />
      {compact ? (
        <MiniPlayer
          track={currentTrack || null}
          audioState={audio}
          onPlayPause={togglePlayPause}
          onNext={handleNext}
          onSeek={seek}
          onEqualizer={openEqualizer}
          onMaximize={() => void setCompact(false)}
        />
      ) : (
        <>
          <div className="app-body">
            <Navigation activePage={activePage} onNavigate={setActivePage} onEqualizer={openEqualizer} equalizerOpen={showEq} />
            <main className="app-content">
              <Suspense
                fallback={
                  <p className="app-loading" role="status">
                    Loading…
                  </p>
                }
              >
                {renderPage()}
              </Suspense>
            </main>
            {showQueue && <PlaybackQueue onClose={() => setShowQueue(false)} />}
            {showLyrics && (
              <LyricsPanel
                currentTime={audio.currentTime}
                isOpen={showLyrics}
                onClose={() => setShowLyrics(false)}
                track={currentTrack || null}
              />
            )}
          </div>
          <Controls
            state={audio}
            currentTrack={currentTrack}
            onPlayPause={togglePlayPause}
            onNext={handleNext}
            onPrev={() => handlePrev(audio.currentTime)}
            onSeek={seek}
            onVolumeChange={(volume) => dispatch({ type: 'SET_VOLUME', payload: volume })}
            onToggleMute={() => dispatch({ type: 'TOGGLE_MUTE' })}
            playbackMode={library.state.playbackMode}
            onToggleMode={library.cyclePlaybackMode}
            onToggleLike={() => currentTrack && library.toggleLike(currentTrack.id)}
            onSpeedChange={(rate) => dispatch({ type: 'SET_PLAYBACK_RATE', payload: rate })}
            showQueue={showQueue}
            onToggleQueue={() => {
              setShowLyrics(false);
              setShowQueue(!showQueue);
            }}
            showEq={showEq}
            onEqualizer={openEqualizer}
            onOpenPlayer={() => setActivePage('player')}
          />
        </>
      )}

      {showEq && (
        <Equalizer
          enabled={!audio.isPuristMode}
          settings={equalizer.settings}
          sampleRate={nativeInfo?.output_sample_rate ?? 48000}
          syncError={equalizer.syncError}
          onAdvancedChange={(patch) => {
            equalizer.updateAdvanced(patch);
            if (patch.mode === undefined) setEqEnabled(true);
          }}
          onToggle={() => setEqEnabled(audio.isPuristMode)}
          onClose={() => setShowEq(false)}
          bands={equalizer.eqBands}
          onBandChange={(index, gain) => {
            equalizer.updateBand(index, gain);
            setEqEnabled(true);
          }}
          onReset={equalizer.resetBands}
          currentPresetId={equalizer.currentPresetId}
          onPresetChange={(id) => {
            equalizer.setPreset(id);
            if (id !== 'manual') setEqEnabled(true);
          }}
        />
      )}
      {isDragging && (
        <div className="drop-target">
          <FolderOpen size={26} /> Drop audio files to import
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <LibraryProvider>
        <AppContent />
      </LibraryProvider>
    </PlayerProvider>
  );
}
