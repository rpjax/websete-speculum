# Refactor Telemetry

The Refactor Telemetry runtime is an independent API module under
`Refactor/Speculum.Api/Telemetry`. It owns two kinds of Journal facts:

1. **Events** — hop/infra observations (capacity, URL resolve, input path, resize, …)
2. **Sampling** — periodic composite resource snapshots

Domain narrative facts (`Sessions.SessionStarted`, navigate outcomes, …) stay under Sessions /
Profiles and are emitted by `ISession*Events` / `IProfileEvents`. Sessions depends on Telemetry
to emit event facts; Telemetry depends only on Journal plus abstract sample ports (adapters live
in Sessions / Profiles / BrowserClients).

Telemetry does not use the Diagnostics runtime, capability model, or Diagnostics event bus.

## Catalog type strings

| Kind | Pattern | Examples |
|------|---------|----------|
| Sampling | `Telemetry.Sampling.*` | `Telemetry.Sampling.SampleCollected`, `Telemetry.Sampling.SessionSampleCollected` |
| Session events | `Telemetry.Sessions.<subdomain>.*` | `Telemetry.Sessions.Input.WebTransportReceived`, `Telemetry.Sessions.Capacity.SlotAcquired` |

All `Telemetry.*` types are **Telemetry-owned**: they must not appear in the Journal `events` map
(PUT Journal rejects them). Enablement is driven by the `Telemetry` config section on Apply.

## Configuration Apply → Journal enablement

`Telemetry` is an engine config section (`PUT /api/configurations/Telemetry`). On Apply:

| Toggle | Journal fact |
|--------|----------------|
| `IsEnabled` | `Telemetry.Sampling.SampleCollected` |
| `IsEnabled` ∧ `Sessions.IncludePerSession` | `Telemetry.Sampling.SessionSampleCollected` |
| `Events["Telemetry.Sessions.…"] = true` | That event fact (default **off**) |

### Enabling in tests / dockup

Sampling:

```http
PUT /api/configurations/Telemetry
{"isEnabled":true,"intervalSeconds":15,"sessions":{"isEnabled":true,"includePerSession":false}}
```

Event facts (input / resize probes for SessionsTest):

```http
PUT /api/configurations/Telemetry
{"events":{"Telemetry.Sessions.Input.Applied":true,"Telemetry.Sessions.Resize.Applied":true}}
```

Partial Telemetry PUTs **merge** onto the stored section (sampling toggles and `host.procPath`
from first-boot env are preserved). When the body includes `events`, that map **replaces** the
stored event toggles wholesale (so seeds/Lab can deterministically enable a set of facts).

Or first-boot / env overlay (merged into SQLite when `IsFirstBoot`):

```text
Telemetry__IsEnabled=true
Telemetry__IntervalSeconds=15
Telemetry__Host__ProcPath=/host/proc
Telemetry__Docker__Endpoint=unix:///var/run/docker.sock
```

## Runtime flow

### Sampling

`TelemetrySamplerHostedService` reads the current applied
`EngineConfiguration.Telemetry` section. When `IsEnabled` is false it performs no collection and
checks again after ten seconds. When enabled, it collects only enabled sections at the configured
interval and calls `IJournalWriter.Append`.

`Telemetry.IntervalSeconds` uses one contract everywhere: accepted range `1..3600`, validated on
Apply and applied by the sampler with that same effective limit.

The composite fact is `Telemetry.Sampling.SampleCollected` (schema version 1). If per-session
sampling is enabled, the emitter also appends one indexed
`Telemetry.Sampling.SessionSampleCollected` fact for each live session.

Sample sources use Telemetry ports (`ISessionTelemetrySampleSource`,
`IProfileTelemetrySampleSource`, `ISidecarTelemetrySampleSource`); domain adapters implement them.

### Events

Sessions call `ISessionTelemetryEventsFactory.ForSession(…)` and emit through subdomain contracts
(`Capacity`, `Start`, `Input`, `Resize`, …). Catalog gating still applies — hot-path facts stay
quiet until `Telemetry.Events` enables them.

## Sections (sampling)

- `Host`: machine CPU, memory, disk, load, swap, disk I/O, and network data from procfs.
- `ApiProcess`: Speculum.Api process and CLR resource data.
- `Sessions`: live-session counts, configured capacity, optional identifiers, status, and real FPS
  computed from relay-observed video frames.
- `Sidecar`: process, event-loop, Chrome, queue, and session-summary data.
- `Profiles`: profile count and optional unified SQLite file size.
- `Journal`: admission queue depth, drops, health, and optional pressure details.
- `Docker`: Docker runtime information and container resource snapshots.

Every section has its own `IsEnabled` toggle under the `Telemetry` configuration section. Optional
or unavailable sections are recorded as `null`; source failures do not suppress the other sections.
For `Docker`, failures are also logged with a concrete phase such as `endpoint_parse`,
`socket_connect`, `docker_info`, `docker_containers`, `docker_container_stats`, or `timeout`.

## Sidecar collection

The API calls the process-wide `CollectTelemetry` unary RPC. Its request carries independent
toggles for process, event-loop, Chrome, queues, session summary, and faulted session identifiers.
The sidecar omits response sections whose toggles are false. This RPC is not scoped to a live
session and is handled outside normal browser operations.

`sidecar.queues.inputDepth` is the current number of admitted input operations still in flight
inside the sidecar (coalesced pending move/touch flushes plus serialized inject work).
`sidecar.queues.inputChainDepth` isolates just the serialized inject chain backlog.
`sidecar.queues.droppedTotal` is the cumulative DropOldest loss across bounded sidecar fan-out queues.

`sidecar.allocations.summary` aggregates display/input footprint across registered sessions
(allocated session count, open/faulted counts, display pixels, input backend mix).
`sidecar.allocations.sessions` is opt-in per-session allocation rows (same scalar fields as the
session telemetry snapshot). Enable via `IncludeAllocationSessions` on the CollectTelemetry request.

Sidecar allocation lifecycle events (`Telemetry.Sessions.Sidecar.*`) are opt-in Journal facts
emitted from `WatchAllocationLifecycle` when enabled in `Telemetry.Events` — never on input/frame
hot paths.

For host and Docker visibility in containers, mount host procfs read-only at `/host/proc` and the
Docker socket read-only at `/var/run/docker.sock`, then configure:

```text
Telemetry__Host__ProcPath=/host/proc
Telemetry__Docker__Endpoint=unix:///var/run/docker.sock
```
