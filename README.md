# RawhPlayer

RawhPlayer is a local desktop music player built with Tauri 2, Rust, React and TypeScript. This branch is undergoing launch hardening. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior and remaining launch gates.

## Implemented

- Native Symphonia decoding and CPAL output on a dedicated worker, with a bounded output queue, seeking, volume, playback speed, equalizer bypass, gapless transitions, crossfade and tagged ReplayGain.
- SQLite library, separate playback queue, favorites, saved playlists and editable smart playlists. Queue removal preserves library records. Missing-file repair preserves track identities; duplicate review removes library entries without deleting audio.
- Native file/folder import and drops, scoped file access, watched folders with startup scans and rename/delete/reconnect reconciliation. File associations import the chosen audio and play it in the existing player; launch requests wait until the library is ready.
- Local lyrics, artwork, waveform cache and signal-path details. Source and output formats are reported separately.
- Library export/restore and one-time migration of legacy localStorage metadata. Re-import folders to reconnect migrated or restored files.
- Optional Gemini track insights with OS credential storage.
- On-demand signed-update controls. Development builds have no updater endpoint; release configuration requires signing credentials.
- Per-device EQ and volume profiles, compact window and tray controls, and a keyboard command palette (Ctrl/Cmd+K).
- Explainable local queue suggestions using favorites, listening history and artist/genre matches. Suggestions exclude queued and missing files and only enqueue after selection.
- Administrator policy for updates, optional integrations and file metadata edits; redacted diagnostics and release dependency inventories.

MP3, FLAC, WAV, Ogg/Vorbis, AAC, M4A and AIFF are supported subject to codec/container compatibility. DSD, VST hosting, room correction, cloud sync and provider streaming are not shipped capabilities. The resampler currently uses linear interpolation. Exclusive output, bit-perfect playback, professional latency and accessibility compliance have not been established.

## Development and checks

Use Node 22, the Rust version pinned in `rust-toolchain.toml` and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows requires MSVC and the Windows SDK; Linux also needs ALSA and D-Bus development packages.

```sh
npm ci
npm run tauri dev
```

`npm run dev` previews the UI in a browser. Native playback, credentials, file import and watching require the desktop application.

```sh
npm run check
npm run format:check
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Install Chromium with `npx playwright install chromium` before browser tests. Those tests cover UI persistence and interaction, not hardware playback. Native tests use generated WAV fixtures and isolated SQLite databases.

## Data and releases

Music stays in the selected folders. The database, artwork, waveforms and metadata-edit recovery copies live in the application's data directory. Backups include file paths and metadata, but do not contain audio or credentials. See [PRIVACY.md](PRIVACY.md).

The [release runbook](docs/RELEASING.md) describes signing configuration, managed update controls and manual launch gates. The workflow creates a draft release; publishing is a separate action.
