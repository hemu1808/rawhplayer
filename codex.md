# Rawh Player — Living Engineering Dossier

> 2026-10-28: The user explicitly authorized implementation of the launch review. Historical proposal-only notes below are superseded for that scope. Current implementation and validation status is recorded in `IMPLEMENTATION_STATUS.md`; public launch is not yet ready.

> Canonical project memory for analysis, implementation planning, walkthroughs, deployment and validation. Keep and update this file for the lifetime of the project.

## Document control

- Root: `D:/repos/rawhplayer`
- Product: React/Tauri desktop audio player
- Initial audit: 2026-08-24
- Status: Strong potential with successful build; proposal-only by user instruction.
- Safety: never delete, push, deploy or alter remotes without explicit authorization; preserve unrelated changes.
- Change mode: **proposal only** until the user explicitly changes this instruction.

## Executive verdict

Strong potential with successful build; proposal-only by user instruction. A local build alone is not production readiness. Production requires secure identity/authorization, reproducible delivery, automated evidence, runtime observability, rollback and clear ownership.

## Current capabilities

Local library, playlists, search, radio/connect, equalizer, statistics, persistence and Rust/Tauri audio engine.

## What is strong

Desktop-native design, Rust core, route splitting, ~334 KB main JS, tests and CI.

## Brutally honest weaknesses

Large dirty tree; ESLint missing; concurrent tests failed to spawn; deprecated Vite options; 683-line audio engine; capability expansion needs review.

## Production scorecard

| Area             | Initial status       | Enterprise exit requirement                                      |
| ---------------- | -------------------- | ---------------------------------------------------------------- |
| Product          | Needs journey review | Acceptance criteria and automated critical journeys              |
| Architecture     | Needs improvement    | Bounded modules, explicit contracts and dependency direction     |
| Security/privacy | Needs threat model   | Server-enforced auth, schemas, secrets and abuse/audit controls  |
| Reliability      | Incomplete           | Timeouts, retries, idempotency, recovery and failure tests       |
| Performance      | Unbudgeted           | CI budgets plus production measurements                          |
| Accessibility    | Unverified           | WCAG 2.2 AA keyboard/screen-reader evidence                      |
| Testing          | Uneven               | Unit, integration, contract and E2E gates                        |
| Delivery         | Incomplete           | Immutable artifact, staged promotion, migration and rollback     |
| Operations       | Incomplete           | Logs, metrics, traces, SLOs, alerts and runbooks                 |
| Documentation    | Established here     | Setup, architecture, API, decisions and walkthrough stay current |

## Immediate priorities

Do not change code. Reproduce install; run tests serially; minimize capabilities; split engine; add device/backend contracts and crash recovery.

## Enterprise engineering principles

1. Prove identity and enforce resource/tenant authorization on the server.
2. Validate every untrusted boundary with explicit schemas.
3. Keep UI, orchestration, domain logic and adapters independently testable.
4. Replace god files with cohesive modules and measurable complexity limits.
5. Use typed/versioned contracts and backward-compatible migrations.
6. Specify timeout, cancellation, retry, idempotency and recovery behavior.
7. Emit structured privacy-safe telemetry with correlation IDs and SLOs.
8. Build once and promote the same immutable artifact with routine rollback.
9. Apply least privilege to browser capabilities, tokens, cloud identities and data.
10. Record material decisions and actual results in this file.

## Proposed features

Gapless/ReplayGain/crossfade; smart playlists; waveform/spectrum; watcher/indexer; metadata editor; device switching; encrypted sync.

Every feature needs a user problem, owner, measurable outcome, privacy/security review, operational cost and removal strategy. Foundations come before feature volume.

## Implementation roadmap

### Phase 0 — Baseline and containment

- Classify the working tree and preserve existing changes.
- Make install/build/lint/typecheck/test commands reproducible.
- Add or repair honest CI gates; do not suppress known failures.
- Inventory secrets, environments, integrations and data classifications.
- Capture test, bundle, dependency and critical-path baselines.
- Fix release-blocking vulnerabilities before feature work.

### Phase 1 — Security and correctness

- Define identity, role, tenant and resource authorization.
- Add runtime schemas and centralized error contracts.
- Remove bypasses, unsafe defaults, browser-trusted authorization and source secrets.
- Test negative authorization and core domain invariants.
- Define privacy-safe audit events and logging.

### Phase 2 — Architecture and maintainability

- Split oversized files by domain responsibility.
- Introduce typed service interfaces/adapters.
- Consolidate network, state, error and loading conventions.
- Add architecture decisions and ownership.
- Enforce complexity, duplication and dependency-boundary budgets.

### Phase 3 — UX, accessibility and performance

- Specify loading, empty, error, offline and recovery states.
- Complete WCAG 2.2 AA keyboard/focus/contrast/assistive review.
- Add lazy loading, cache strategy and bundle/runtime budgets.
- Test slow networks, large data and dependency degradation.
- Add visual regression to valuable workflows.

### Phase 4 — Delivery and operations

- Signed desktop builds; updater validation; SBOM; crash reporting; beta/stable channels; per-release capability review.
- Add dashboards, alerts, runbooks and incident ownership.
- Exercise backup/restore, rollback and migration/dependency failure.
- Maintain a release checklist, versioning and change communication.

### Phase 5 — Advanced capability

- Prioritize proposals by customer value, risk, cost and differentiation.
- Release behind observable feature flags with kill switches.
- Review actual outcomes and update this dossier.

## Definition of production-ready

- No known critical/high exploitable security issue.
- Negative-path authorization and tenant-isolation tests pass.
- Reproducible install and clean required gates.
- Critical journeys pass in production-like staging.
- Error, latency, availability and saturation telemetry is actionable.
- Secrets stay outside source and rotation/revocation is documented.
- Data/config changes are compatible and reversible.
- Accessibility and performance budgets pass.
- Deploy, rollback, backup and incident procedures have owners.
- Documentation matches deployed behavior.

## Validation ledger

### 2026-08-24 initial audit

See `D:/ENGINEERING_WORKSPACE_MEMORY.md`. Revalidate findings before changing affected code. Record future commands exactly with date, branch, result and metrics.

## Implementation ledger

For every material change append: objective, files, decision/alternatives, security/data impact, test evidence, deployment/migration notes and remaining debt. A proposal is never recorded as implemented.

## End-to-end walkthrough template

1. Actor, role, tenant and prerequisites.
2. Entry point and UI/API sequence.
3. Expected state transitions.
4. Authorization checks and audit events.
5. Failure/offline/retry behavior.
6. Data created, retained and deleted.
7. Observability signals.
8. Automated coverage.

## Open decisions

- Product owner, users, supported platforms and SLA/commercial expectations.
- Cloud accounts, regions, domains, compliance and data residency.
- Identity provider, tenant model, roles and support impersonation.
- Launch order and permitted integration-test environments.
- Downtime, recovery objectives and operating budget.

## Next action

Execute Phase 0, then the immediate priorities before broad feature expansion.

## Change log

- 2026-08-24: Created living dossier from workspace-wide senior engineering audit.

## Rigorous second-pass review - 2026-08-25

### Scope control

Per explicit user instruction this repository remains proposal-only. No React, Rust, Tauri capability, Cargo, package, or test source was changed by this audit. The large pre-existing dirty tree was preserved.

### Current verdict

The architecture has real product potential and the frontend production build passed, but desktop release confidence is not established. The broad native capability surface, audio-thread correctness, crash recovery, device changes, and installer/update path carry more risk than the web build reveals.

### Verified baseline

- Frontend production build passed; the main JavaScript chunk was approximately 334 kB.
- Production dependency audit reported zero vulnerabilities.
- Lint could not run because its configured executable was unavailable.
- The earlier test run could not spawn workers; this is unresolved validation debt, not a pass.

### Proposed production plan

1. Reproduce Node and Rust installs from locks, then run frontend tests serially and all Rust tests.
2. Inventory and minimize Tauri capabilities command by command.
3. Split the large audio engine behind device, decoder, DSP, queue, and persistence contracts.
4. Test device hot-swap, corrupt media, unsupported codecs, sleep/resume, rapid seek, library rescan, and crash recovery.
5. Add signed installers, auto-update signature verification, rollback, crash reporting, and supported OS/audio-backend matrices.
6. Set audio underrun, latency, memory, CPU, library-scan, and startup budgets.

### Feature proposals

ReplayGain/loudness normalization, gapless playback, crossfade, smart playlists, portable library backup, room-correction calibration, plugin sandboxing, radio directory health, and privacy-local listening insights. AI DJ, VST, and spatial audio should stay behind capability flags until their failure isolation is proven.

### Go-live gate

No-go until lint/tests are reproducible, native capabilities are least-privilege, installers are signed, device/crash matrices pass, and updater rollback is exercised.
