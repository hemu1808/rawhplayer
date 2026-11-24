# Release runbook

This branch is not approved for public launch. Unit tests do not establish hardware compatibility, installer recovery or update trust.

## Signing configuration

Create a GitHub environment named `release` and restrict it to reviewed release tags. Store the following there; never commit private keys or certificates.

| Type     | Name                               | Purpose                                   |
| -------- | ---------------------------------- | ----------------------------------------- |
| Variable | TAURI_SIGNING_PUBLIC_KEY           | Exact public-key output from Tauri signer |
| Secret   | TAURI_SIGNING_PRIVATE_KEY          | Matching updater private key              |
| Secret   | TAURI_SIGNING_PRIVATE_KEY_PASSWORD | Private-key password if used              |
| Secret   | WINDOWS_CERTIFICATE                | Base64 publisher PFX                      |
| Secret   | WINDOWS_CERTIFICATE_PASSWORD       | PFX password                              |
| Variable | APPLE_SIGNING_IDENTITY             | Developer ID Application identity         |
| Variable | APPLE_TEAM_ID                      | Apple developer team                      |
| Secret   | APPLE_CERTIFICATE                  | Base64 Developer ID P12                   |
| Secret   | APPLE_CERTIFICATE_PASSWORD         | P12 password                              |
| Secret   | APPLE_ID                           | Notarization Apple ID                     |
| Secret   | APPLE_PASSWORD                     | Apple app-specific password               |

The Windows workflow imports the certificate, derives its thumbprint and removes it afterward. Hardware/cloud signing requires replacing that step with the organization's provider integration.

`scripts/release-config.mjs` rejects absent keys, malformed public keys, version/tag mismatches and missing platform signing inputs. Its ignored overlay contains public configuration only. Tauri performs artifact and platform signing. Preflight checks structure; a real update test must establish that the key pair works.

The endpoint is `https://github.com/OWNER/REPO/releases/latest/download/latest.json`. Tauri Action produces this manifest. Retain the signing key securely and do not rotate a deployed public key without a tested migration plan.

Official references: [updater](https://v2.tauri.app/plugin/updater/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/), [macOS signing/notarization](https://v2.tauri.app/distribute/sign/macos/).

## Build and promotion

1. Review changes and align package.json, Cargo.toml and tauri.conf.json versions.
2. Pass frontend, browser, native, formatting, Clippy and dependency checks on supported platforms.
3. Create the matching vX.Y.Z tag through the approved release process.
4. Confirm all four matrix jobs succeed. A failed matrix can leave partial draft uploads; never publish a partial draft.
5. Inspect publisher signatures, notarization, manifest architecture entries and updater signatures.
6. Test the exact draft artifacts on clean machines and record the recovery checks below.
7. Publish the reviewed draft separately.

Each target generates npm/Rust CycloneDX SBOMs, a license-declaration inventory and SHA-256 checksums alongside the draft installers. Public repositories also generate GitHub provenance attestations with `actions/attest`; private deployments must enable a supported attestation service before promotion. Inventories and hashes are generated locally; actual hosted attestations require a release workflow run. Review missing or non-SPDX license entries and verify the downloaded installer hashes independently before promotion. Inventory generation does not constitute license approval.

## Recovery and hardware checks

- Open a PR to `main` or run CI on the candidate branch before tagging. Confirm the Linux and Windows browser jobs and all four Tauri targets succeed.
- From a fresh install, import and play WAV, FLAC, MP3, Ogg/Vorbis, AAC, M4A and AIFF fixtures. Record source and output formats, seek results, and any audible dropouts with matching and converted sample rates.
- During continuous playback, preload from a slow or removable drive, seek repeatedly, switch devices and reorder or remove the next entry near gapless and crossfade boundaries. Record playback position, expected next track, and the change in underrun count visible in diagnostics. Repeat across default-device changes, unplug/replug and sleep/resume.
- Add, rename and remove a nested watched folder while browsing or saving edits in a large catalog. Record time to reflect changes and whether browsing and edits stay responsive. Reconnect an unavailable root and verify that playlist IDs and favorites survive.
- Verify play/pause, seek and track info from headset buttons and system media controls. Navigate import, playback, queue, backup and update controls using the keyboard and a platform screen reader.
- Upgrade with favorites, playlists and saved position intact and paused.
- Run `npm run test:native:backup` and restore a copy of a representative desktop backup on a clean profile. Confirm playlists, queue order and missing-file recovery before restoring on a primary profile.
- Reject an untrusted signature and truncated download while preserving the working installation.
- Network loss, disk exhaustion, cancelled installer and failed installation.
- Reinstall the previous signed installer with a compatible backup if deployment fails; do not silently downgrade a migrated database.
- Verify Windows publisher identity, macOS Gatekeeper acceptance and supported Linux packaging.

## Managed deployment

Launch with `RAWH_DISABLE_UPDATES=1` to prevent updater-plugin registration and disable update controls. Administrators can also provision `policy.json` at `%ProgramData%/RawhPlayer/` on Windows, `/Library/Application Support/RawhPlayer/` on macOS or `/etc/rawhplayer/` on Linux:

```json
{
  "allowUpdates": false,
  "allowExternalServices": false,
  "allowMetadataEdits": false
}
```

Absent fields default to true. Invalid, unreadable or oversized policy files prevent startup; unknown fields are rejected to catch misspellings. Changes apply after restart. Native command handlers enforce restrictions on Gemini/YouTube requests and file-tag edits/undo; local import, library edits and remote artwork display are separate. Protect the file and its parent directory with administrator-owned permissions. This is local deployment configuration, not tamper resistance against a user controlling the process environment or executable. Central distribution, SSO and organization auditing are not implemented.

The November 23 RustSec audit passed with eight upstream warnings after updating `cookie`, `url` and bundled SQLite through `rusqlite`. The warnings covered `chrono`, `instant`, `paste`, `proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive` and Linux `glib` VariantStrIter unsoundness. CI fetches current RustSec advisories and preserves the warning output. Review the Linux dependency risk before distribution.

Development builds omit updater configuration. Never add a placeholder key to bypass release checks.
