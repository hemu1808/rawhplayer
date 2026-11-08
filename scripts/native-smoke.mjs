/* global window, fetch */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { nativeEnvironment } from './native-env.mjs';

if (process.platform !== 'win32') throw new Error('This desktop smoke runner currently requires Windows WebView2.');
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = Date.now().toString();
const artifacts = join(root, 'test-results', `native-smoke-${runId}`);
mkdirSync(artifacts, { recursive: true });
const identifier = `com.rawhplayer.smoke${runId}`;
const port = 19227;
const endpoint = `http://127.0.0.1:${port}`;
try {
  await fetch(`${endpoint}/json/version`);
  throw new Error(`Port ${port} is already in use.`);
} catch (error) {
  if (error.message?.includes('already in use')) throw error;
}
const config = join(artifacts, 'tauri.smoke.json');
writeFileSync(
  config,
  JSON.stringify(
    {
      identifier,
      app: {
        windows: [
          {
            label: 'main',
            title: 'RawhPlayer Native Smoke',
            width: 1200,
            height: 800,
            minWidth: 800,
            minHeight: 600,
            visible: false,
            decorations: false,
            additionalBrowserArgs: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
          },
        ],
      },
    },
    null,
    2,
  ),
);
const env = nativeEnvironment();
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
assert.ok(existsSync(npmCli), 'Run this check through npm run test:native:desktop.');
const build = spawn(
  process.execPath,
  [npmCli, 'run', 'tauri', 'build', '--', '--debug', '--no-bundle', '--config', config],
  {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  },
);
const buildStatus = await new Promise((resolve, reject) => {
  build.once('exit', resolve);
  build.once('error', reject);
});
assert.equal(buildStatus, 0, 'isolated native smoke build');

// A short PCM file containing only digital silence; no user music or credentials.
const fixture = join(artifacts, 'Native Smoke Silence.wav');
const pcm = Buffer.alloc(44 + 44100 * 2 * 2 * 30);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(pcm.length - 8, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(44100, 24);
pcm.writeUInt32LE(176400, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(pcm.length - 44, 40);
writeFileSync(fixture, pcm);
const executable = join(root, 'src-tauri', 'target', 'debug', 'rawhplayer.exe');
let child, browser;
const errors = [];
const nativeLogs = [];
async function waitFor(check, description, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (child?.exitCode !== null) throw new Error(`Native app exited before ${description}: ${child?.exitCode}`);
    try {
      const value = await check();
      if (value) return value;
    } catch {
      /* Wait for native startup. */
    }
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
async function start(args) {
  child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (data) => nativeLogs.push(data.toString()));
  child.stderr.on('data', (data) => nativeLogs.push(data.toString()));
  child.once('error', (error) => errors.push(error.message));
  await waitFor(async () => (await fetch(`${endpoint}/json/version`)).ok, 'WebView2 debugging endpoint');
  browser = await chromium.connectOverCDP(endpoint);
  const page = await waitFor(
    () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().includes('tauri.localhost')),
    'native webview',
  );
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Go to Library page' }).waitFor();
  const title = await invoke(page, 'plugin:window|title', { label: 'main' });
  assert.equal(title, 'RawhPlayer Native Smoke', 'refuse to operate on an ordinary player window');
  return page;
}
function invoke(page, command, args) {
  return page.evaluate(([name, payload]) => window.__TAURI_INTERNALS__.invoke(name, payload), [command, args]);
}
async function close(page) {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const status = await Promise.race([
    exited,
    delay(10000).then(() => {
      throw new Error('Native close did not finish.');
    }),
  ]);
  assert.equal(status, 0, 'clean native window close');
  await browser.close().catch(() => {});
  browser = null;
}
try {
  let page = await start([fixture]);
  await waitFor(async () => (await invoke(page, 'library_load')).tracks.length === 1, 'native launch-file import');
  await waitFor(async () => {
    const info = await invoke(page, 'get_audio_info');
    return info.queue_id && info.is_playing;
  }, 'native playback');
  await invoke(page, 'set_paused', { paused: true });
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle favorite', exact: true }).click();
  await page.getByRole('button', { name: 'Go to Playlist page' }).click();
  await page.getByLabel('Playlist name').fill('Native durable playlist');
  await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
  const saved = await waitFor(async () => {
    const snapshot = await invoke(page, 'library_load');
    return snapshot.tracks[0]?.isLiked && snapshot.playlists[0]?.name === 'Native durable playlist' && snapshot;
  }, 'paused native edits saved');
  assert.equal(saved.tracks[0].name, 'Native Smoke Silence');
  const header = await invoke(page, 'library_bootstrap');
  assert.deepEqual(header.state.tracks, []);
  assert.equal(header.trackCount, 1);
  await page.getByRole('button', { name: 'Go to Library page' }).click();
  await page.getByLabel('Search library').fill('Native Smoke');
  await page.getByRole('button', { name: 'Play Native Smoke Silence by Unknown Artist' }).waitFor();
  await page.getByRole('button', { name: 'Go to Setup page' }).click();
  await page.getByRole('button', { name: 'Analyze current track', exact: true }).click();
  await waitFor(async () => {
    const status = await invoke(page, 'analysis_status');
    return !status.running && status.processed === 1 && status.failed === 0;
  }, 'local analysis completes');
  const analyzed = await invoke(page, 'library_tracks', { ids: [saved.tracks[0].id] });
  assert.equal(analyzed[0].analysis.complete, true);
  assert.equal(analyzed[0].analysis.energy, 0);
  assert.equal(analyzed[0].analysis.bpm, null);
  for (const [event, playing] of [
    ['media_play', true],
    ['media_pause', false],
  ]) {
    await invoke(page, 'plugin:event|emit', { event, payload: null });
    await waitFor(async () => (await invoke(page, 'get_audio_info')).is_playing === playing, `${event} transport`);
  }
  await invoke(page, 'plugin:event|emit', { event: 'media_position', payload: 5 });
  await waitFor(async () => (await invoke(page, 'get_audio_info')).current_time >= 5, 'remote seek');
  await close(page);
  page = await start([]);
  const restored = await waitFor(async () => {
    const snapshot = await invoke(page, 'library_load');
    return snapshot.tracks[0]?.isLiked && snapshot.playlists[0]?.name === 'Native durable playlist' && snapshot;
  }, 'native state restored after restart');
  assert.equal(restored.tracks.length, 1);
  assert.equal((await invoke(page, 'get_audio_info')).is_playing, false);
  await close(page);
  assert.deepEqual(errors, []);
  const result = {
    date: new Date().toISOString(),
    identifier,
    checks: [
      'native file import/playback',
      'paused favorite and playlist persistence',
      'paged catalog UI search',
      'local analysis and cache retrieval',
      'OS media-event play/pause/seek bridge',
      'flush before close',
      'restart restores edits without auto-playing',
    ],
    errors,
  };
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ nativeDesktopSmoke: 'passed', artifacts, checks: result.checks }));
} finally {
  if (child && child.exitCode === null) child.kill();
  await browser?.close().catch(() => {});
  writeFileSync(join(artifacts, 'native.log'), nativeLogs.join(''));
}
