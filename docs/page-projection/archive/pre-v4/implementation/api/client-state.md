# Implementation — ClientState hub method (API)

**Future path:** `Refactor/Speculum.Api/Presentation/Sessions/` (Session hub) + rate-policy consumer in Sessions domain  
**Contracts:** [10-interaction.md](../../contracts/10-interaction.md), [13-admission.md](../../contracts/13-admission.md)  
**Norm:** redesign §5.9.5, §5.3.5  
**Web peer:** [../web/clientState.md](../web/clientState.md)

---

## Purpose

Accept `PageProjectionClientState` from the Projected client over the Sessions hub **control** channel. Feed visibility, apply overrun, and queue depth into the **rate / admission policy**. MUST NOT affect frame `sequence`.

---

## Invariants

1. Hub method accepts the full ClientState DTO; missing properties **fail** (no soft-skip).
2. Control message: does not allocate or advance live `sequence`.
3. `visibility: hidden` collapses target rate toward `hiddenRateHz` (default 1) for that session (PP-LOAD-4).
4. Elevated `overrunCount` / high `applyP95Ms` / large `queuedFrames` contribute to degrade ladder (**frame rate first**) — never to desync (PP-LOAD-1).
5. Rate changes emit `Frame.RateChanged` telemetry (frame-unit facts).
6. Session-scoped; no cross-session ClientState bleed (K2).

---

## Bans

- Using ClientState as proof of parity / accept.
- Desync on overrun or hidden.
- `QueueDropped` as load shedding in response to ClientState.
- Ignoring `hidden` until the next periodic aggregate.

---

## Signatures (C#)

```csharp
[MessagePackObject]
public sealed class PageProjectionClientState
{
    [Key("visibility")] public string Visibility { get; set; } = "visible"; // "visible" | "hidden"
    [Key("appliedThroughSequence")] public uint AppliedThroughSequence { get; set; }
    [Key("queuedFrames")] public ushort QueuedFrames { get; set; }
    [Key("applyP50Ms")] public float ApplyP50Ms { get; set; }
    [Key("applyP95Ms")] public float ApplyP95Ms { get; set; }
    [Key("overrunCount")] public uint OverrunCount { get; set; }
}

public interface IPageProjectionRatePolicy
{
    /// <summary>Ingest client control sample; may adjust frameRateHz for the session.</summary>
    void OnClientState(Guid sessionId, PageProjectionClientState state);

    /// <summary>Current target Hz for sidecar clock message.</summary>
    int GetTargetFrameRateHz(Guid sessionId);
}

// Hub
// Task PageProjectionClientState(PageProjectionClientState state);
```

Validation: `Visibility` must be exactly `visible` or `hidden`; otherwise reject with 4xx / hub fault carrying `errorCode`+`phase` if catalogued.

---

## Algorithm — ingest → rate policy

```
OnClientState(sessionId, state):
  1. Bind hub connection → sessionId (existing auth)
  2. Validate DTO (all fields present; visibility enum)
  3. Store last ClientState on session runtime
  4. EvaluateRate(sessionId):
       base = configured frameRateHz / current ladder step
       if state.Visibility == "hidden":
         target = min(target, hiddenRateHz)
       if state.OverrunCount > 0 OR state.ApplyP95Ms > applyBudgetMs OR state.QueuedFrames high:
         consider step down ladder (60→30→15→5) subject to hysteresis
       recover upward at most one step per rateRecoverMs if signals clear
  5. if target changed:
       send rate message to sidecar for session
       emit Frame.RateChanged { from, to, reason }
  6. Return ack (optional)
```

Thresholds for “queuedFrames high” / overrun sensitivity are config-calibrated by O4 later; implementation MUST wire the **signals** now with conservative defaults documented in config.md notes — do not invent desync.

`AppliedThroughSequence` is informational for ops/telemetry aggregates; not a server-side ACID cursor.

---

## Coupling

| Input | Effect |
|-------|--------|
| ClientState | rate ladder, hidden rate |
| Host CPU/memory/pool | admission (contract 13) |
| Emit-path congestion | rate (sidecar signal) |

All three feed the same policy object; ClientState is necessary but not sufficient.

---

## Tests

| ID | Assert |
|----|--------|
| `PP-LOAD-4` | hidden → `hiddenRateHz`; visible resume without desync |
| `PP-LOAD-1` | overrun/congestion → rate down, no desync |
| `PP-LOAD-2` | no QueueDropped used as shedding |
| Shape | Reject incomplete DTO (missing property) |
| Sequence | After ClientState, live sequence continuum unchanged |
| Fact | Rate transition emits `Frame.RateChanged` with catalog shape |
