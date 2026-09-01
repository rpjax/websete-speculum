# Contract 14 — Telemetry

**Norm:** redesign §5.15. **Tests:** PP-TEL-1..2. **Impl:** `api/telemetry.md`.

## Unit

Default unit = **frame**. Default facts per load MUST be designed to hold E8 (≤ 50). Proving E8 on live loads is a later optimize plan; this contract defines the catalog and emit rules.

## Default-on facts

- `Establish.Started` / `.Completed` (phase timings) / `.Failed`  
- `Diff.GenerationBumped`  
- `Diff.Desynced` (with trigger)  
- `Diff.ResyncRequested` / `.ResyncServed`  
- `Frame.RateChanged`  
- `Frame.ClockStalled`  
- `Frame.ApplyOverrun`  
- `Session.PoolAcquired` / `.PoolReleased`  
- `Asset.ServeMiss` / `.ServeSlow`  
- Periodic `Frame.Aggregate` (frames, ops, bytes, apply p50/p95) at `aggregateIntervalMs`

## ParityDebug pack

Per-frame / per-operation facts **only** under ParityDebug. Disabled emitters early-return **before any allocation**.

## Catalog

Prefix `Telemetry.Sessions.PageProjection.*`. Dom and Cssom MUST NOT share fact types.

## Failures

Every catalogued failure carries `errorCode` + `phase` (PP-TEL-2).

## PageEpoch

PageEpoch story machinery retained; unit is frame, not per MutationRecord.
