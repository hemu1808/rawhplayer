import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function nativeEnvironment() {
  const env = { ...process.env };
  const profile = env.USERPROFILE || env.HOME;
  const isolated = profile && join(profile, 'rawh-tools');
  if (!env.CARGO_HOME && isolated && existsSync(join(isolated, 'cargo', 'bin'))) {
    env.CARGO_HOME = join(isolated, 'cargo');
    env.RUSTUP_HOME ||= join(isolated, 'rustup');
  }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  if (env.CARGO_HOME) env[pathKey] = `${join(env.CARGO_HOME, 'bin')}${delimiter}${env[pathKey] || ''}`;
  env.CARGO_PROFILE_DEV_DEBUG ||= '0';
  env.CARGO_PROFILE_TEST_DEBUG ||= '0';
  env.CARGO_BUILD_JOBS ||= '4';
  return env;
}
