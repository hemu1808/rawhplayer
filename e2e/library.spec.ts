import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('rawh_library_v1')) return;
    localStorage.setItem(
      'rawh_library_v1',
      JSON.stringify({
        schemaVersion: 1,
        tracks: [
          { id: 'one', name: 'Fixture One', artist: 'Test Artist', path: 'C:/Music/one.wav' },
          { id: 'two', name: 'Fixture Two', artist: 'Test Artist', path: 'C:/Music/two.wav' },
        ],
        queue: [
          { id: 'q1', trackId: 'one' },
          { id: 'q2', trackId: 'two' },
        ],
        playlists: [],
        watchedFolders: [],
        session: { currentQueueId: 'q1', position: 12, playbackMode: 'SEQUENCE' },
      }),
    );
  });
});

test('opens the equalizer at minimum desktop size and keeps multiple visualizers selected', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/');
  await expect(page).toHaveTitle('RawhPlayer');
  const wordmark = page.locator('.rawh-wordmark');
  await expect(wordmark).toHaveText('RAWHPLAYER');
  const centerOffset = await wordmark.evaluate((element) => {
    const { x, width } = element.getBoundingClientRect();
    return Math.abs(x + width / 2 - window.innerWidth / 2);
  });
  expect(centerOffset).toBeLessThan(1);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const open = nav.getByRole('button', { name: 'Equalizer', exact: true });
  await open.click();
  const equalizer = page.getByRole('dialog', { name: 'Equalizer' });
  await expect(equalizer).toBeVisible();
  await expect(equalizer.getByRole('slider')).toHaveCount(10);
  const bass = equalizer.getByRole('slider', { name: '64 Hz', exact: true });
  await bass.press('ArrowUp');
  await expect(bass).toHaveAttribute('aria-valuetext', '0.5 dB');
  await expect(equalizer.getByRole('switch', { name: 'Enable equalizer' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(equalizer).toHaveCount(0);
  await expect(open).toBeFocused();

  const options = page.getByRole('group', { name: 'Choose visualizers' });
  await options.getByRole('button', { name: 'Waveform' }).click();
  await options.getByRole('button', { name: 'Spectrogram' }).click();
  await expect(page.locator('.visualizer figure')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.visualizer figure')).toHaveCount(3);
  await options.getByRole('button', { name: 'Spectrum' }).click();
  await expect(page.locator('.visualizer figure')).toHaveCount(2);
});

test('configures and restores parametric settings independently of the graphic EQ', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open equalizer', exact: true }).click();
  const eq = page.getByRole('dialog', { name: 'Equalizer' });
  await eq.getByRole('button', { name: 'Parametric', exact: true }).click();
  await eq.getByRole('combobox', { name: 'Filter 1 type', exact: true }).selectOption('notch');
  await expect(eq.getByRole('spinbutton', { name: 'Filter 1 gain', exact: true })).toBeDisabled();
  const frequency = eq.getByRole('spinbutton', { name: 'Filter 1 frequency', exact: true });
  await frequency.fill('440');
  await frequency.press('Enter');
  await eq.getByRole('button', { name: 'Add filter', exact: true }).click();
  await expect(eq.getByRole('combobox', { name: 'Filter 6 type', exact: true })).toBeVisible();
  await eq.getByRole('button', { name: 'Remove filter 6', exact: true }).click();
  await eq.getByRole('switch', { name: 'Enable filter 1', exact: true }).click();
  await expect(eq.getByRole('switch', { name: 'Enable filter 1', exact: true })).not.toBeChecked();
  await eq.getByRole('button', { name: 'Graphic', exact: true }).click();
  await expect(eq.getByRole('slider')).toHaveCount(10);
  await eq.getByRole('button', { name: 'Parametric', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open equalizer', exact: true }).click();
  await expect(eq.getByRole('button', { name: 'Parametric', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(frequency).toHaveValue('440');
  await expect(eq.getByRole('combobox', { name: 'Filter 1 type', exact: true })).toHaveValue('notch');
  await expect(eq.getByRole('switch', { name: 'Enable filter 1', exact: true })).not.toBeChecked();
});

test('queue removal preserves library and saved playlist across reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Go to Playlist page' }).click();
  await page.getByLabel('Playlist name').fill('Launch playlist');
  await page.getByRole('button', { name: 'Create playlist' }).click();
  await expect(page.getByRole('heading', { name: 'Launch playlist' })).toBeVisible();
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Fixture Two from queue' }).click();
  await expect(page.getByRole('list', { name: 'Queued tracks' }).getByText('Fixture Two')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('rawh_library_v1') || '{}').queue?.length))
    .toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Go to Playlist page' }).click();
  await expect(page.getByRole('heading', { name: 'Launch playlist' })).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('rawh_library_v1') || '{}'));
  expect(state.tracks).toHaveLength(2);
  expect(state.playlists[0].trackIds).toEqual(['one', 'two']);
  expect(errors).toEqual([]);
});

test('keyboard playlist entry does not trigger playback and settings mount', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Go to Playlist page' }).click();
  await page.getByLabel('Playlist name').fill('Space key test');
  await page.getByLabel('Playlist name').press('Space');
  await expect(page.getByLabel('Playlist name')).toHaveValue('Space key test ');
  await page.getByRole('button', { name: 'Go to Setup page' }).click();
  await expect(page.getByText('Updates are unavailable in this build.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  await page.getByRole('button', { name: 'Delete key', exact: true }).click({ trial: true });
});

test('queue suggestions explain their choices and only enqueue after selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Fixture Two from queue' }).click();
  const suggestions = page.getByRole('region', { name: 'Suggested tracks' });
  await expect(suggestions.getByText('Not played yet', { exact: false })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Queued tracks' }).getByText('Fixture Two')).toHaveCount(0);
  await suggestions.getByRole('button', { name: 'Add Fixture Two to queue' }).click();
  await expect(page.getByRole('list', { name: 'Queued tracks' }).getByText('Fixture Two')).toBeVisible();
  await expect(suggestions).toHaveCount(0);
});

test('metadata editor opens as a keyboard-dismissable dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Go to Library page' }).click();
  await page.getByRole('button', { name: 'Track actions', exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit metadata', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit track metadata' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Fixture One');
  await expect(editor.getByRole('button', { name: 'Save tags' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

test('command palette opens playlists and smart rules can be edited and restored', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Commands', exact: true });
  await expect(palette).toBeVisible();
  await palette.getByLabel('Find a command').fill('playlists');
  await palette.getByLabel('Find a command').press('Enter');
  await expect(palette).not.toBeVisible();
  await page.getByLabel('Playlist name').fill('Artist collection');
  await page.getByLabel('Playlist contents').selectOption('custom');
  await page.getByLabel('Artist', { exact: true }).fill('Test Artist');
  await page.getByRole('button', { name: 'Create playlist' }).click();
  await page.getByRole('button', { name: 'Edit Artist collection' }).click();
  await page.getByLabel('Artist', { exact: true }).fill('Another Artist');
  await page.getByRole('button', { name: 'Save playlist' }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('rawh_library_v1') || '{}').playlists?.[0]?.smartRule?.artist,
      ),
    )
    .toBe('Another Artist');
  await page.reload();
  await page.getByRole('button', { name: 'Go to Playlist page' }).click();
  await page.getByRole('button', { name: 'Edit Artist collection' }).click();
  await expect(page.getByLabel('Artist', { exact: true })).toHaveValue('Another Artist');
});
