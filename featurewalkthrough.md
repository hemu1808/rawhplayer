# Current RawhPlayer walkthrough

The earlier walkthrough is preserved in [docs/history](docs/history/README.md). The active audio engine is `src-tauri/src/engine.rs` and its `audio/` modules.

1. Open the desktop app and import files/folders, drop audio, or open an associated audio file. Native picker/drop/launch handlers grant file access; backups never grant access.
2. Choose a library track. The UI queues explicit track/queue identities and the native worker decodes with Symphonia, renders DSP and feeds bounded CPAL output blocks. Browser preview does not provide native playback.
3. Pause and change favorites or playlists. Durable edits save immediately; unchanged paused updates do not keep restarting persistence timers. Position checkpoints have a bounded delay. Closing from the title bar or tray waits for a successful save; save failure keeps the window open.
4. Select an output device or the system default. Duplicate device names are rejected for explicit selection rather than silently choosing the wrong output. Rename duplicates in OS settings to select them individually.
5. Use watched folders, missing-file repair or metadata editing. Native scans preserve IDs and current preferences; metadata edits keep recovery copies. Library records, queue removal and duplicate review do not delete audio files.
6. Browse/search the native catalog in pages and switch to artist/album groups. Queue metadata is also paged; selecting an uncached track resolves its native ID. Favorites and session edits use small revisioned patches.
7. Open Setup to run local audio analysis, inspect progress, cancel or reanalyze the current track. Tempo/key are labeled estimates; loudness and energy inform suggestions only after analysis.
8. Inspect the Audio signal path for Rubato conversion or matching-rate bypass. OS media controls expose the audible track and transport.
9. Export a library backup before migration or release testing. Audio and credentials are excluded. Restored paths need native grants; restart restores the session without automatically playing.

The shared contract in `shared/library-contract.json` defines track/queue/playlist limits and audio extensions for TypeScript and generated Rust constants. The 250,000-track limit is a compatibility/capacity boundary, not a measured UI performance guarantee.

See [the repair checkpoint](IMPLEMENTATION_STATUS.md), [verification instructions](docs/VALIDATION.md) and [the modern feature roadmap](docs/MODERNIZATION.md).
