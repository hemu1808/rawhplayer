# RawhPlayer

RawhPlayer is a local desktop music player built with Tauri 2, Rust, React and TypeScript. This branch is undergoing launch hardening. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior and remaining launch gates.

The November repairs and reproducible checks are described in [docs/VALIDATION.md](docs/VALIDATION.md). The first five modernization improvements are implemented on `update/Features`; see [the feature notes](docs/FEATURES_2026-11-08.md) and [remaining roadmap](docs/MODERNIZATION.md). Older plans remain in [docs/history](docs/history/README.md).

## Implemented

- Native Symphonia decoding and CPAL output on a dedicated worker, with a bounded output queue, seeking, volume, playback speed, equalizer bypass, gapless transitions, crossfade and tagged ReplayGain.
- SQLite library, separate playback queue, favorites, saved playlists and editable smart playlists. Queue removal preserves library records. Missing-file repair preserves track identities; duplicate review removes library entries without deleting audio.
- Native file/folder import and drops, scoped file access, watched folders with startup scans and rename/delete/reconnect reconciliation. File associations import the chosen audio and play it in the existing player; launch requests wait until the library is ready.
- Local lyrics, artwork, waveform cache and signal-path details. Source and output formats are reported separately.
- Library export/restore and one-time migration of legacy localStorage metadata. Re-import folders to reconnect migrated or restored files.
- Optional Gemini track insights with OS credential storage.
- On-demand signed-update controls. Development builds have no updater endpoint; release configuration requires signing credentials.
- Per-device EQ and volume profiles, compact window and tray controls, and a keyboard command palette (Ctrl/Cmd+K).
- Paged native browsing/search, artist/album groups, a bounded metadata cache and small revisioned saves.
- OS media-session metadata and remote transport controls, with global shortcuts as a fallback.
- Opt-in local loudness/true-peak, tempo/key estimates and energy analysis, with cancellation and cached results.
- Explainable queue suggestions using available audio analysis, favorites, history and artist/genre. Tracks enqueue after selection.
- Administrator policy for updates, optional integrations and file metadata edits; redacted diagnostics and release dependency inventories.

MP3, FLAC, WAV, Ogg/Vorbis, AAC, M4A and AIFF are supported subject to codec/container compatibility. Rubato sinc conversion handles rate changes and bypasses matching rates at normal speed. DSD, VST hosting, room correction, cloud sync and provider streaming are not shipped capabilities. Exclusive output, bit-perfect playback, professional latency and accessibility compliance have not been established.

## Development and checks

Use Node 22.13+ within the 22.x line, or Node 24+ (Node 22 is the CI baseline), the Rust version pinned in `rust-toolchain.toml` and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows requires MSVC and the Windows SDK; Linux also needs ALSA and D-Bus development packages.

```sh
npm ci
npm run tauri dev
```

`npm run dev` previews the UI in a browser. Native playback, credentials, file import and watching require the desktop application.

```sh
npm run check
npm run format:check
npm run test:e2e
npm run check:native
npm run generate:ipc # after changing Rust command/event signatures
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Install Chromium with `npx playwright install chromium` before browser tests. Those tests cover UI persistence and interaction, not hardware playback. Native tests use generated WAV fixtures and isolated SQLite databases.

`check:native` also discovers the retained `rawh-tools` installation on this Windows machine and limits debug-symbol/cache size. `npm run test:native:hardware` explicitly opens the default output and emits digital silence. `npm run test:native:desktop` builds a hidden Windows WebView2 test app with a separate identity, checks real IPC and persistence, then restarts it. Neither check proves audible quality or signed installer behavior. `npm run benchmark:library` runs the optional synthetic storage benchmark.

## Data and releases

Music stays in the selected folders. The database, artwork, waveforms and metadata-edit recovery copies live in the application's data directory. Backups include file paths and metadata, but do not contain audio or credentials. See [PRIVACY.md](PRIVACY.md).

The [release runbook](docs/RELEASING.md) describes signing configuration, managed update controls and manual launch gates. The workflow creates a draft release; publishing is a separate action.
