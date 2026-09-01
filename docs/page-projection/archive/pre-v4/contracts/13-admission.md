# Contract 13 — Admission and degradation

**Norm:** redesign §5.14. **Tests:** PP-LOAD-1..4. **Impl:** `api` admission + sidecar rate control.

## Rules

1. Capacity admission gated on **measured** host resources (CPU, memory, pool availability), not a raw configured session count alone.  
2. Per-session budgets: frame rate, `maxFrameBytes`, bytes/s, CPU share. Exceed ⇒ degrade (**frame rate first**); report fact `Frame.RateChanged`.  
3. One session MUST NOT consume the host; mutation storm degrades that session only (PP-LOAD-3).  
4. Ladder/thresholds from config; calibrated later by O4 (out of this pack’s code plan).  
5. Backpressure: fewer larger frames; never drop; never desync (PP-LOAD-1, PP-LOAD-2).  
6. Client `hidden` ⇒ `hiddenRateHz` (PP-LOAD-4).

## Inputs to rate policy

- Emit-path congestion  
- Host pressure signals  
- `PageProjectionClientState.overrunCount` / apply percentiles  
- Visibility  

## MUST NOT

- Use `QueueDropped` as load shedding.  
- Use deleted coalesce knobs / DiffQueueCapacity as load control.
