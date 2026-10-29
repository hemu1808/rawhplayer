import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
const target = process.env.RELEASE_TARGET;
if (!target || !/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error('RELEASE_TARGET must be a Rust target triple');
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : [],
  );
const installers = walk(resolve('src-tauri/target', target, 'release/bundle')).filter((file) =>
  /\.(exe|msi|dmg|deb|rpm|AppImage|tar\.gz)(\.sig)?$/i.test(file),
);
if (!installers.length) throw new Error('No release installers found');
const inventory = walk(resolve('release-artifacts')).filter(
  (file) => file.endsWith(`-${target}.json`) || file.endsWith(`-${target}.cdx.json`),
);
const hashes = new Map();
for (const file of [...installers, ...inventory].sort()) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const digest = hash.digest('hex');
  const name = basename(file);
  if (hashes.has(name) && hashes.get(name) !== digest) throw new Error(`Conflicting release filenames: ${name}`);
  hashes.set(name, digest);
}
writeFileSync(
  resolve('release-artifacts', `SHA256SUMS-${target}.txt`),
  [...hashes].map(([name, hash]) => `${hash}  ${name}\n`).join(''),
);
