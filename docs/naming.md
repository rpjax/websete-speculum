# Naming guide — (Websete) Speculum

This document defines vocabulary and naming rules for the API and sidecar codebases.

> Broader mandatory engineering law (architecture, tests, CI, anti-patterns): **[engineering-standards.md](engineering-standards.md)**. Agents start at [../AGENTS.md](../AGENTS.md).

## Product vocabulary

| Term | Use when | Examples |
|------|----------|----------|
| **Speculum** | Platform, config, infrastructure, docs | `ConfigService`, `ISpeculumConfigStore`, `SpeculumRuntimeConfig` |
| **Sessions** | Live remote browsing (control, transport, URL mapping) | `SessionHub`, `LiveSession`, `UrlResolver` |
| **W7S** | **Wire/client boundary only** | `_w7s_nso`, `docs/w7s-sidecar-protocol.md` |
| **Browser persistence** | Chrome state in SQLite (not live relay) | `BrowserSessionStore`, `BrowserPersistence/` |
| **Sidecar** | Node process hosting Chrome | `SidecarClient`, `sidecar/` |
| **Edge** | Traefik, TLS, CORS | `EdgeSynchronizer`, `TraefikYamlBuilder` |
| **Diagnostics** | Assertable observability (events, probes, governance) | `IDiagnosticsRuntime`, `/api/admin/diagnostics/v1` |
| **Journal** | Operational fact log (admission + durable drain); not event-sourcing; not Diagnostics capabilities | `IJournalWriter`, `JournalEntry`, `PublishPolicy` |
| **Telemetry** | Observability module: **event** hops/infra facts + **sampling** composites; not Sessions domain narrative | `Telemetry.Sessions.Input.*`, `Telemetry.Sampling.SampleCollected`, `ISessionTelemetryEventsFactory` |
| **Database** | Unified Speculum SQLite store for the API | `SpeculumDbContext`, `AddDatabase`, `EnsureDatabase`, `DatabaseOptions` |

**W7S must not appear** in C# namespaces, internal class names, application logs, or API folder names.

**Motor is legacy vocabulary.** It remains only where an existing artifact
still has that proper name (for example `MotorHub`,
`Speculum.MotorAssert.Tests`, or `web/src/features/motor/`). Do not introduce
`Motor` in new domain types, folders, diagnostics domains, configuration, or
client APIs. Structural migrations replace those identifiers with
`Session`/`Sessions`; no compatibility aliases are added during V1.

## Code readability rules

1. **File name = primary type** — `SessionCoordinator.cs` contains `SessionCoordinator`.
2. **No cryptic prefixes** — no `VSession`, no generic `Mgr` / `Svc` / `Helper`.
3. **Explicit verbs** — `DrainActiveSessionsAsync`, `SynchronizeEdgeConfigAsync`.
4. **One question per folder** — `Sessions/` owns live-session behavior; `Presentation/Sessions/` owns its transport edge.
5. **Rename with structural moves** — never a PR that only renames symbols.
6. **Interfaces name a capability** — `ILiveSession`, not `ISessionManager`.

## Live vs persisted session

| Concept | API type | Sidecar type |
|---------|----------|--------------|
| Live relay (control + WebTransport) | `LiveSession` | — |
| Chrome instance on server | — | `BrowserSession` |
| Persisted browser state (SQLite) | `BrowserSessionStore` | — |

## Diagnostics vocabulary (config vs runtime)

Split the operator input from the resolved state:

| Concept | Name | Where |
|---------|------|-------|
| Operator input (what you turn on) | **toggles**, named by capability (`metrics`/`events`/`snapshots`/`probe`) | `DiagnosticsDomainsOptions` + `DiagnosticsTelemetryOptions` config |
| Resolved state (after degraded/elevate) | **capabilities** → `IsCapabilityEnabled(...)`, `EffectiveCapabilities` | `IDiagnosticsRuntime` |
| Event metadata (kind of signal) | `DiagnosticsCapability { Metric, Event, Snapshot, Probe }` | catalog descriptor |

Type families:

- Transport (no rename): `IDiagnosticsEventBus` / `DiagnosticsEventBus` — **domain-agnostic**; gates only by descriptor + settings.
- Catalog: `DiagnosticsEventDescriptor { Name, Domain, Capability, Persist, SpanRole, SpanKey, SpanTimeoutSec }` + `DiagnosticsEventCatalog`. Span pairing is descriptor-driven (`SpanRole` `Open`/`Close`/`None`, keyed by `SpanKey`).
- Producers: `ISidecarDiagnosticsEmitter`, `IDiagnosticsSelfEmitter`, `ITelemetryEmitter` keep the `Emitter` suffix. Sessions use a context-bound producer handle so callsites emit without repeatedly passing session context/ids. Legacy types (`IMotorEventsFactory`, `IMotorEvents`, `MotorEvents`) retain their names until structurally migrated.
- Telemetry pull: `ITelemetrySource` (+ host/API process/sessions/sidecar/persistence/pipeline sources), composed by `ITelemetrySampleComposer`; sampled by `TelemetrySamplerHostedService`; collectors `MachineResourceProbe` + `ApiProcessResourceProbe` (also exposed as probe providers `host-resources` / `api-process-resources`).
- Payload DTOs use camelCase records. New session telemetry names use `Session`/`Sessions`; existing `MotorTelemetry` is a legacy identifier until its structural migration.
- Options family: `DiagnosticsDomainsOptions`, `DiagnosticsTelemetryOptions`, presets in `DiagnosticsSeedProfiles`; `Profile` (not `DefaultLevel`) names the seed preset.

## Web client folders

The legacy React app still uses historical Motor folders:

| Folder | Question it answers |
|--------|---------------------|
| `web/src/features/motor/live/` | How does the live SignalR session work in the browser? |
| `web/src/features/motor/mapping/` | How does the client sync its address bar (not server HostMapper)? |

New browser libraries use `Refactor/Speculum.Api/wwwroot/speculum/`; their
public types use `SessionClient` and `LiveSession`. W7S remains wire/UI boundary
only (e.g. `_w7s_nso`, setup copy). Do not invent parallel virtualization
vocabulary.

## Dependency direction

```
Transport (Hub, Admin endpoints)
    → Application (Coordinator, ConfigService, EdgeSynchronizer)
        → Domain (HostMapper, TraefikYamlBuilder, SidecarWireProtocol)
            → Infrastructure (SQLite, WebSocket, filesystem)
```

Domain types must not reference ASP.NET, SignalR, or `IServiceProvider`.

## Stable public contracts (do not rename)

- REST `/api/admin/config/{section}`
- REST `/api/admin/diagnostics/v1/*` (`diagnosticsSchemaVersion`)
- SignalR hub route `/vhub` and hub method names
- W7S query param `_w7s_nso`
- Sidecar WS message types `create` / `ready` / `error` / `diagProbe` / `diagResult` and binary opcodes `0x04`–`0x0A`

## V1.0.0 development policy

- **Not released:** no semver tags or release branches until launch is announced.
- **No backward compatibility:** do not add migration shims, config key aliases, or “deprecated” API paths unless explicitly requested for a post-launch scenario.
- **Config section keys:** SQLite and Admin API use PascalCase literals only (`SessionPolicy`, not `SnapshotPolicy`).
