import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseConfig } from './release-config.mjs';

// Synthetic public-key structure for validation tests only; never a production key.
const key = Buffer.concat([Buffer.from('Ed'), Buffer.alloc(40, 1)]).toString('base64');
const valid = {
  GITHUB_REF_NAME: 'v3.0.0',
  GITHUB_REPOSITORY: 'example/player',
  TAURI_SIGNING_PUBLIC_KEY: Buffer.from(`untrusted comment: test key\n${key}\n`).toString('base64'),
  TAURI_SIGNING_PRIVATE_KEY: 'test-only-private-key',
  RELEASE_TARGET: 'x86_64-unknown-linux-gnu',
};
test('release blocks missing keys, malformed public keys and mismatched versions', () => {
  for (const change of [
    { TAURI_SIGNING_PRIVATE_KEY: '' },
    { TAURI_SIGNING_PUBLIC_KEY: 'placeholder' },
    { TAURI_SIGNING_PUBLIC_KEY: 'Zm9v' },
    { GITHUB_REF_NAME: 'v2.0.0' },
  ]) {
    assert.throws(() => releaseConfig({ ...valid, ...change }, '3.0.0'));
  }
});
test('release overlay enables signed artifacts and excludes signing secrets', () => {
  const config = releaseConfig(valid, '3.0.0');
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(
    config.plugins.updater.endpoints[0],
    'https://github.com/example/player/releases/latest/download/latest.json',
  );
  assert.ok(!JSON.stringify(config).includes(valid.TAURI_SIGNING_PRIVATE_KEY));
});
test('platform releases require publisher signing and notarization credentials', () => {
  assert.throws(() => releaseConfig({ ...valid, RELEASE_TARGET: 'x86_64-pc-windows-msvc' }, '3.0.0'));
  assert.throws(() => releaseConfig({ ...valid, RELEASE_TARGET: 'aarch64-apple-darwin' }, '3.0.0'));
  const config = releaseConfig(
    { ...valid, RELEASE_TARGET: 'x86_64-pc-windows-msvc', WINDOWS_CERTIFICATE_THUMBPRINT: 'a'.repeat(40) },
    '3.0.0',
  );
  assert.equal(config.bundle.windows.digestAlgorithm, 'sha256');
});
