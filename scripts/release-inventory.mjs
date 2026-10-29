import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = process.env.RELEASE_TARGET;
if (!target || !/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error('RELEASE_TARGET must be a Rust target triple');
if (!process.env.npm_execpath) throw new Error('Run through npm run release:inventory');
const directory = resolve('release-artifacts');
mkdirSync(directory, { recursive: true });
const npmBom = execFileSync(
  process.execPath,
  [process.env.npm_execpath, 'sbom', '--sbom-format', 'cyclonedx', '--omit=dev'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);
JSON.parse(npmBom);
writeFileSync(resolve(directory, `npm-${target}.cdx.json`), npmBom);
execFileSync(
  'cargo',
  [
    'cyclonedx',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--format',
    'json',
    '--target',
    target,
    '--all',
    '--spec-version',
    '1.5',
    '--override-filename',
    'release-bom',
  ],
  { stdio: 'inherit' },
);
const rustFile = resolve('src-tauri/release-bom.json');
const rustBom = JSON.parse(readFileSync(rustFile, 'utf8'));
copyFileSync(rustFile, resolve(directory, `rust-${target}.cdx.json`));
const licenses = [JSON.parse(npmBom), rustBom]
  .flatMap((bom) =>
    (bom.components || []).map((component) => ({
      component: component.purl || `${component.name}@${component.version}`,
      licenses: component.licenses || [],
    })),
  )
  .sort((a, b) => a.component.localeCompare(b.component));
writeFileSync(
  resolve(directory, `licenses-${target}.json`),
  JSON.stringify(
    {
      note: 'Dependency declarations only. Empty or non-SPDX entries require review; this is not legal approval.',
      components: licenses,
    },
    null,
    2,
  ) + '\n',
);
