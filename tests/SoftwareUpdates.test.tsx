import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { SoftwareUpdates } from '../components/SoftwareUpdates';

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
const candidate = () => ({
  version: '3.1.0',
  download: vi.fn().mockResolvedValue(undefined),
  install: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
});

describe('software updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.mocked(invoke).mockResolvedValue({ enabled: true, managed: false });
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('only checks on demand and never installs just because an update is available', async () => {
    const update = candidate();
    vi.mocked(check).mockResolvedValue(update as unknown as Awaited<ReturnType<typeof check>>);
    render(<SoftwareUpdates />);
    const button = screen.getByRole('button', { name: 'Check for updates' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(check).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByRole('button', { name: 'Install 3.1.0' });
    expect(update.download).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
  });

  it('does not install an update when download or signature verification fails', async () => {
    const update = candidate();
    update.download.mockRejectedValue(new Error('Signature verification failed'));
    vi.mocked(check).mockResolvedValue(update as unknown as Awaited<ReturnType<typeof check>>);
    render(<SoftwareUpdates />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install 3.1.0' }));
    await screen.findByText(/Update failed: Signature verification failed/);
    expect(update.install).not.toHaveBeenCalled();
  });

  it('disables checking for administrator-managed installations', async () => {
    vi.mocked(invoke).mockResolvedValue({ enabled: false, managed: true });
    render(<SoftwareUpdates />);
    await screen.findByText('Updates are managed by your administrator.');
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    expect(check).not.toHaveBeenCalled();
  });
});
