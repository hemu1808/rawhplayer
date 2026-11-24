import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeCatalogPage } from '../components/NativeCatalogPage';
const harness = vi.hoisted(() => ({ query: vi.fn(), groups: vi.fn(), play: vi.fn() }));
vi.mock('../context/LibraryContext', () => ({
  useLibrary: () => ({
    queryCatalog: harness.query,
    catalogRevision: 1,
    ready: true,
    state: { tracks: [] },
    enqueueTrack: vi.fn(),
    removeTrack: vi.fn(),
    toggleLike: vi.fn(),
  }),
}));
vi.mock('../services/generated/native', () => ({ commands: { libraryGroups: harness.groups } }));
beforeEach(() => {
  vi.clearAllMocks();
  harness.query.mockResolvedValue({ tracks: [{ id: 'outside-cache', name: 'Server result', artist: 'Artist' }], total: 100001 });
  harness.groups.mockResolvedValue([{ name: '', tracks: 23 }]);
});
afterEach(cleanup);
it('searches and sorts the server catalog, pages past cached tracks and plays by returned ID', async () => {
  render(<NativeCatalogPage onPlay={harness.play} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play Server result by Artist' }));
  expect(harness.play).toHaveBeenCalledWith(expect.objectContaining({ id: 'outside-cache' }));
  fireEvent.change(screen.getByLabelText('Search library'), { target: { value: 'Uncached song' } });
  await waitFor(() => expect(harness.query).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Uncached song', offset: 0 })));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  await waitFor(() => expect(harness.query).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100 })));
  fireEvent.change(screen.getByLabelText('Sort library'), { target: { value: 'artist' } });
  await waitFor(() => expect(harness.query).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'artist', offset: 0 })));
});
it('opens the unknown-album group with an empty-value filter', async () => {
  render(<NativeCatalogPage onPlay={harness.play} />);
  fireEvent.change(screen.getByLabelText('Browse library'), { target: { value: 'album' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Browse album Unknown (23 tracks)' }));
  await waitFor(() => expect(harness.query).toHaveBeenLastCalledWith(expect.objectContaining({ album: '' })));
  expect(screen.getByRole('button', { name: 'Clear Unknown filter' })).toBeInTheDocument();
});
