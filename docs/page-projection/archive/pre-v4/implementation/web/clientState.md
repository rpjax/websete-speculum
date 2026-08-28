# Implementation — `clientState.ts` (web)

**Future path:** `web/src/features/sessions/live/page/clientState.ts`  
**LOC ceiling:** 150  
**Contracts:** [10-interaction.md](../../contracts/10-interaction.md), [13-admission.md](../../contracts/13-admission.md), [15-configuration.md](../../contracts/15-configuration.md)  
**Norm:** redesign §5.9.5  
**API peer:** [../api/client-state.md](../api/client-state.md)

---

## Purpose

Build and send `PageProjectionClientState` control messages that drive server rate policy. **Not** a diff; MUST NOT affect `sequence`. Send on change and at most every `clientStateMs` (default 1000).

---

## Invariants

1. Payload shape exactly:

```
PageProjectionClientState {
  visibility: "visible" | "hidden"
  appliedThroughSequence: u32
  queuedFrames: u16
  applyP50Ms: f32
  applyP95Ms: f32
  overrunCount: u32   // applies exceeding applyBudgetMs (E9) since last report
}
```

2. Send when any field changes **or** when `clientStateMs` elapsed since last send (whichever implies a send opportunity — coalesce to ≤ 1 message per interval unless change-driven send is immediate; **normative:** send on change, but rate-limit to ≥1 ms spacing and ensure a periodic send at `clientStateMs` even if unchanged so server sees liveness/hidden).
3. `overrunCount` resets to 0 after a successful send that included it (report is delta since last report).
4. `visibility: "hidden"` MUST be reported promptly — drives `hiddenRateHz` (PP-LOAD-4).
5. Control channel only; never interleaved as a frame part; never increments sequence.

---

## Bans

- Embedding ClientState inside frame Body.
- Skipping hidden transitions.
- Soft-omitting fields (all fields always present).
- Using ClientState as a substitute for desync/resync.

---

## Types and signatures

```ts
export type PageProjectionClientState = {
  visibility: 'visible' | 'hidden';
  appliedThroughSequence: number;
  queuedFrames: number;
  applyP50Ms: number;
  applyP95Ms: number;
  overrunCount: number;
};

export type ClientStateDeps = {
  clientStateMs: number; // default 1000
  send: (state: PageProjectionClientState) => void; // hub method
  nowMs: () => number;
};

export type ClientStateTracker = {
  /** Document visibility changes. */
  setVisibility(v: 'visible' | 'hidden'): void;
  /** After successful apply batch. */
  noteApplied(sequence: number, queuedFrames: number): void;
  /** Record one apply duration sample (ms). */
  noteApplyDuration(ms: number): void;
  /** Increment when apply duration > applyBudgetMs. */
  noteOverrun(): void;
  /** Call from rAF/timer to flush due periodic sends. */
  tick(): void;
  /** Force send current snapshot (e.g. on disconnect cleanup — optional). */
  flush(): void;
  snapshot(): PageProjectionClientState;
};

export function createClientStateTracker(deps: ClientStateDeps): ClientStateTracker;
```

---

## Algorithm — metrics

```
samples: ring buffer of recent apply durations (e.g. last 64 or 1s window)

noteApplyDuration(ms):
  push sample
  recompute p50/p95 from ring (simple select / sort copy of small ring — keep LOC tiny)

noteOverrun:
  overrunCount++

noteApplied(seq, queued):
  appliedThroughSequence = seq
  queuedFrames = queued
  markDirty()
```

Percentiles: for ≤64 samples, sort copy and index; good enough for rate policy (not a substitute for O3 lab metrics).

---

## Algorithm — send rules

```
lastSentAt = 0
dirty = false
pending = initial snapshot (visibility from document.visibilityState)

setVisibility / note* → update pending; dirty = true; maybeSendImmediate()

maybeSendImmediate():
  // On visibility change: send ASAP (still ok to coalesce within same turn)
  if visibility changed since last send: sendNow()
  else if dirty: schedule microtask/rAF send coalescing

tick():
  if now - lastSentAt >= clientStateMs:
    sendNow()   // even if !dirty — heartbeat for hidden/visible + overrun 0

sendNow():
  send(snapshot())
  lastSentAt = now
  overrunCount = 0    // reset delta
  dirty = false
  remember lastSent snapshot for change detection
```

**Change detection:** field-level compare against last sent; visibility always triggers.

Hub DTO: MessagePack camelCase keys matching API `client-state.md`.

---

## Coupling

| Producer of facts | Field |
|-------------------|-------|
| `document.visibilityState` + pagehide | `visibility` |
| `ProjectionClient` after apply | `appliedThroughSequence`, `queuedFrames` |
| Apply timing around rAF batch | `applyP50Ms`, `applyP95Ms`, `overrunCount` |

Server uses these for §5.3.5 / §5.14 rate ladder (frame rate first). Overload ⇒ degrade, never desync.

---

## Tests

| ID | Assert |
|----|--------|
| `PP-LOAD-4` | Report `hidden` → server rate `hiddenRateHz`; resume visible without desync |
| `PP-LOAD-1` | Sustained `overrunCount` contributes to degrade path (with API) |
| Shape | Every message includes all six fields |
| Sequence | Sending ClientState does not advance frame `sequence` |
| Interval | No more than one heartbeat per `clientStateMs` when idle; visibility change sends promptly |
| E9 | Artificial >4 ms apply increments `overrunCount` until send |
