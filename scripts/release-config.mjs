import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function required(env, name) {
  const value = env[name]?.trim();
  if (!value || /placeholder|replace.me/i.test(value)) throw new Error(`Release requires ${name}`);
  return value;
}

export function releaseConfig(env, version) {
  if (required(env, 'GITHUB_REF_NAME') !== `v${version}`) throw new Error('Release tag must match the app version');
  const repository = required(env, 'GITHUB_REPOSITORY');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid release repository');
  const pubkey = required(env, 'TAURI_SIGNING_PUBLIC_KEY');
  const decoded = Buffer.from(pubkey, 'base64').toString('utf8').trim().split(/\r?\n/);
  const key = Buffer.from(decoded[1] || '', 'base64');
  if (
    !decoded[0]?.startsWith('untrusted comment:') ||
    decoded.length !== 2 ||
    key.length !== 42 ||
    key.subarray(0, 2).toString() !== 'Ed'
  ) {
    throw new Error('TAURI_SIGNING_PUBLIC_KEY must contain a Tauri-generated public key');
  }
  required(env, 'TAURI_SIGNING_PRIVATE_KEY');
  const target = required(env, 'RELEASE_TARGET');
  if (
    !['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-unknown-linux-gnu'].includes(
      target,
    )
  ) {
    throw new Error('Unsupported release target');
  }
  const bundle = { createUpdaterArtifacts: true };
  if (target.includes('windows')) {
    const thumbprint = required(env, 'WINDOWS_CERTIFICATE_THUMBPRINT');
    if (!/^[a-f\d]{40}$/i.test(thumbprint)) throw new Error('Invalid Windows signing certificate thumbprint');
    bundle.windows = {
      certificateThumbprint: thumbprint,
      digestAlgorithm: 'sha256',
      timestampUrl: 'http://timestamp.digicert.com',
    };
  }
  if (target.includes('apple')) {
    for (const name of [
      'APPLE_CERTIFICATE',
      'APPLE_CERTIFICATE_PASSWORD',
      'APPLE_ID',
      'APPLE_PASSWORD',
      'APPLE_TEAM_ID',
    ])
      required(env, name);
    const signingIdentity = required(env, 'APPLE_SIGNING_IDENTITY');
    if (!signingIdentity.startsWith('Developer ID Application:'))
      throw new Error('macOS releases require a Developer ID Application identity');
    bundle.macOS = { signingIdentity };
  }
  return {
    bundle,
    plugins: {
      updater: { pubkey, endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`] },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
    if (config.version !== pkg.version || cargo.match(/^version = "([^"]+)"/m)?.[1] !== pkg.version)
      throw new Error('Package, Cargo and Tauri versions must match');
    const overlay = releaseConfig(process.env, config.version);
    await writeFile(
      new URL('../src-tauri/tauri.release.conf.json', import.meta.url),
      `${JSON.stringify(overlay, null, 2)}\n`,
    );
    console.log('Release configuration validated. Signing secrets were not written to disk.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
