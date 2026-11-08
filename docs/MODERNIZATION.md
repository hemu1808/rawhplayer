# Modernization status and remaining roadmap

Updated 2026-11-08 on `update/Features`. The user selected the first five improvements for implementation. Their delivered behavior, evidence and limits are in [FEATURES_2026-11-08.md](FEATURES_2026-11-08.md).

## Implemented in this branch

| Capability                | Delivered implementation                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large-library performance | Bounded catalog queries, artist/album indexes and groups, full-catalog search, metadata caching, paged queue/maintenance views and revisioned preference/queue/playlist/session patches |
| Audio conversion          | Rubato sinc conversion, matching-rate bypass, delay/padding handling, seek/speed resets and signal-path reporting                                                                       |
| Generated contracts       | Reflected Rust command and core event DTOs, generated TypeScript SDK, structured patch errors and a stale-bindings CI test                                                              |
| OS media sessions         | Souvlaki SMTC/Now Playing/MPRIS metadata and transport bridge, throttled updates and shortcut fallback                                                                                  |
| Local analysis/discovery  | Cancellable streaming analysis, SHA-256/versioned caches, EBU R128/true peak, tempo/key estimates, RMS energy and explained suggestions                                                 |

## Next work

1. Move slow decoder/device preparation off the worker that feeds audio. Preserve generation/deadline checks and measure slow-disk, rapid-selection and hotplug underruns.
2. Replace device-name profile keys with stable native device identities, then evaluate exclusive output adapters and format negotiation. Physical measurements are required before a bit-perfect claim.
3. Add scheduled metadata snapshots, restore previews and conflict-aware batch tagging. Keep original audio and metadata undo recoverable.
4. Add the full codec, installer/update/recovery, sleep/hotplug and assistive-technology test matrices. Exercise system lock-screen/headset controls on Windows and the native implementation on macOS/Linux.
5. Consider a local natural-language parser that produces editable smart-playlist rules. Evaluate embeddings only after measuring their usefulness, CPU and memory costs.

Convolution filters and third-party plugin hosting remain separate projects requiring latency handling, crash isolation and compatibility evidence. Cloud/provider streaming is not part of the local-player implementation.

## Engineering limits

Catalog metadata is bounded in the desktop UI, but queue identity lists and bulk scans/exports/restores still scale with collection size. Deep OFFSET pages and group/count queries have measured costs. The compatibility snapshot API is retained for recovery/diagnostics; interactive saves use patches.

Tempo/key are estimates rather than authoritative tags. Playback speed changes pitch. Unknown multichannel layouts do not receive inferred loudness measurements. New dependencies are pinned; Tauri Specta remains a release-candidate API.

Public release still requires real publisher/updater identities, clean-machine acceptance and supported-platform/device verification. See [VALIDATION.md](VALIDATION.md) and [RELEASING.md](RELEASING.md).
