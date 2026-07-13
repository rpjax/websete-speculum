# Diagnostics (assertable observability)

Phase 2 control plane for telemetry, debug, and Phase 3 Act→Assert contracts.

Schema version: **`diagnosticsSchemaVersion: 1`**.

## Concepts

| Type | Meaning |
|------|---------|
| Metric | Low-cost gauge/counter |
| Event | Immutable timeline fact |
| Snapshot | Aggregated FSM/session state |
| Probe | On-demand interrogation (`diagProbe`) |
| Signal | Metric \| Event \| Snapshot \| Probe |

Domains: `MotorLive`, `SidecarBrowser`, `BrowserQuery`, `PersistedSessions`, `HostResources`, `DiagnosticsSelf`.

Levels (totally ordered): `Off < Metrics < Events < StateSnapshots < BrowserQuery`.

Config section: **`Diagnostics`** (dynamic SQLite; first-boot seed Development / Production / `SPECULUM_DIAGNOSTICS_PROFILE=Assertive`). Elevate is a TTL overlay and does not rewrite the section.

REST base: **`/api/admin/diagnostics/v1`** (Bearer admin).

Response wrappers (raw HTTP — client `diagnosticsApi` unwraps where noted):

| Path | Body |
|------|------|
| `GET /sessions/{id}` | `{ snapshot, redaction }` |
| `GET /persisted/{id}` | `{ detail, redaction }` |
| `GET /host` | `{ data, redaction }` |
| `GET /sessions/{id}/events` | event array (each item includes `redaction`) |
| `GET /events?since=&namePrefix=&connectionId=` | global timeline (Drain / DiagnosticsSelf; optional `connectionId` filter) |

Catalog Act→Assert events are **never** randomly sampled away. `StatusMirrorRatio` / `expensiveEventRatio` only throttle noisy `Motor.StatusMirrored` (ring-only). Catalog Motor/Sidecar/Diagnostics events also use a Metrics publish floor so Prod (`SidecarBrowser=Metrics`) and `DiagnosticsDegraded` caps do not erase Act→Assert timelines.

## Assert Cookbook (Phase 3 input)

Each recipe: Act → poll events with `?since=` / `namePrefix=` → assert snapshot / errorCode.

### 1. Session lifecycle

1. Act: SignalR `StartSessionAsync` with `identity.correlationId` (client Act id) — same id is stored on the session and emitted on `Motor.SessionStarted`.
2. Assert: `GET /sessions/{connectionId}/events?namePrefix=Motor.Session` contains `Motor.SessionStarted` with that `correlationId`.
3. Assert: `GET /sessions/{connectionId}` → `{ snapshot.phase: "Running", ... }`.
4. Act: disconnect / stop (Stop Act generates a **new** `correlationId` on `Motor.SessionStopping` / `Motor.SessionStopped`).
5. Assert: `Motor.SessionStopped` with the Stop Act `correlationId`; `GET /sessions/{connectionId}` → `404` `{ "errorCode": "session_gone" }`; `POST .../browser` → `session_gone`.

### 2. Resource release

1. While Running: `POST .../browser` with `ops: ["process","resources"]` — note PIDs.
2. After stop: browser POST returns `session_gone`.
3. Assert: `GET /sessions` counts decreased; prefer sidecar `session_gone` + registry over host PID alone.

### 3. Navigate allowlist

1. Act: navigate to a URL outside Forwarding allowlist.
2. Assert: `Motor.NavigateRejected`; snapshot `lastNavigateResult: rejected`; `currentUrl` unchanged from prior.

> `Motor.NavigateCompleted` means the navigate **command** was accepted by the motor/sidecar path (allowlist + wire send), not that the remote document finished loading.

### 4. Persistence

1. Act: stop session that exports state → `Motor.StateExportCompleted` (always recorded; not sampled).
2. Assert: `GET /persisted/{sessionId}` → `{ detail… }` (level ≥ `StateSnapshots`).
3. Act: start new session with same client token → restore.
4. Assert: `BrowserQuery` probe `cookies` / `evaluate` sees restored truth.

### 5. Governance

1. PUT tiny `storage.maxBytes` → force overflow → assert `Diagnostics.StorageOverflow` via `GET /events?namePrefix=Diagnostics.Storage` **and/or** `GET /runtime` → `overflowCount`.
2. Enable `domains.browserQuery: BrowserQuery` → probe ops `cookies` OK.
3. Set BrowserQuery `Off` → probe returns `403` `{ "errorCode": "probe_level_insufficient" }`.
4. Concurrent probes beyond `maxConcurrentProbesPerSession` → `429` `{ "errorCode": "probe_busy" }`.
5. Probe response exceeding `maxProbeResponseBytes` → `errorCode: response_too_large`.
6. PUT elevate → assert `GET /events?namePrefix=Diagnostics.Elevate` includes `ElevateStarted`; TTL/DELETE → `ElevateExpired`.

### 6. Redaction

1. Same GET session/persisted/probe on Development host → plain identity (`redaction: none`).
2. Production host → masked identities/secrets (`redaction: production`); metrics/PIDs remain readable.

## Stable event catalog

See `GET /catalog/events` and `DiagnosticsEventCatalog` (Motor.*, Sidecar.Diag*, Diagnostics.*).

## Motor snapshot minimum

Ids, FSM phase, timing, fps/frames, navigation result, sidecar connected/fault, export flag, config fingerprint, channel depths / inputQueueApprox.

## Sidecar probes

Wire: `diagProbe` / `diagResult`. Ops: `process`, `tabs`, `export`, `cookies`, `storage`, `dom`, `evaluate`, `resources`. Soft-cap via `maxProbeResponseBytes` (default 512 KiB, absolute wire ceiling 8 MiB).
