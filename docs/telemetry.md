# Refactor Telemetry

The Refactor Telemetry runtime is an independent API module under
`Refactor/Speculum.Api/Telemetry`. It periodically composes operational resource samples and
publishes them as Journal facts. It does not use the Diagnostics runtime, capability model, or
Diagnostics event bus.

## Configuration Apply → Journal enablement

`Telemetry` is an engine config section (`PUT /api/configurations/Telemetry`). On Apply:

| Toggle | Journal fact |
|--------|----------------|
| `IsEnabled` | `Telemetry.SampleCollected` |
| `IsEnabled` ∧ `Sessions.IncludePerSession` | `Telemetry.SessionSampleCollected` |

Those fact types are **Telemetry-owned**: they must not appear in the Journal `events` map
(PUT Journal rejects them). Sampler still no-ops when `IsEnabled` is false; when true, Append
succeeds because Apply already enabled the catalog entries.

### Enabling in tests / dockup

Explicit Apply (same pattern as Sessions Journal seed):

```http
PUT /api/configurations/Telemetry
{"isEnabled":true,"intervalSeconds":15,"sessions":{"isEnabled":true,"includePerSession":false}}
```

Or first-boot / env overlay (merged into SQLite when `IsFirstBoot`):

```text
Telemetry__IsEnabled=true
Telemetry__IntervalSeconds=15
Telemetry__Host__ProcPath=/host/proc
Telemetry__Docker__Endpoint=unix:///var/run/docker.sock
```

## Runtime flow

`TelemetrySamplerHostedService` reads the current applied
`EngineConfiguration.Telemetry` section. When `IsEnabled` is false it performs no collection and
checks again after ten seconds. When enabled, it collects only enabled sections at the configured
interval and calls `IJournalWriter.Append`.

`Telemetry.IntervalSeconds` uses one contract everywhere: accepted range `1..3600`, validated on
Apply and applied by the sampler with that same effective limit.

The composite fact is `Telemetry.SampleCollected` (schema version 1). If per-session sampling is
enabled, the emitter also appends one indexed `Telemetry.SessionSampleCollected` fact for each live
session.

## Sections

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
inside the sidecar. `sidecar.queues.droppedTotal` is the cumulative DropOldest loss across bounded
sidecar fan-out queues.

For host and Docker visibility in containers, mount host procfs read-only at `/host/proc` and the
Docker socket read-only at `/var/run/docker.sock`, then configure:

```text
Telemetry__Host__ProcPath=/host/proc
Telemetry__Docker__Endpoint=unix:///var/run/docker.sock
```
