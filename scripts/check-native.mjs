import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeEnvironment } from './native-env.mjs';

const env = nativeEnvironment();
const cwd = fileURLToPath(new URL('../', import.meta.url));
function cargo(args) {
  const result = spawnSync('cargo', args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (process.argv[2] === 'generate') {
  env.RAWH_GENERATE_IPC = '1';
  cargo(['test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', 'ipc::tests::generated_contracts_are_current']);
} else if (process.argv[2] === 'benchmark') {
  cargo([
    'test',
    '--locked',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--lib',
    'library_scale_benchmark',
    '--',
    '--ignored',
    '--nocapture',
  ]);
} else if (process.argv[2] === 'hardware') {
  cargo([
    'test',
    '--locked',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--lib',
    'hardware_output_smoke',
    '--',
    '--ignored',
    '--nocapture',
  ]);
} else {
  cargo(['fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check']);
  cargo(['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--lib']);
  cargo(['clippy', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--', '-D', 'warnings']);
}
