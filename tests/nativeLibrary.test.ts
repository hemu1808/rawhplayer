import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeLibrarySession, queueDelta } from '../services/nativeLibrary';
import { emptyLibrary } from '../services/libraryStore';
import type { LibraryHeader } from '../services/generated/native';
const api = vi.hoisted(() => ({ libraryPatch: vi.fn() }));
vi.mock('../services/generated/native', () => ({ commands: api }));
beforeEach(() => {
  api.libraryPatch.mockReset();
  api.libraryPatch.mockResolvedValue({ revision: 2, catalogRevision: 1 });
});
function setup() {
  const snapshot = emptyLibrary();
  snapshot.tracks = [{ id: 'one', name: 'One', artist: 'Artist' }];
  snapshot.queue = Array.from({ length: 100_000 }, (_, index) => ({ id: `q${index}`, trackId: 'one' }));
  const session = new NativeLibrarySession();
  const base = session.adopt({
    revision: 1,
    catalogRevision: 0,
    trackCount: 100_000,
    state: snapshot,
    initialTracks: snapshot.tracks,
  } as unknown as LibraryHeader);
  return { session, base };
}
describe('incremental native saves', () => {
  it('keeps a favorite patch small with a 100,000-entry queue', async () => {
    const { session, base } = setup();
    const edited = { ...base, tracks: base.tracks.map((track) => ({ ...track, isLiked: true })) };
    session.observe(base, edited);
    await session.save(edited);
    const patch = api.libraryPatch.mock.calls[0][0];
    expect(JSON.stringify(patch).length).toBeLessThan(500);
    expect(patch.replaceQueue).toBeNull();
    expect(patch.queueOperations).toEqual([]);
    expect(patch.tracks[0].isLiked).toBe(true);
    await session.save(edited);
    expect(api.libraryPatch).toHaveBeenCalledOnce();
  });
  it('keeps failed writes and edits made during an in-flight write', async () => {
    const { session, base } = setup();
    const liked = { ...base, tracks: base.tracks.map((track) => ({ ...track, isLiked: true })) };
    session.observe(base, liked);
    api.libraryPatch.mockRejectedValueOnce({ code: 'CONFLICT', message: 'Refresh required' });
    await expect(session.save(liked)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(session.dirtyTrackIds.has('one')).toBe(true);
    let finish!: (value: { revision: number; catalogRevision: number }) => void;
    api.libraryPatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = session.save(liked);
    const unliked = { ...liked, tracks: liked.tracks.map((track) => ({ ...track, isLiked: false })) };
    session.observe(liked, unliked);
    finish({ revision: 2, catalogRevision: 2 });
    await pending;
    expect(session.dirtyTrackIds.has('one')).toBe(true);
    await session.save(unliked);
    expect(api.libraryPatch.mock.calls.at(-1)![0].tracks[0].isLiked).toBe(false);
  });
  it('uses a small operation for insert, remove and move while preserving duplicate tracks', () => {
    const a = { id: 'a', trackId: 'one' },
      b = { id: 'b', trackId: 'one' },
      c = { id: 'c', trackId: 'two' };
    expect(queueDelta([a, b], [a, c, b]).queueOperations).toEqual([{ kind: 'insert', entry: c, afterId: 'a' }]);
    expect(queueDelta([a, b], [b]).queueOperations).toEqual([{ kind: 'remove', id: 'a' }]);
    expect(queueDelta([a, b, c], [b, a, c]).queueOperations).toEqual([{ kind: 'move', id: 'b', beforeId: 'a' }]);
    expect(queueDelta([a, b], [{ ...a, trackId: 'other' }, b]).replaceQueue).not.toBeNull();
  });
});
