# Implementation — Clock (frame boundary + rate)

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/clock.ts` **and** in-page fragment `inpage/clock.frag.ts`; Node watchdog lives in `channel.ts` / `PageProjection.ts` orchestration calling into page |
| **LOC ceiling** | 200 |
| **Contracts implemented** | [03-frame.md](../../contracts/03-frame.md) § clock / rate; redesign §5.3.4–5.3.5; config knobs in [15-configuration.md](../../contracts/15-configuration.md) |
| **Invariants** | Boundary driven by in-page timer clock at `frameRateHz` (default 60). Drift corrected vs `performance.now()`. `requestAnimationFrame` MUST NOT drive the boundary. Rate messages from Node apply on next boundary (no per-frame RTT). Ladder 60→30→15→5; recover one step / ≥ `rateRecoverMs`. Hidden → `hiddenRateHz`. Backpressure never drops frames / never desyncs. |
| **Ban list** | rAF as frame boundary. Depending on background timer throttling (Chromium flags required). Oscillating rate recovery faster than `rateRecoverMs`. Using QueueDropped as load shedding. |

---

## Chromium flags (session browser — pool / launch)

Virtual sessions MUST launch with:

- `--disable-background-timer-throttling`
- `--disable-renderer-backgrounding`
- `--disable-backgrounding-occluded-windows`

Page MUST be kept in an active lifecycle state (orchestration responsibility). Without these, clock collapses ~1 Hz and PP-FR-7 fails silently.

---

## Types / signatures

```ts
interface FrameClock {
  start(onBoundary: () => void): void;
  stop(): void;
  /** Apply on next boundary. */
  setTargetHz(hz: number): void;
  getTargetHz(): number;
  /** Node → page control. */
  applyRateMessage(msg: RateMessage): void;
  /** For watchdog / telemetry. */
  lastBoundaryAt(): number; // performance.now()
}

type RateMessage =
  | { type: 'setHz'; hz: number; reason: RateReason }
  | { type: 'hidden'; hidden: boolean };

type RateReason =
  | 'config'
  | 'congestion'
  | 'host_pressure'
  | 'apply_overrun'
  | 'hidden'
  | 'recover';

interface RatePolicy {
  /** Called from Node when ClientState / host metrics change. */
  onClientState(state: PageProjectionClientState): void;
  onEmitCongestion(signal: 'channel' | 'mirror' | 'host'): void;
  currentHz(): number;
}
```

Defaults:

| Knob | Default |
|------|---------|
| `frameRateHz` | 60 |
| `frameRateLadder` | [60, 30, 15, 5] |
| `hiddenRateHz` | 1 |
| `rateRecoverMs` | 5000 |
| `frameStallMs` | 1000 |

---

## Step-by-step algorithm — in-page clock

### Scheduler choice (D-SPEC-6 / redesign)

Primary: `MessageChannel` ping-pong (macrotask) chained with delay computed from target period.  
Fallback: `setTimeout`.  
**Never** `requestAnimationFrame`.

### `start(onBoundary)`

1. `targetHz = frameRateHz`; `periodMs = 1000 / targetHz`.
2. `nextDue = performance.now() + periodMs`.
3. Schedule tick:

```
function tick() {
  const now = performance.now();
  if (now >= nextDue) {
    // drift correction: catch up at most one boundary (do not spin multi-flush)
    onBoundary();
    lastBoundaryAt = now;
    // apply pending rate change here
    if (pendingHz !== undefined) {
      targetHz = pendingHz;
      periodMs = 1000 / targetHz;
      pendingHz = undefined;
    }
    nextDue += periodMs;
    if (now - nextDue > periodMs) {
      // heavily behind: resync schedule to now+period to avoid burst
      nextDue = now + periodMs;
    }
  }
  scheduleNext(Math.max(0, nextDue - performance.now()));
}
```

4. `MessageChannel` pattern: port1.onmessage → tick; port2.postMessage(null) after timeout wait, **or** use `setTimeout(tick, delay)` with MessageChannel only as the zero-delay yield when delay≈0. Normative requirement: timer-based + drift correction; exact mix of MC + setTimeout is implementer choice within that constraint ([inpage.md](inpage.md)).

### `setTargetHz` / `applyRateMessage`

1. Store `pendingHz` (or hidden override).
2. Do not change period mid-boundary; apply at end of next `onBoundary` as above.
3. Hidden true → effective hz = `hiddenRateHz` (mutations still accumulate).
4. Hidden false → restore policy hz (ladder position).

### `stop`

Clear timeouts/ports; no further boundaries.

---

## Step-by-step — Node rate policy

Maintain `ladderIndex` into `frameRateLadder` (0 = full rate).

### Degrade

On congestion / host pressure / `overrunCount` increase from ClientState:
1. If already at bottom → stay; emit fact if not already degraded-at-floor.
2. Else `ladderIndex++`; send `{ type:'setHz', hz: ladder[ladderIndex], reason }`.
3. Emit catalogued fact `Frame.RateChanged` with `errorCode` N/A (info) — failures use contract 16 only when faulting.
4. Record `lastDegradeAt`.

### Recover

If conditions clear for ≥ `rateRecoverMs` since last upward attempt and since last degrade:
1. If `ladderIndex > 0` → decrement one step; send setHz; emit RateChanged.
2. Never skip steps.

### Hidden

From ClientState `visibility === 'hidden'` → send `{ type:'hidden', hidden:true }`. Visible → false.

---

## Watchdog (Node) — PP-FR-7

Orchestration / channel:

1. Track `lastFrameReceivedAt`.
2. Track `pageActivityAt` (asset requests, CDP events, MO liveness pings).
3. If `now - lastFrameReceivedAt >= frameStallMs` **and** `pageActivityAt` is recent (within stall window) → emit `Frame.ClockStalled` with `errorCode: clock_stalled`, `phase: live_apply` (or `encode`); call page `forceFlush()` via channel control message.
4. Watchdog MUST NOT desync by itself.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-FR-7` | Unfocused page still runs at frameRateHz; watchdog fires if not |
| `PP-FR-4` | Empty boundaries do not consume sequence (flush returns null) |
| `PP-LOAD-1` | Congestion degrades rate; no desync |
| `PP-LOAD-4` | Hidden → hiddenRateHz; resume without desync |
| `PP-TEL-2` | ClockStalled carries errorCode+phase |
