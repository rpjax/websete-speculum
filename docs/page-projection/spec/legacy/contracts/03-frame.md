# Contract 03 — Frame model

**Norm:** redesign §5.3. **Tests:** PP-FR-1..8, PP-LOAD-1..4, PP-MOVE-*. **Impl:** `frame.md`, `clock.md`.

## Definition

A **frame** = net effect of all Virtual mutations since the previous frame, one ordered op set, one `sequence`, one atomic client transaction.

## Accumulation sets (per frame, in-page)

| Set | Meaning |
|-----|---------|
| `newIds` | First published this frame |
| `dirtyParents` | F-visible child list changed |
| `attrDirty`, `textDirty`, `stateDirty` | Need `patch` |
| `scrollDirty` | Map id→position; viewport uses sentinel 0 (D-SPEC-5); last sample wins |
| `detached` | Previously published, no longer connected |

## Flush order (§5.3.3)

1. Prune ephemerals (`newIds` not connected → discard; id never sent) — PP-FR-1.  
2. Absorb descendants of `newIds` ancestors — PP-FR-2.  
3. Prune orphans under `detached`.  
4. Emit `childList` per surviving dirty parent, **ancestor-first document order**.  
5. Emit `patch` for each id in `attrDirty ∪ textDirty ∪ stateDirty` (full snapshot) — PP-FR-3.  
6. Emit Cssom ops coalesced in the same window.  
7. Emit scroll ops (≤1 per scroller; echo suppression).  
8. Allocate **one** `sequence` and emit. Empty ⇒ no emit, no sequence — PP-FR-4.

## Clock (§5.3.4)

- In-page timer clock at `frameRateHz` (default 60).  
- MUST NOT use `requestAnimationFrame` for the boundary.  
- Scheduler: `MessageChannel` and/or `setTimeout` with drift correction vs `performance.now()`.  
- Chromium flags: `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`; keep page active.  
- Node watchdog: if page activity but no frame for `frameStallMs` (1000) → `Frame.ClockStalled` + force flush (PP-FR-7).  
- Rate message from Node applied on next boundary; no per-frame RTT.

## Rate / backpressure (§5.3.5)

- Ladder: 60 → 30 → 15 → 5. Triggers: emit congestion, host pressure, client apply overrun. Fact on every transition.  
- Recover one step / ≥ `rateRecoverMs` (5000).  
- Client `hidden` ⇒ `hiddenRateHz` (1); mutations still accumulate.  
- MUST NOT drop frames or desync under load.  
- `maxFrameBytes` (1 MiB): split parts, never drop (PP-FR-8).

## `childList` modes

- `FULL`: complete F-visible child list.  
- `APPEND`: pure suffix only.  
- Moves = reorder existing ids (preserve identity) — PP-MOVE-1..3.

## MUST NOT

- Filter mutations by visual relevance.  
- Emit one wire envelope per MutationRecord.  
- Use coalesce knobs from superseded coalesce doc.
