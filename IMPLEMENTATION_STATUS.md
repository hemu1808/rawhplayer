# RawhPlayer implementation checkpoint — 2026-10-28

Worktree: `C:/Users/hemu1/rawhplayer-implementation`.
Branch: `codex/rawh-launch-readiness`, based on `1617b9c`.
Implementation was developed in an isolated worktree. The user authorized integration and push to `main`; publishing a signed public release is a separate operation.

The user's implementation request supersedes the historical proposal-only restriction in codex.md. This document records verified work and remaining obligations; it does not declare launch readiness.

## Implemented and integrated

- Dedicated native audio worker, bounded output queue, direct Symphonia float decoding, numerical input validation, explicit queue identities, seeking, gapless transitions, crossfade, tagged ReplayGain and output-device commands. Expired queued requests are rejected before work and after decoder/device preparation. Device selection reconstructs the audible track rather than seeking a decoder that may already be on the next track.
- Separate library, queue entries, saved playlists and basic smart playlists. Queue deletion preserves library records; search selects by ID; restored sessions do not automatically play.
- SQLite migrations and durable library/session storage, native file/folder picker and drops, persisted selected-path grants, artwork/waveform caches, scoped metadata-edit/undo commands and backup/restore.
- Bounded, debounced folder reconciliation with startup restoration, rename/delete/reconnect handling, retry for unavailable folders and Settings controls. Watch roots are native-authoritative so stale UI saves cannot undo configuration. Scans preserve recent user metadata; restore, remove and metadata edits serialize against scans.
- One-time migration of legacy localStorage library data. Original data is retained, stale blob/provider references are excluded, native initialization prevents repeated migration and no filesystem grants are inferred. Windows path normalization preserves IDs when migrated files are re-imported.
- Metadata editor with title/artist/album/genre/year/track number and undo. Fixed Windows backup flush permissions; a real WAV test verifies byte-for-byte undo.
- Playback errors, output settings, actual source/output details, seekable waveform, local synchronized lyrics, bounded dynamic artwork palettes, playback controls, media keys and remembered window state. Fixed stale visualizer colors, FFT amplitude scaling and hardcoded source labels.
- Queue drawer close-button overlap fixed through browser testing. Native-only effects no longer throw in browser preview; metadata dialog uses native browser focus handling.
- OS-backed integration credentials, redacted diagnostic export, bundled fonts and corrected privacy/README documentation. Removed fabricated YouTube fallback results and unsupported DSD associations.
- Placeholder updater configuration removed. Development builds register no updater. Release overlays require matching versions/tags, a structurally valid public key and platform signing inputs. Release workflow uses scoped signing secrets, Windows certificate import/cleanup, Apple signing/notarization inputs and updater artifacts/manifest. Draft publication remains separate.
- On-demand update check/install UI with download errors, signature-failure test and resource cleanup. `RAWH_DISABLE_UPDATES=1` prevents updater-plugin registration for managed installs.
- Tauri JavaScript dependencies aligned to native crate minor versions. Removed `TAURI_*` from frontend-exposed environment prefixes to keep signing credentials outside that mechanism.
- Missing-file repair preserves identity, favorites, history and playlist membership; duplicate review removes entries without deleting source audio. Smart playlists have editable artist/genre/format/unplayed/recent/sample-rate rules.
- Per-device EQ and volume defaults, native compact-window geometry, tray playback controls and a keyboard command palette. File associations queue native launch/open requests until the library is ready; the single-instance plugin forwards subsequent Windows/Linux launches, and macOS open events use the same scoped import path.
- Explainable local queue suggestions using favorites, play counts and artist/genre matches. Suggestions exclude queued, missing and unavailable tracks and require explicit selection.
- Administrator policy for updates, external integrations and file-tag edits; redacted output diagnostics. Release tooling generates npm/Rust SBOMs, license inventories, SHA-256 checksums and hosted provenance configuration. Inventory generation is not license approval.
- Audio blocks are reclaimed on the worker instead of freeing their sample allocations on the output callback. Standard bounded channels remain; hard real-time lock freedom is not claimed.
- TypeScript, strict ESLint, formatting, regression tests, browser CI, locked Cargo checks, Linux D-Bus prerequisites and release preflight tests. Patched npm's reported vulnerabilities using compatible dependency updates.

## Verified on this Windows machine

- `npm run check`: TypeScript, ESLint with zero warnings, **43 frontend tests**, **4 release configuration/checksum tests**, and production frontend build passed.
- `npm run test:e2e`: **5 Chromium journeys passed**: queue/library/playlist persistence, keyboard/settings behavior, metadata-dialog interaction, command-palette/smart-rule editing and explicitly selected queue suggestions. These use browser persistence, not real native playback.
- `npm run format:check` and `git diff --check`: passed.
- `cargo test --locked --lib`: **28 native tests passed**, including generated-WAV seek/transition/crossfade, SQLite/grants/migration/reconciliation, file repair, metadata edit/undo, callback block ownership, policy validation and native file-open path filtering.
- `cargo fmt --check` and `cargo clippy --locked -- -D warnings`: passed.
- `npm run tauri build -- --debug --no-bundle`: passed. Executable: `src-tauri/target/debug/rawhplayer.exe`. This is an unbundled debug executable, not a signed installer or tested deployment.
- npm audit reported **0 vulnerabilities**. `cargo audit --file src-tauri/Cargo.lock` completed with no vulnerability errors and seven upstream warnings, detailed in the release runbook. No advisories are suppressed.
- CI/release workflow YAML parsed successfully. The remote platform matrix and signing workflow have not been executed.
- Rust 1.99.1 and Microsoft C++ Build Tools/SDK available. Rust is isolated in `C:/Users/hemu1/rawh-tools`; rustup did not modify system PATH.

## Required work still outstanding

1. Installed-app and real audio-device validation: import/play/seek, transition timing, rapid selection, clear/remove/reorder while playing, sleep/resume, unplug/replug and default-device changes. Generated fixtures do not prove hardware journeys or actual filesystem-notifier behavior.
2. Broader audio-worker stress/hardware review: timeout races during active operations, decoder-ahead buffering/device changes, resampling quality and queue-boundary races. The current resampler uses linear interpolation. Disconnect recovery needs hardware validation.
3. Broader process-termination/external-file fault testing, OS file-association launch testing on all supported platforms, system media-session metadata integration, full keyboard/focus/contrast review and measured large-library performance. No accessibility compliance claim is made.
4. Configure real updater/publisher signing secrets, verify the signing key pair and all platform artifacts, run notarization and clean-machine update/recovery tests. No signing identity or secret has been invented. See [release runbook](docs/RELEASING.md).
5. Review declared dependency licenses and the seven upstream warnings; verify generated inventories/checksums and hosted provenance for real release artifacts. Central policy distribution, SSO and cloud-based organization management are not implemented.
6. VST hosting, room correction, spatial audio, cloud sync and provider playback remain unimplemented; placeholder source modules must not be represented as features.
7. The existing `com.rawhplayer.app` identifier is retained for storage compatibility; Tauri warns about its .app suffix on macOS, which needs review before distribution. Public release remains gated on the platform/signing/hardware checks above.

No public-launch readiness is implied by passing the checks above.
