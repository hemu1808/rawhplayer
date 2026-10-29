# Changelog

All notable changes to Rawh Player will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Dedicated native decoding/output worker, gapless transitions, seeking, crossfade, ReplayGain and measured signal-path details.
- SQLite library, separate queue and saved playlists, editable smart filters, watched-folder reconciliation and migration of legacy metadata.
- Missing-file repair, duplicate review, metadata editing with byte-preserving undo, library backup/restore, cached artwork/waveforms and local lyrics.
- Per-device EQ/volume profiles, explainable queue suggestions, compact/tray controls, command palette and native file-open/single-instance integration.
- OS credential storage, scoped native file grants, administrator policy, redacted diagnostics, signed-update controls and release configuration checks.
- Reproducible frontend/native/browser checks, dependency auditing, SBOM/license inventories, checksums and release provenance configuration.

### Fixed

- Search selection, queue removal/clearing, stale playback events, device contracts, invalid native input and transient artwork persistence.
- Compatible dependency updates resolve the reported npm vulnerabilities and Rust vulnerability errors; upstream warnings remain documented in the release runbook.

### Release status

- These changes do not publish a release. Publisher/updater signing, installed-app recovery and real-device validation remain release gates.
- The historical inventory below included prototypes. Current shipped scope is described in README.md; provider streaming, VST, room correction, spatial audio and cloud sync are not implemented launch features.

## [3.0.0] - 2026-08-11

### Added

- **Enterprise Architecture**: Complete refactoring from monolithic App.tsx to React Context + custom hooks architecture
- **Gapless Playback**: Pre-buffered track transitions via Rodio sink queue for seamless album listening
- **Audio Device Selection**: Enumerate and display available output devices via CPAL
- **Crossfade Engine**: Configurable 0–12s crossfade between tracks at the DSP level
- **Clipping Protection**: Real-time clipping detection with soft limiter after EQ processing
- **Playback Rate Control**: Variable speed playback (0.25x–4.0x) via Rodio speed adapter
- **Real Audio Metadata**: Actual sample rate, bit depth, and channel count from Symphonia probe
- **Favorites System**: Like/unlike tracks with persistent storage
- **Playback Mode Cycling**: Full Sequence → Loop → Shuffle rotation with LOOP repeat
- **Queue Shuffle**: Fisher-Yates shuffle on upcoming tracks
- **Smart Playlists**: Auto-generated playlists (Recently Added, Most Played, Favorites)
- **Folder Watching**: Auto-import from watched directories via `notify` crate
- **Global Media Keys**: OS-level Play/Pause/Next/Prev hotkey support
- **Mini Player Mode**: Compact floating window with basic controls
- **Metadata Editor**: Read/write ID3/Vorbis tags via `lofty` crate
- **Internet Radio**: Icecast/SHOUTcast stream support
- **Audio Fingerprinting**: Track identification via AcoustID/MusicBrainz
- **Dynamic Album Art Themes**: Extract dominant color from artwork, auto-theme UI
- **Listening Statistics**: Play counts, listening time tracking
- **Lyrics Display**: Synchronized lyrics from external APIs
- **DLNA/UPnP Renderer**: Network audio renderer foundation
- **Spatial Audio Foundation**: Binaural processing stub for future HRTF
- **AI DJ Mode Foundation**: Gemini-powered track sequencing stub
- **VST Plugin Host Foundation**: Third-party audio effect plugin stub
- **Room Correction Foundation**: Microphone-based measurement stub
- **User API Key Settings**: Users can enter their own Gemini/YouTube API keys
- **ESLint + Prettier**: Consistent code formatting and linting
- **CI/CD Pipeline**: GitHub Actions for lint → test → build → release
- **Auto-Updater**: Tauri plugin updater configuration
- **File Type Associations**: OS-level registration for audio file formats
- **Privacy Policy**: Template for Gemini API data disclosure

### Changed

- **Architecture**: App.tsx refactored from 719 lines to ~150 lines using Context providers
- **State Management**: 15+ useState hooks replaced with useReducer in PlayerContext/LibraryContext
- **EQ Performance**: Coefficient checks batched per-256-samples instead of per-sample
- **reqwest Pooling**: Single HTTP client reused across all API calls
- **Theme Engine**: All 5 CSS variable color stops now applied (was only 2)
- **AI Insights**: Cached by track ID to prevent redundant API calls
- **Bitrate Display**: Accurate calculation from file size and duration

### Fixed

- **Stale Closure**: Keyboard shortcut arrow keys now use refs for current playback position
- **Version Mismatch**: package.json, tauri.conf.json, Cargo.toml all synced to 3.0.0
- **Dev Port**: Vite and Tauri dev server ports aligned to 1420
- **CSP**: Google Fonts domains added to Content Security Policy
- **File.path**: Proper typed access replacing unsafe `(file as any).path`
- **Track Persistence**: Restored tracks retain absolute paths for native engine replay
- **Tauri Capabilities**: Added dialog, fs, shell permissions
- **AudioEngine Failure**: Graceful degradation instead of app panic on missing audio device

## [2.1.0] - 2026-06-17

### Fixed

- 194 issues across 6 phases (Critical, High, Medium, Low, Accessibility)
- Fabricated VU meter data replaced with real L/R channel analysis
- Fabricated goniometer replaced with true stereo phase correlation
- API keys moved from client bundle to Rust backend
- Blob URL memory leak fixed
- All accessibility issues resolved (WCAG 2.1 AA)

### Added

- Native 10-band Biquad IIR parametric equalizer in Rust
- Real-time FFT spectral analysis at 30fps
- Code splitting via React.lazy for all pages
- Purist mode (EQ bypass for uncolored signal path)
- Cargo release optimizations (LTO, strip, panic=abort)

## [1.0.0] - 2026-06-01

### Added

- Initial release with React + Tauri audio player
- Basic playback controls, file import, visualizations
- YouTube search, AI track insights, theme engine
