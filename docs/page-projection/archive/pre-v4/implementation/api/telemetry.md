# Implementation — PageProjection telemetry (API)

**Future path:** `Speculum.Api/` Diagnostics / Sessions telemetry emitters for PageProjection  
**Contracts:** [14-telemetry.md](../../contracts/14-telemetry.md), [16-errors.md](../../contracts/16-errors.md)  
**Norm:** redesign §5.15; engineering-standards failure shape  
**Catalog prefix:** `Telemetry.Sessions.PageProjection.*`

---

## Purpose

Emit **frame-unit** (and establish/session lifecycle) facts for PageProjection. Hold default volume to budget **E8** (≤ 50 facts per load per session by design). Disabled / ParityDebug emitters **early-return before any allocation**. Every catalogued **failure** carries `errorCode` + `phase` (PP-TEL-2).

---

## Invariants

1. Default unit of coalesce/sequence/wire/apply telemetry is the **frame**, not MutationRecord/op.
2. Dom and Cssom MUST NOT share fact types.
3. Default-on set is exactly the catalog below (plus periodic aggregate).
4. Per-frame / per-op facts exist **only** under ParityDebug capability toggle.
5. `IsCapabilityEnabled(descriptor)` gate — transport stays domain-agnostic; never hardcode string-match of unrelated domains in the transport.
6. Failures: `errorCode` + `phase` required; no publish without both.
7. PageEpoch story machinery retained; unit is frame.

---

## Bans

- Per-op Journal spam on the hot path in default mode (~28k facts class of defect D5).
- Allocating payload builders when the capability is off.
- Soft-skip missing properties in asserts/tests.
- Declaring accept/parity from protocol greens alone.
- Sharing fact types across Dom/Cssom planes.

---

## Default-on facts

| Fact | When | Payload (min) |
|------|------|----------------|
| `Establish.Started` | establish epoch opens | session, generation |
| `Establish.Completed` | establishEnd verified / arm path success | phase timings |
| `Establish.Failed` | establish failure | **errorCode, phase**, reason |
| `Diff.GenerationBumped` | hard nav generation++ | old, new |
| `Diff.Desynced` | desync entered | **trigger / errorCode, phase** |
| `Diff.ResyncRequested` | client OOB resync | cursor generation/sequence |
| `Diff.ResyncServed` | mirror resync stream served | watermark |
| `Frame.RateChanged` | rate policy step | fromHz, toHz, reason |
| `Frame.ClockStalled` | watchdog | frameStallMs |
| `Frame.ApplyOverrun` | client reported overrun (via ClientState / explicit) | count, p95 |
| `Session.PoolAcquired` | pool handout | |
| `Session.PoolReleased` | destroy-on-release | |
| `Asset.ServeMiss` | asset miss on serve path | key class, not PII URL dump |
| `Asset.ServeSlow` | slow serve | duration bucket |
| `Frame.Aggregate` | every `aggregateIntervalMs` | frames, ops, bytes, apply p50/p95 |

Full catalog names: `Telemetry.Sessions.PageProjection.<Fact>` (exact segment naming per Diagnostics catalog conventions).

---

## ParityDebug pack

- Per-frame and per-operation facts **only** when ParityDebug capability enabled for Sessions.PageProjection.
- Cost documented; CI may enable; production default off.
- Disabled path:

```csharp
public void EmitParityFrameDetail(...)
{
    if (!_capabilities.IsCapabilityEnabled(Descriptors.ParityFrameDetail))
        return; // BEFORE any allocation
    // ... allocate / build / publish
}
```

---

## Signatures (C#)

```csharp
public interface IPageProjectionTelemetry
{
    void EstablishStarted(in EstablishTelemetry ctx);
    void EstablishCompleted(in EstablishTelemetry ctx);
    void EstablishFailed(in EstablishTelemetry ctx, string errorCode, string phase);

    void GenerationBumped(uint from, uint to);
    void Desynced(string errorCode, string phase, string? triggerDetail);
    void ResyncRequested(uint generation, uint sequence);
    void ResyncServed(uint generation, uint coversThroughSequence);

    void RateChanged(int fromHz, int toHz, string reason);
    void ClockStalled(int frameStallMs);
    void ApplyOverrun(uint overrunCount, float applyP95Ms);

    void PoolAcquired();
    void PoolReleased();

    void AssetServeMiss(string assetClass);
    void AssetServeSlow(string assetClass, int durationMs);

    void NoteFrameRelayHeader(uint generation, uint sequence, byte flags, int bodyLength);
    void FlushAggregateIfDue();
}

public static class PageProjectionErrorCodes
{
    public const string SequenceGap = "sequence_gap";
    public const string GenerationMismatch = "generation_mismatch";
    public const string IdUnresolved = "id_unresolved";
    public const string CssomIdUnresolved = "cssom_id_unresolved";
    public const string PartMissing = "part_missing";
    public const string WireVersionUnknown = "wire_version_unknown";
    public const string WireDecodeError = "wire_decode_error";
    public const string EstablishChecksumMismatch = "establish_checksum_mismatch";
    public const string EstablishNodeCountMismatch = "establish_node_count_mismatch";
    public const string ResyncFailed = "resync_failed";
    public const string AnchorMiss = "anchor_miss";
    public const string MirrorOverBudget = "mirror_over_budget";
    public const string ClockStalled = "clock_stalled";
}

public static class PageProjectionPhases
{
    public const string Establish = "establish";
    public const string LiveApply = "live_apply";
    public const string Resync = "resync";
    public const string Input = "input";
    public const string AssetServe = "asset_serve";
    public const string Pool = "pool";
    public const string Encode = "encode";
    public const string Rewrite = "rewrite";
}
```

---

## Algorithm — frame-unit aggregate

```
NoteFrameRelayHeader(...):
  if !enabled(Aggregate or default counters): return
  counters.frames++
  counters.bytes += bodyLength
  // ops count: API does NOT parse Body — ops come from sidecar header optional field
  // OR aggregate only bytes/frames at API; ops/apply percentiles from ClientState
  mark activity

FlushAggregateIfDue:
  if now - lastAggregate < aggregateIntervalMs: return
  if !IsCapabilityEnabled(FrameAggregate): return  // early
  publish Frame.Aggregate { frames, bytes, applyP50, applyP95 from last ClientState }
  reset window counters
```

**Important:** to preserve PP-WIRE-1, API MUST NOT parse Body to count ops. Prefer: sidecar sends optional O(1) `opCount` on the **envelope header** (not by parsing in API), or omit ops from API aggregate and take client-reported stats.

---

## Algorithm — failure publish

```
PublishFailure(descriptor, errorCode, phase, context):
  if errorCode empty OR phase empty → DO NOT PUBLISH; assert in DEV
  if !IsCapabilityEnabled(descriptor): return  // early, no alloc
  build event with errorCode, phase, non-PII context
  publish
```

Desync facts always include trigger mapped to contract 16 codes.

---

## Early-return pattern (PP-TEL-1)

Every public emit method:

1. Capability check first.
2. Return void without allocating `Dictionary`, strings, or JT payloads.
3. Only then build the event.

Unit test: with capability off, `GC.GetAllocatedBytesForCurrentThread` delta ≈ 0 across N calls (allow negligible).

---

## Tests

| ID | Assert |
|----|--------|
| `PP-TEL-1` | Default load fact count designed ≤ E8; disabled emitters allocate nothing |
| `PP-TEL-2` | Every catalogued failure sample includes `errorCode` + `phase` |
| Plane split | Dom/Cssom do not share fact type ids |
| Wire | Aggregate path does not parse Body |
| Desync | `Diff.Desynced` includes trigger code from contract 16 |
| Rate | `Frame.RateChanged` on ladder step |

---

## Mapping from client/sidecar

| Source | Fact |
|--------|------|
| Sidecar establish | Establish.* |
| Client desync notify / sidecar observe | Diff.Desynced |
| Hub Resync | Diff.Resync* |
| Rate policy | Frame.RateChanged |
| Sidecar watchdog | Frame.ClockStalled |
| ClientState overrun | Frame.ApplyOverrun |
| Pool | Session.Pool* |
| Asset plane | Asset.Serve* |
