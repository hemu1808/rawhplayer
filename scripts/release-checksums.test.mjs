import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('release checksums cover actual installer bytes and exclude build intermediates', () => {
  const root = mkdtempSync(join(tmpdir(), 'rawh-checksums-'));
  try {
    const bundle = join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis');
    mkdirSync(bundle, { recursive: true });
    mkdirSync(join(root, 'release-artifacts'));
    writeFileSync(join(bundle, 'player.exe'), 'installer fixture');
    writeFileSync(join(bundle, 'build.log'), 'private build paths');
    execFileSync(process.execPath, [fileURLToPath(new URL('./release-checksums.mjs', import.meta.url))], {
      cwd: root,
      env: { ...process.env, RELEASE_TARGET: 'x86_64-pc-windows-msvc' },
    });
    const expected = createHash('sha256').update('installer fixture').digest('hex');
    assert.equal(
      readFileSync(join(root, 'release-artifacts/SHA256SUMS-x86_64-pc-windows-msvc.txt'), 'utf8'),
      `${expected}  player.exe\n`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
