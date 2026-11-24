# Repairs, modern features and validation

Work date: 2026-11-08. Canonical checkout: `D:/repos/rawhplayer`. Current branch: `update/Features`.

## Current feature checkpoint

The first five modernization improvements are implemented: paged catalog/patch persistence, Rubato sinc conversion, generated command/core-event contracts, OS media sessions and cancellable local analysis/discovery. See [FEATURES_2026-11-08.md](FEATURES_2026-11-08.md) for behavior and limits.

Current local checks cover TypeScript, zero-warning ESLint, 57 frontend tests, 4 release tests, 5 Chromium journeys, 45 native tests, Clippy/rustfmt, the 10k/100k benchmark and the isolated Windows desktop smoke. Native tests include three explicit ignored entries (hardware, benchmark and subprocess helper); the hardware/benchmark checks run separately. The subprocess helper is exercised by the forced-termination regression. Desktop validation includes native paged search, local analysis/cache, media-event play/pause/seek, paused edits and close/restart. The hardware smoke opened 48 kHz stereo f32 with zero underruns and digital silence. Physical lock-screen/headset controls and macOS/Linux remain unverified.

Fresh npm audit reports zero findings. Fresh Rust audit reports zero vulnerability errors and seven unsuppressed upstream maintenance/unsoundness warnings. Tests use isolated data; the ordinary app's library is not used as a fixture.

## Repaired behavior

- Favorites, playlists, queue edits and other durable changes save without waiting for playback updates to become quiet. Unchanged paused events do not create new snapshots. Position-only checkpoints have a maximum two-second scheduling delay.
- Title-bar and tray close use the same persistence path. Closing waits for a successful save; an active library operation or save failure keeps the window open. Required window capabilities are restricted to the main window. The real desktop check verifies the close/restart path.
- `shared/library-contract.json` supplies limits and supported extensions to TypeScript and generated Rust constants. Existing 100,001-track libraries load without truncation. Native import checks distinct total identities before inserting the batch, and rejects an over-capacity scan rather than exceeding the 250,000-track boundary.
- ESLint, its JavaScript rules and React-hooks support are upgraded to a compatible ESLint 10 stack, replacing unsupported ESLint 9. Targeted `minimatch` overrides for ESLint, its config array and TypeScript ESTree resolve the advisory without downgrading the toolchain. The lock resolves the patched 11.x release; a clean install is part of verification. Remove these overrides when upstream ranges include a patched release. Node 22.13 or newer is required; Node 22 is the CI baseline.
- `.gitattributes`, `.editorconfig`, `rustfmt.toml` and the existing Prettier configuration agree on LF text. The old Windows checkout's formatting mismatch is repaired.
- Native library responsibilities are separated into storage/migrations, scans, backups, media, metadata, models, validation and tests. Unchanged saves perform zero row writes; a favorite update changes one track without rebuilding its full-text index.
- Full-text rows share their track's SQLite rowid. Indexed updates replace a full-table scan on import/update. Older databases upgrade to SQLite version 3 after a consistent recovery copy; migration tests preserve favorites, grants, queue, playlists, session, identities and search behavior.
- Waveform analysis shares the playback Symphonia decoder. The redundant Rodio dependency and inactive legacy audio/placeholder modules were removed. Duplicate output-device names produce an explicit error instead of silently routing audio to the first match.
- Historical Word/feature documents are marked and preserved under `docs/history/`; current behavior is in the README and walkthrough. The November 7 review and archive manifests remain historical records.
- The browser test server launches Vite directly, avoiding the previous Windows npm-wrapper teardown hang.

## Repeatable commands

```sh
npm ci
npm run check
npm run format:check
npm run test:e2e
npm run check:native
npm run test:native:hardware
npm run test:native:desktop
npm run benchmark:library
```

`check:native` discovers this machine's retained isolated Rust tools when normal Cargo environment variables are absent. It runs locked native tests, rustfmt and Clippy. Debug symbols are disabled by default for these local checks to limit compilation-cache growth. The scripts do not change the persistent system PATH.

The hardware smoke test explicitly opens the default output and emits only digital silence. The Windows desktop runner builds a hidden app with a separate identifier and WebView2 storage; it imports its own silent fixture, changes favorites/playlists while paused, closes, restarts and checks that the changes remain without automatic playback. Its remote debugging port is local and belongs only to that test build. It does not modify the ordinary app's library. Test artifacts are under `test-results/native-smoke-*`.

The scale benchmark uses synthetic metadata in temporary SQLite databases. It measures native storage/FTS, bounded bootstrap serialization, paged queries and patch writes. It excludes tag parsing, browser rendering and actual disk-library scans. Compatibility snapshot validation/read costs still scale with collection size; the desktop now uses pages and patches.

At 100,000 records, the current build measured bootstrap at 114 ms / 54,871 bytes, the last title page at 130 ms, and a favorite patch at 3.328 ms / 201 bytes / 3 row writes. The compatibility snapshot save took 2,264 ms; an unchanged save wrote zero rows. Query indexes/triggers add import work (current 100k insertion: 28,442 ms). See [current measurements](benchmarks/features-2026-11-08.json). The [earlier FTS benchmark](benchmarks/library-2026-11-08.json) is historical and predates these indexes/triggers.

## Database upgrade and recovery

The backup interchange schema remains version 1. Internal SQLite `user_version` is 3. Version-1 upgrades create `library-v1-backup-<timestamp>.sqlite3`; existing version-2 databases receive `library-v2-backup-<timestamp>.sqlite3`. Recovery copies include committed WAL contents. Migration preserves IDs, grants and metadata undo, normalizes queue/playlists/session and adds query indexes, clocks and an analysis cache. Failed migrations roll back.

Older binaries reject newer internal database versions. To roll back, close all player instances and preserve the current database/WAL files. Restore the matching version-1/version-2 recovery copy with the older executable, or export/import compatible metadata through the UI. Never overwrite a live database or copy only one file from a live WAL database.

## Practical limits

The 250,000-track boundary prevents contract drift and overflow; it is not a claim that every UI operation is fast at that size. Slow media/device preparation still shares the render worker and needs stress measurements. Duplicate-name rejection is safer routing, not a replacement for stable platform device IDs. Digital silence cannot establish audible quality, correct channel mapping on every device, exclusive mode or bit-perfect output.

Real publisher/updater credentials, signed clean-machine install/update/recovery, unplug/replug and sleep/resume, codec fixtures, macOS/Linux execution and manual accessibility acceptance remain release obligations. Current Rust auditing must be reported with upstream maintenance/unsoundness warnings; a zero-vulnerability count does not erase those warnings. No public release or remote CI execution is implied by local checks.
