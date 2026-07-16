# Naming guide — (Websete) Speculum

This document defines vocabulary and naming rules for the API and sidecar codebases.

> Broader mandatory engineering law (architecture, tests, CI, anti-patterns): **[engineering-standards.md](engineering-standards.md)**. Agents start at [../AGENTS.md](../AGENTS.md).

## Product vocabulary

| Term | Use when | Examples |
|------|----------|----------|
| **Speculum** | Platform, config, infrastructure, docs | `ConfigService`, `ISpeculumConfigStore`, `SpeculumRuntimeConfig` |
| **Motor** | Live remote browsing (hub, relay session, URL mapping) | `MotorHub`, `MotorSession`, `MotorUrlAdapter` |
| **W7S** | **Wire/client boundary only** | `_w7s_nso`, `docs/w7s-sidecar-protocol.md` |
| **Browser persistence** | Chrome state in SQLite (not live relay) | `BrowserSessionStore`, `BrowserPersistence/` |
| **Sidecar** | Node process hosting Chrome | `SidecarClient`, `sidecar/` |
| **Edge** | Traefik, TLS, CORS | `EdgeSynchronizer`, `TraefikYamlBuilder` |
| **Diagnostics** | Assertable observability (events, probes, governance) | `IDiagnosticsRuntime`, `/api/admin/diagnostics/v1` |

**W7S must not appear** in C# namespaces, internal class names, application logs, or API folder names.

## Code readability rules

1. **File name = primary type** — `MotorSessionCoordinator.cs` contains `MotorSessionCoordinator`.
2. **No cryptic prefixes** — no `VSession`, no generic `Mgr` / `Svc` / `Helper`.
3. **Explicit verbs** — `DrainActiveMotorSessionsAsync`, `SynchronizeEdgeConfigAsync`.
4. **One question per folder** — `Motor/Mapping/` answers “how do URLs map?”; `Motor/Live/` answers “how does a live session work?”
5. **Rename with structural moves** — never a PR that only renames symbols.
6. **Interfaces name a capability** — `IMotorSession`, not `ISessionManager`.

## Live vs persisted session

| Concept | API type | Sidecar type |
|---------|----------|--------------|
| Live relay (SignalR ↔ WS) | `MotorSession` | — |
| Chrome instance on server | — | `RemoteBrowserSession` |
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
- Producers: `ISidecarDiagnosticsEmitter`, `IDiagnosticsSelfEmitter`, `ITelemetryEmitter` keep the `Emitter` suffix. **Motor** uses a context-bound producer handle instead — `IMotorEventsFactory` mints an `IMotorEvents` (impl `MotorEvents`) bound to a session/operation, so callsites emit without passing context/ids. The `Diagnostics` token appears only when the type lives **outside** the `Diagnostics.*` namespace (Motor).
- Telemetry pull: `ITelemetrySource` (+ `Host`/`ApiProcess`/`Motor`/`Sidecar`/`Persistence`/`Pipeline` sources), composed by `ITelemetrySampleComposer`; sampled by `TelemetrySamplerHostedService`; collectors `MachineResourceProbe` + `ApiProcessResourceProbe` (also exposed as probe providers `host-resources` / `api-process-resources`).
- Payload DTOs (camelCase records): `TelemetrySample` (root) + `HostTelemetry`/`ApiProcessTelemetry`/`MotorTelemetry`/`SidecarTelemetry`/`PersistenceTelemetry`/`PipelineTelemetry`.
- Options family: `DiagnosticsDomainsOptions`, `DiagnosticsTelemetryOptions`, presets in `DiagnosticsSeedProfiles`; `Profile` (not `DefaultLevel`) names the seed preset.

## Web client folders

The React app mirrors the same Motor domains:

| Folder | Question it answers |
|--------|---------------------|
| `web/src/features/motor/live/` | How does the live SignalR session work in the browser? |
| `web/src/features/motor/mapping/` | How does the client sync its address bar (not server HostMapper)? |

W7S remains wire/UI boundary only (e.g. `_w7s_nso`, setup copy). Do not invent parallel virtualization vocabulary in `web/`.

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
