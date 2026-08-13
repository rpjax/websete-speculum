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
| Session events | `Telemetry.Sessions.<subdomain>.*` | `Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived`, `Telemetry.Sessions.Capacity.SlotAcquired` |

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
{"events":{"Telemetry.Sessions.VideoStreamingInput.Applied":true,"Telemetry.Sessions.Resize.Applied":true}}
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
(`Capacity`, `Start`, `VideoStreamingInput`, `PageProjection`, `Resize`, …). Catalog gating still
applies — hot-path facts stay quiet until `Telemetry.Events` enables them.

**Planes must not share facts:** screencast mirror input uses
`Telemetry.Sessions.VideoStreamingInput.*`; PageProjection uses
`Telemetry.Sessions.PageProjection.Diff.*` and `Telemetry.Sessions.PageProjection.Input.*`
(payloads and hops are plane-specific).

| Plane | Path hops (opt-in) | Outcomes |
|-------|--------------------|----------|
| VideoStreamingInput | `DataPlaneReceived`, `ControlReceived`, `SidecarPushWritten`, `SidecarAdmitted` | `Applied`, `Rejected` |
| PageProjection Diff | `Diff.FrameReceived`, `Diff.QueueDropped`, `Diff.OutputStreamOpened`, `Diff.OutputStreamClosed`, `Diff.FanOutEnqueued`, `Diff.StreamDequeued`, `Diff.WireDelivered`, `Diff.GenerationBumped`, `Diff.ResyncRequested`, `Diff.ResyncServed` | recovery via OOB resync (Activity `client_desync` / `client_resync_*`) |
| PageProjection Input | `Input.DataPlaneReceived`, `Input.AdmissionDropped`, `Input.SidecarPushWritten`, `Input.SidecarAdmitted`, `Input.CdpDropped` | `Input.Applied` (gRPC push), `Input.Rejected` |

`Diff.GenerationBumped` (via `WatchPageProjectionLifecycle`) records when sidecar generation
identity changes: `main_frame_navigated` (contract path) or `page_emit_sync` (Node caught up
from a page emit with a different gen). `Diff.QueueDropped` uses the same lifecycle stream for
`sidecar_bridge` overflows and a connection notification for `api_sequenced` DropAll.
`Diff.FanOutEnqueued` fires after the Diff is accepted into an open Diff fan-out channel (`WaitMs`
= time blocked on that write; schema 3 adds `StreamId` / `ConsumerId` / `Kind` / `TargetIndex` /
`TargetCount` / `DiffChannelCount` / `DiffEpoch`). `Diff.StreamDequeued` fires when the hub Diff
pump takes the frame from that channel (`StreamId` / `ConsumerId` / `DiffEpoch`). `Diff.WireDelivered`
fires when the API finishes writing the Diff onto the client data-plane (`DurationMs` = write time;
schema 4 adds stream/consumer identity).
`Diff.OutputStreamOpened` / `Diff.OutputStreamClosed` record mux `Open*Stream` lifecycle
(`frame` | `pageProjectionDiff` | `console` | `notification`) — each registration opens **only**
that kind’s channel (Diff Wait exists only for `pageProjectionDiff`). When these hops are
catalog-disabled, emitters early-return before Stopwatch/Append (near-zero hot-path cost).
`FrameReceived` may include `SheetCount` / `RuleCount` / `SeededSheetCount` on Cssom install.
Correlate Diff hops by `sessionId` + `generation` + `sequence` (+ `streamId` / `consumerId` when present).

**Localizing a Diff stall (Beleza-style):** enable `OutputStreamOpened`, `FrameReceived`, `FanOutEnqueued`,
`StreamDequeued`, `WireDelivered`, `QueueDropped`. On a clean Live expect one `pageProjectionDiff`
`OutputStreamOpened` (plus frame/console/notification as opened). Each Diff sequence should produce
`FanOutEnqueued` × (open Diff streams only); only `pageProjectionDiff` should appear in
`StreamDequeued` / `WireDelivered`. If `QueueDropped` at `api_fanout_backpressure` appears on a
non-Diff kind, that is a regression (sparse registrations must not install Diff Wait on notification/
console/frame). If `FrameReceived` continues but `FanOutEnqueued` stops (then
`QueueDropped` / `fanout_write_budget_exceeded`), the fan-out channel write is blocked. If
`FanOutEnqueued` continues but `StreamDequeued` stops, the hub pump is not reading. If
`StreamDequeued` continues but `WireDelivered` stops or `DurationMs` is huge, the data-plane write
is blocked.

Sidecar path watches: `WatchVideoStreamingInputPath` / `WatchPageProjectionInputPath` (EventBridge
`videoStreamingInputPath` / `pageProjectionInputPath`). Product RPCs `PushInput` / `PushDomInput` are
unchanged. `Applied` means the API wrote the gRPC push — CDP success is `SidecarAdmitted`; CDP
drops are `CdpDropped` with a `reason`.

### Front observation (Lab + Live)

`Telemetry.ClientObservation` is **not** a Journal fact map. It enables the shared browser
Activity ring (capability toggles per plane). **Write only** via the Telemetry engine section
(`PUT /api/configurations/Telemetry` or the same section in `PUT /api/configurations` batch).
Projected to public client-config so Lab and Live share one read contract. Admin Configurations
→ Telemetry is the canonical toggle UI; Lab Config embeds the same fields as a shortcut.

Export Activity as JSONL and correlate with Journal hops via
`plane` / `hop` / `generation` / `sequence` / `kind` / `anchor` / `sessionId` / `tClient` /
`traceId` / `lagMs`.

| Toggle | Front hops |
|--------|------------|
| `IsEnabled` | Master — Activity / Live Observe |
| `SessionWire` | Hub lifecycle |
| `VideoStreamingInput` | `client_sent` on `sendInput` (every event while on) |
| `PageProjectionDiff` | Diff `client_recv` / `client_apply` / `client_drop` / `client_desync` / `client_resync_*` / `client_arm` / `client_disarm` (every frame while on) |
| `PageProjectionIntent` | `client_sent` on `sendPageProjectionIntent` (every event while on) |

`Telemetry.Events` (Journal facts) use the same Telemetry section PUT — dedicated per-fact
switches in Admin (catalog), not free-form type strings.

### Debug-only full capture

Path / Diff / front planes are **debug-only**. When a fact or ClientObservation plane is **off**,
emitters early-return (`IsTypeEnabled` / `observationAllowsPlane`) — near-zero cost on the hot
path. When **on**, capture is **full** for data-plane / Applied / Diff / front hops (every HF move,
every Diff patch, every Applied): the operator accepts cost. **`SidecarAdmitted` is the exception** —
VideoStreamingInput and PageProjection both skip high-frequency move samples on the admit hop
(`mousemove` / touch-move / `pointermove`), matching the sidecar path fan-out. Prefer Export JSONL
often; front ring keeps the newest 2000 entries (DropOldest).

Wire: every product send stamps MessagePack `traceId` (opaque client id) and, for video,
`clientTimestampMs`. Journal path/outcome facts include `TraceId` / `ClientTimestampMs` when
present (schemaVersion **2**). PageProjection Diff `FrameReceived` includes sidecar `Timestamp`
and optional Cssom install counts. PageProjection Intent path includes `SidecarAdmitted` /
`CdpDropped` via `WatchPageProjectionInputPath` (mirror of VideoStreamingInput).

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

## PageEpoch story + liquid load

`PageProjection.{Virtual,Establish,Asset}` facts are keyed by **`pageEpochId`** — one Virtual
navigation identity minted on hard navigation and on SoftNav (never on Diff-only churn; see
`docs/page-projection/spec/acceptance.md`). They exist to separate two costs that used to be conflated
in a single "time to first paint" number:

- **`bootMs`** (`Virtual.BootMarked`) — Chromium process launch → first commit. This is sidecar/
  browser boot, not site load. It happens once per sidecar session (or per faulted-session
  restart), not once per navigation. **Never mix `bootMs` into a site-load verdict.**
- **`tSinceCommitMs`** (`Establish.FirstDiffEmitted`, `Establish.EstablishCompleted`,
  `Virtual.Lifecycle`) — wall time from `Virtual.NavCommit` for *this* `pageEpochId` to a
  downstream milestone. This is the "liquid load" number that matters for parity: how long after
  the real navigation commit does the Projected surface become usable.

`Virtual.NavCommit` carries `generation` (the Diff-plane epoch) and `documentEpoch` alongside
`pageEpochId`, so Virtual/Establish/Asset facts can be correlated with `PageProjection.Diff.*`
facts and front `client_*` hops (which are still `generation`-keyed only — `pageEpochId` is not on
the Diff wire).

| Subdomain | Facts | Keyed by |
|-----------|-------|----------|
| `Virtual` | `BootMarked`, `NavCommit`, `NavTiming`, `ResourceSummary`, `PageError`, `Lifecycle` | `pageEpochId` (`BootMarked.pageEpochId` optional — boot can precede the first commit) |
| `Establish` | `StylesWaitStarted/Completed`, `DomMapStarted/Completed`, `CssomInstallStarted/Completed`, `FirstDiffEmitted`, `EstablishCompleted`, `EstablishFailed` | `pageEpochId` |
| `Asset` | `RewriteSummary`, `FetchFinished` (per epoch); `ServeMiss`, `ServeSlow` (global — the DomAsset proxy has no epoch identity) | mixed |

`Establish.EstablishFailed` always carries `errorCode` + `phase` (never published bare, per the
catalogued-failure hard ban). `EstablishCompleted`/`EstablishFailed` are the epoch's terminal
facts — SoftNav epochs may legitimately have neither if establish was skipped for that nav type.

### ParityDebug pack

`TELEMETRY_PARITY_DEBUG_TYPES` (`web/src/features/admin/configurations/telemetrySessionEventsCatalog.ts`)
bundles every fact needed to build a PageEpoch story in one toggle: the full `PageProjection.Diff`
chronology (`FrameReceived` … `WireDelivered`, `QueueDropped`, `SoftNavObserved`,
`GenerationBumped`, `Resync*`), the `PageProjection.Input` path plus `ScrollEchoHit`,
`Browse.LocationChanged`, and every `Virtual` / `Establish` / `Asset` fact. Admin Configurations →
Telemetry exposes it as the **ParityDebug pack** button (mirrors the existing **Trace video path**
shortcut) — it enables the set and expands the affected groups in place.

Client-side, enable `Telemetry.ClientObservation.pageProjectionDiff` to get the matching front
hops: `client_arm` (kept for back-compat) plus the new `client_epoch_arm` (same fields; carries
`generation` and, once the Diff wire gains it, `pageEpochId`), and a periodic
**`client_surface_probe`** (~every 5s while the projector is live and armed) reporting `htmlLen`,
`ownedRules`, `imgCount`, `brokenImgs`, `brokenImgsInViewport`, `armed`, `lastSequence`, and an
approximate `lagMsP50` over recently-applied Diffs.

### Recipe: build a PageEpoch story

1. **Lab Reset** the target session (clean slate — no stale Journal/front rows from a prior run).
2. Enable the **ParityDebug pack** (Admin Configurations → Telemetry, or Lab's Telemetry shortcut)
   and turn on `Telemetry.ClientObservation.pageProjectionDiff`.
3. Drive the navigation(s) under test (hopdiag / smoke script), then export the Journal
   (`journal-export.json`) and the front Activity ring (`front-activity.jsonl`).
4. Build the story:

   ```bash
   node Refactor/deploy/tmp-telemetry-run/build-page-epoch-story.cjs \
     journal-export.json front-activity.jsonl page-epoch-story.json
   ```

   or via env: `JOURNAL=journal-export.json FRONT=front-activity.jsonl OUT=page-epoch-story.json`.

The output is one story object per `pageEpochId` (Virtual/Establish/Asset facts, Diff counters,
front `client_*` correlation, and `timings.bootMs` / `timings.tSinceCommit*Ms`), plus
`verdictHints` such as `virtual_ttfb_high`, `establish_dom_map_gt_2s`, `oob_dom_map_dominant`,
`establish_cssom_install_slow`, `establish_styles_wait_timed_out`, `establish_failed`,
`establish_missing` (NavCommit with no terminal Establish fact on a non-soft nav),
`diff_queue_dropped_without_resync`, `client_broken_imgs_present`, and `asset_fetch_failures`.

`analyze-pipehop.cjs` and `diagnose-smoke.cjs` both build this story inline and **fail the run**
(non-zero exit) when the ParityDebug pack was on (any `Virtual.NavCommit` or `Establish.*` fact
present) but the story is incomplete for a non-soft-nav epoch — missing `NavCommit`, or neither
`EstablishCompleted` nor `EstablishFailed`. A green protocol diagnose with an incomplete PageEpoch
story is not accept; see `docs/page-projection/spec/acceptance.md`.
