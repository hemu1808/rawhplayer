import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryProvider, useLibrary } from '../context/LibraryContext';
import { emptyLibrary } from '../services/libraryStore';

const harness = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  closeHandler: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>),
  close: vi.fn().mockResolvedValue(undefined),
  player: {
    reportError: vi.fn(),
    setLoading: vi.fn(),
    registerResumeHandler: vi.fn(),
    refreshAudioInfo: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: harness.invoke, convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    harness.handlers.set(name, handler);
    return () => harness.handlers.delete(name);
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: harness.close,
    onCloseRequested: async (handler: typeof harness.closeHandler) => {
      harness.closeHandler = handler;
      return () => {
        harness.closeHandler = undefined;
      };
    },
  }),
}));
vi.mock('../context/PlayerContext', () => ({
  usePlayer: () => harness.player,
  errorMessage: (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => <LibraryProvider>{children}</LibraryProvider>;
const saves = () => harness.invoke.mock.calls.filter(([command]) => command === 'library_patch');
async function pausedLibrary() {
  const hook = renderHook(() => useLibrary(), { wrapper });
  await act(async () => {});
  expect(hook.result.current.ready).toBe(true);
  await act(async () => hook.result.current.playQueueEntry('q1'));
  harness.invoke.mockClear();
  return hook;
}
async function playback(position: number, playing = false) {
  act(() =>
    harness.handlers.get('playback_update')!({
      payload: { queue_id: 'q1', current_time: position, is_playing: playing },
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(100));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  window.__TAURI_INTERNALS__ = {};
  const snapshot = emptyLibrary();
  snapshot.tracks = [{ id: 'one', name: 'Track', artist: 'Artist', path: 'C:/music/one.wav' }];
  snapshot.queue = [{ id: 'q1', trackId: 'one' }];
  snapshot.session.currentQueueId = 'q1';
  let revision = 0;
  harness.invoke.mockImplementation(async (command: string) => {
    if (command === 'library_bootstrap')
      return { state: { ...snapshot, tracks: [] }, initialTracks: snapshot.tracks, revision, catalogRevision: 0, trackCount: 1 };
    if (command === 'play_library_track' || command === 'queue_library_track') return snapshot.tracks[0];
    if (command === 'library_page') return { total: 1, tracks: snapshot.tracks, revision: 0, offset: 0, limit: 100 };
    if (command === 'library_patch') return { revision: ++revision, catalogRevision: revision };
    return null;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.__TAURI_INTERNALS__;
  harness.handlers.clear();
});

describe('native library persistence', () => {
  it('persists favorites while paused updates continue without redundant writes', async () => {
    const { result } = await pausedLibrary();
    await act(async () => result.current.toggleLike('one'));
    for (let index = 0; index < 20; index++) await playback(0);
    expect(saves()).toHaveLength(1);
    expect(saves()[0][1].patch.tracks[0].isLiked).toBe(true);
  });

  it('persists playlist creation, editing and deletion while paused', async () => {
    const { result } = await pausedLibrary();
    let id = '';
    await act(async () => {
      id = result.current.createPlaylist('First', ['one']);
    });
    await playback(0);
    expect(saves().at(-1)![1].patch.upsertPlaylists[0].name).toBe('First');
    await act(async () => result.current.updatePlaylist(id, { name: 'Edited' }));
    await playback(0);
    expect(saves().at(-1)![1].patch.upsertPlaylists[0].name).toBe('Edited');
    await act(async () => result.current.deletePlaylist(id));
    await playback(0);
    expect(saves().at(-1)![1].patch.removePlaylists).toEqual([id]);
  });

  it('bounds checkpoint delay when position events never become quiet', async () => {
    await pausedLibrary();
    for (let index = 1; index <= 25; index++) await playback(index / 10);
    expect(saves().length).toBeGreaterThan(0);
  });

  it('waits for native persistence before closing', async () => {
    await pausedLibrary();
    await playback(1);
    let finishSave!: () => void;
    harness.invoke.mockImplementation((command: string) =>
      command === 'library_patch'
        ? new Promise((resolve) => {
            finishSave = () => resolve({ revision: 1, catalogRevision: 1 });
          })
        : Promise.resolve(),
    );
    const event = { preventDefault: vi.fn() };
    let pending!: Promise<void>;
    await act(async () => {
      pending = harness.closeHandler!(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(harness.close).not.toHaveBeenCalled();
    await act(async () => {
      finishSave();
      await pending;
    });
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('keeps the window open if saving fails', async () => {
    const { result } = await pausedLibrary();
    await playback(1);
    harness.invoke.mockRejectedValue(new Error('Disk is full'));
    await act(async () => harness.closeHandler!({ preventDefault: vi.fn() }));
    expect(harness.close).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Disk is full');
  });

  it('includes edits made while the close-time save is still pending', async () => {
    const { result } = await pausedLibrary();
    await playback(1);
    const finish: (() => void)[] = [];
    harness.invoke.mockImplementation((command: string) =>
      command === 'library_patch' && finish.length < 2
        ? new Promise((resolve) => finish.push(() => resolve({ revision: finish.length, catalogRevision: finish.length })))
        : Promise.resolve(),
    );
    let closing!: Promise<void>;
    await act(async () => {
      closing = harness.closeHandler!({ preventDefault: vi.fn() });
    });
    await act(async () => result.current.toggleLike('one'));
    await act(async () => finish[0]());
    expect(finish).toHaveLength(2);
    expect(harness.close).not.toHaveBeenCalled();
    await act(async () => {
      finish[1]();
      await closing;
    });
    expect(saves().at(-1)![1].patch.tracks[0].isLiked).toBe(true);
    expect(harness.close).toHaveBeenCalledOnce();
  });
});
