# RawhPlayer project review and workspace cleanup

Reviewed on 2026-11-07 against `628f382fb44fe8702fbbb0a853e72a0da66d7d21`.
Canonical source: `D:/repos/rawhplayer`, branch `main`.

RawhPlayer has a substantial working local-player implementation and passing automated checks. It still needs persistence fixes, dependency maintenance and installed-app/hardware evidence before public distribution. The October review folders are historical work products, not separate applications or runtime requirements.

## What the four home folders contain

| Folder under `C:/Users/hemu1`         | Observed size before review checks | Purpose                                                                                                                         | Decision                                                                                                                              |
| ------------------------------------- | ---------------------------------: | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `rawhplayer-implementation`           |   17,464,952,467 bytes / 16.27 GiB | Linked Git worktree on `codex/rawh-launch-readiness`; same commit as `main`, clean working tree; mostly Rust compilation output | Remove with Git after preserving inventories and copying its current npm dependencies into the canonical checkout. Retain the branch. |
| `rawhplayer-audit-20261021`           |         2,960,883 bytes / 2.82 MiB | Older source copy, failed-regression evidence, launch review, backlog and implementation plan                                   | Preserve in a verified ZIP, then remove the expanded folder.                                                                          |
| `rawhplayer-launch-review-2026-10-27` |         2,939,696 bytes / 2.80 MiB | Older snapshot, source tar and launch review                                                                                    | Preserve in a verified ZIP, unlink its `snapshot/node_modules` junction, then remove the expanded folder.                             |
| `rawh-tools`                          |     3,235,781,643 bytes / 3.01 GiB | Isolated Rust/rustup installation, Cargo cache and audit/SBOM tools                                                             | Keep. This is the only Rust installation found during the review and was used successfully for native tests.                          |

Folder sizes count stored files without following directory junctions. The launch snapshot's junction points at `D:/repos/rawhplayer/node_modules`; that target must be preserved during snapshot deletion. Exact cleanup accounting, archive hashes and remaining paths are recorded in [cleanup-result.json](review-archive/2026-11-07/cleanup-result.json).

The canonical checkout had stale installed dependencies: Vite 5.4.21 and Vitest 4.1.10 versus the lockfile/worktree's Vite 8.3.5 and Vitest 5.0.5. Cleanup consolidates the matching installed dependency tree into the canonical checkout, verifies every copied file and reruns its frontend checks. Package manifests and locks are unchanged.

## Findings that need attention

### 1. Paused playback can prevent library changes from being saved

Priority: high. Reproduced with the real `LibraryProvider` and mocked native events.

[LibraryContext.tsx](../context/LibraryContext.tsx) schedules a save 400 ms after each snapshot change (line 164). Its playback listener creates a new snapshot on every paused update, even when the position has not changed (line 678). The engine emits playback updates approximately every 100 ms. An active paused track can therefore keep resetting the save timer; favorite and playlist changes remain unsaved while these events continue.

The review harness selected a track, changed its favorite status and sent paused updates every 100 ms for two seconds. There were zero `library_save` calls. One save occurred after updates stopped for 450 ms. The page-hide flush is asynchronous and is insufficient evidence of crash/close durability.

Recommended fix: avoid updates when paused position and accumulated listening time are unchanged, give durable edits an explicit save path, and bound the maximum delay for saves. Verify favorites, playlists and position across pause, close and forced termination.

### 2. Frontend and native library limits disagree

Priority: high for large libraries. Frontend rejection reproduced; native limit confirmed in source.

[libraryStore.ts](../services/libraryStore.ts) caps tracks, queue entries and playlist membership at 100,000. [library.rs](../src-tauri/src/library.rs) sets `MAX_TRACKS` to 250,000. Native load/import can produce a library the frontend rejects during initialization, save or reconciliation. The harness confirmed that an otherwise valid 100,001-track snapshot throws `Invalid library backup.`

Recommended fix: define matching limits in the IPC contract, enforce the total during import, and measure large-library behavior before raising limits. Do not silently truncate a user's existing library.

### 3. The full npm audit now fails the configured CI threshold

Priority: medium; release CI blocker. Fresh `npm audit --json` reports seven moderate affected packages propagated through `typescript-eslint` from one `minimatch` advisory. This is one underlying advisory, not seven independently demonstrated exploits. `npm audit --omit=dev --json` reports zero findings.

The upstream [GHSA-g3hv-75wg-m249 advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249), reviewed on 2026-11-07, lists affected `minimatch` versions from 7.0.0 through versions below 11.0.1. The repository's CI runs `npm audit --audit-level=moderate`, so the current lockfile is expected to fail that gate. Remote CI was not run in this review. The October zero-finding audit is historical evidence.

Recommended fix: investigate a compatible patched dependency chain, update the lock deliberately, and rerun install, lint, build and audits. Do not apply npm's suggested major-change/downgrade remedy blindly. No dependency source or lockfile changes were made during this cleanup.

### 4. Native playback and delivery still need real acceptance evidence

Priority: public-release gate. Generated-WAV tests and browser journeys do not establish audible quality, device disconnect/reconnect behavior, sleep/resume, real filesystem events, clean-machine installation or updater recovery.

The active path is [lib.rs](../src-tauri/src/lib.rs) -> `engine.rs` -> `audio/`. The old `audio_engine.rs` file is not the active engine; its unsafe stream wrapper and old TODOs must not be reported as defects in the current compiled engine. Placeholder AI-DJ/VST/spatial/room-correction modules likewise do not establish shipped capabilities.

The active output uses the device's default format, float PCM, standard bounded channels and a linear-interpolation resampler. It is reasonable for a general local player, but exclusive output, bit-perfect output, high-quality sample-rate conversion and hard real-time guarantees are unproven. Decode/device setup shares the engine worker with queue feeding; slow operations need stress and underrun measurements. Duplicate device names also deserve testing because device IDs currently use names.

### 5. Library scale and maintenance boundaries need work

Priority: medium. Native `library.rs` is approximately 1,780 lines and combines persistence, imports, grants, metadata recovery, waveform generation, backups and tests. Native saves read and upsert the full library. The UI derives queue, duplicates and suggestions from snapshots. These are concrete reasons to benchmark large collections and split responsibilities before adding more integrations.

Some unused legacy declarations remain, including DSD extensions in `config.ts`, while the active picker and README correctly exclude DSD. Consolidate contracts and retire obsolete source after a separate behavior review. Historical proposal-only notes in `codex.md` are superseded for the October implementation; keep historical and current status clearly dated.

`Rawh Player .docx` is an older product/deployment plan. It still instructs a Tauri 2 migration although the project already uses Tauri 2, describes mobile targets without current delivery evidence, and equates Purist Mode with bit-perfect output. Treat it as historical product intent; use the current README and release runbook for supported behavior and setup.

### 6. The canonical Windows checkout has a line-ending mismatch

Priority: low; local developer-experience issue. Final `npm run format:check` in the canonical checkout reports 87 files. A second comparison through the installed Prettier API confirmed that every difference is CRLF versus LF; there are no other formatting differences. The removed implementation worktree used LF and passed the same check. Git considered both working trees clean because checkout conversion accounts for these line endings.

Recommended follow-up: agree on repository line endings and enforce them with `.gitattributes` and compatible editor/Git settings. Application files were not rewritten during an analysis-and-cleanup task. The canonical build, lint, typecheck and tests pass; its full formatting gate remains failing until the checkout policy is aligned.

## What is already strong

- Separate durable library records and queue identities; queue removal preserves music/library records.
- SQLite transactions, native file grants, backup validation, one-time legacy migration and metadata undo/recovery.
- Dedicated audio worker, bounded PCM buffering, generation checks and worker-side PCM reclamation.
- Source/output signal details and honest documentation of unimplemented integrations.
- OS-backed credentials, restricted native file access, redacted diagnostics and optional-integration policy.
- Release preflight, signature configuration checks, draft release delivery, checksums and dependency inventories.
- Automated frontend, native and browser coverage. These are a useful foundation, with the gaps above still visible.

## Verification in this review

| Check                       | Observed result                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git source comparison       | Main and implementation worktree clean and at the same full commit before cleanup; no unique worktree commits to merge                                                      |
| `npm run check`             | TypeScript, strict ESLint, 43 frontend tests, 4 release tests and production build passed in the implementation worktree; repeated in the canonical checkout during cleanup |
| Production bundle           | Main JS approximately 287.16 kB / 88.27 kB gzip; CSS approximately 48.01 kB                                                                                                 |
| `npm run format:check`      | Passed in the former implementation worktree; canonical checkout reports 87 CRLF/LF-only differences, independently confirmed through Prettier's API                        |
| `npm run test:e2e`          | Five Chromium journeys passed; development-server teardown needed manual termination of the review's Vite process in this Windows sandbox                                   |
| Locked offline native tests | 28 passed using the retained isolated Rust installation                                                                                                                     |
| Two review reproductions    | Both confirmed the observed persistence/limit defects; these are diagnostic assertions, not fixed-feature acceptance tests                                                  |
| npm dependency audits       | Seven moderate development-package findings; zero production-package findings                                                                                               |

Native Clippy, current Rust advisory refresh, signed installers, remote CI/platform matrix and physical audio-device acceptance were not rerun. The October native build/signing documentation remains historical. No public release, commit or push was performed.

Historical source/reports, inventories and the diagnostic harness are stored in `docs/review-archive/2026-11-07/`. ZIP contents are verified against SHA-256 manifests before deletion. The cleanup leaves application source unchanged and retains all Git history and the merged implementation branch.

## Native development after cleanup

The Rust folder is tooling, not user music or an application database. It does not need to be on the persistent system PATH. In a PowerShell session at the canonical checkout:

```powershell
$env:CARGO_HOME = 'C:\Users\hemu1\rawh-tools\cargo'
$env:RUSTUP_HOME = 'C:\Users\hemu1\rawh-tools\rustup'
$env:Path = "$env:CARGO_HOME\bin;$env:Path"
npm run tauri dev
```

Deleting `rawh-tools` later is possible after installing a replacement toolchain, but deleting it now would remove the only verified native build environment found here. Future Rust builds will recreate Cargo target files in the canonical checkout as needed.
