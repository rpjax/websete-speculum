# PageProjection — engine redesign extension (manual engineering)

**Status:** DRAFT — initial decision pass complete (E-01…E-11); further items may append  
**Parent:** [engine-redesign.md](engine-redesign.md) (rev 4, DECIDED)  
**Revision:** rev 9 (2026-08-12)  
**Rule:** Parent wins on acceptance (K1–K5, P\*/E\*, oracles, test IDs) unless this extension
explicitly **amends** a parent clause with date + rationale.  
**Goal:** simplify mechanisms, raise resilience, raise performance — without weakening parity and
without ad-hoc workarounds ([acceptance.md](acceptance.md),
[engineering-standards.md](../../engineering-standards.md)).

## How to use

- Parent §5 remains the product contract.
- This file holds **mechanism choices**, **spikes**, and **narrow amendments**.
- Every closed item lands in the Decision log (append-only).
- Implementation follows closed items only.
- When something here is ambiguous, stop and ask — do not choose.

## Decision log (append-only)

| Date | ID | Topic | Decision | Amends parent? |
|------|----|-------|----------|----------------|
| 2026-08-12 | E-01 | Frame boundary clock | Affirm §5.3.4 (no rAF). Expose `FrameClock` contract; default `TimerFrameClock`. Future clock = swap impl only. | No (encapsulation) |
| 2026-08-12 | E-02 | Producer threading | Main-thread only (zero Worker). Direct encode + emit. Congestion = defer emit, preserve dirty; never historical frame queue. Site jank is not a designed backpressure mechanism. | No (mechanism; affirms §5.3.5 spirit) |
| 2026-08-12 | E-03 mux | Data plane | Loopback WS carries enveloped channels (`SP` + `PlaneChannel`); Frame = opaque PP; Telemetry = Virtual push. Control reserved. CDP stays browser control. Seam: `DataPlane`. | Expands E-03 without a second socket |
| 2026-08-12 | E-04 | Op vocabulary | Affirm parent §5.4 in full. Hand-spec insert/remove+index and per-attr deltas rejected. No V1 subset of the opcode space. | No (affirms §5.4) |
| 2026-08-12 | E-05 | Identity reverse map | Affirm parent §5.1 in full: WeakMap forward; Map+WeakRef+FinalizationRegistry reverse; no DOM identity writes. | No (affirms §5.1) |
| 2026-08-12 | E-06 | ISR + double-buffer | MO callback marks only (ISR). Parent §5.3.2 dirty sets. Active/Frozen pointer swap on FrameClock tick. Deferred send preserves dirty/frozen. | No (affirms §5.3.2–3; mechanism detail) |
| 2026-08-12 | E-07 | Isolated World | Producer runs in Chromium Isolated World; shared DOM, separate JS heap; inject at document_start. Main-world producer rejected. | New mechanism (compat with parent in-page producer) |
| 2026-08-12 | E-08 | CSP / connect bypass | Mandatory for E-03: CSP header rewrite/strip, meta CSP neutralized, PNA/localhost launch policy on managed Chromium. Reuses/extends existing script-injection CSP path; spike validates loopback connect. | Related §5.2.3; enables E-03 |
| 2026-08-12 | E-09 | Slice order | Dual track while WIP: oracles (WP1/WP2) in parallel with producer/data-plane slices. No “ready/fixed/accept” until parent budgets+tests+oracles are 100%. Engine-first without oracles rejected. | Softens §10 sequencing for active dev; not acceptance |
| 2026-08-12 | E-10 | Frame-gen stress cost | Hand-spec absolute E2E ms rejected as product contract. Spirit kept: measure/enforce cost of producing a frame under heavy mutation (parent E1/E3/E5/E6 + O3/O4). | No (affirms §2 spirit; rejects hand-spec absolute E2E) |
| 2026-08-12 | E-11 | Virtual endpoint / inject | `virtual/` = bidirectional page endpoint. `virtual/contracts` + `virtual/models` are Virtual-only. Root `projection/models` = shared wire types for sidecar deserialize. esbuild → `virtual.js`; `inject/` delivers. | New mechanism; module path vs parent §9 |

---

## Closed decisions

### E-01 — Frame boundary clock

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** none (affirms §5.3.4)  
**Mechanism note:** adds an encapsulation boundary not named in the parent.

**Decision**

1. The frame boundary MUST be driven by an unthrottled timer-based scheduler
   (`MessageChannel` / `setTimeout` with `performance.now()` drift correction),
   exactly as parent §5.3.4.
2. `requestAnimationFrame` MUST NOT be used as the frame boundary in the current
   implementation.
3. Chromium background-throttling flags and the stall watchdog (`frameStallMs` /
   `Frame.ClockStalled`) remain mandatory as in the parent.
4. Default rate policy remains parent §5.3.5 / §5.16 (`frameRateHz` 60,
   ladder 60→30→15→5, `hiddenRateHz` 1, throttled recovery).

**Encapsulation (simplify / future-proof)**

5. Producer code MUST depend only on a **FrameClock** contract, not on a concrete
   timer API. The contract is the sole seam for “when does a frame flush?”.
6. Contract surface (normative intent, not a mandated TypeScript shape):
   - `start(onBoundary: () => void): void`
   - `stop(): void`
   - `setRateHz(hz: number): void` — applied on the next boundary
   - `now(): number` — monotonic ms (`performance.now()` or equivalent)
7. The default implementation is **TimerFrameClock** (MessageChannel / setTimeout).
8. A future alternate implementation (e.g. rAF-assisted early flush, or a hybrid)
   MAY replace TimerFrameClock **only** by satisfying the same contract and the
   parent invariants: unthrottled minimum rate when the session is live, and
   detectable stall via the existing watchdog. Swapping MUST NOT require changes
   in observe / accumulate / flush / encode.
9. Observe, dirty-set accumulation, and flush MUST NOT import timer primitives
   directly — only FrameClock.

**Rationale**

Parent §5.3.4 is correct for headless density and silent-lag avoidance. Encapsulating
the clock keeps that decision reversible as an implementation swap without reopening
the frame model (§5.3) or the wire atom.

---

### E-02 — Producer threading (Main-only / zero Worker)

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** none (affirms §4 encode path and §5.3.5 backpressure spirit)  
**Mechanism note:** rejects in-page Web Worker offload for the producer pipeline.

**Decision**

1. The entire Virtual producer pipeline for a live frame — MutationObserver ISR mark,
   dirty-set accumulation, flush-time DOM reads, binary encode into a reusable
   `Uint8Array`, and handoff to the transport — MUST run on the **page Main Thread**
   inside the Isolated World (see E-07 when closed).
2. **Web Workers MUST NOT** be used in V1 for encode, pack, or send. Premises that
   serialize from live `Node` references inside a Worker are **rejected** (Workers
   have no DOM access).
3. Encode MUST target a **preallocated, reusable** binary buffer (parent §5.5.4).
   No `JSON.stringify` / `JSON.parse` on this path (parent `PP-WIRE-3`).
4. **Dirty-driven emit.** If a clock tick finds no operations after flush rules
   (parent §5.3.3), the producer MUST NOT emit and MUST NOT consume a `sequence`.
5. **No historical frame queue.** Under congestion the producer MUST NOT buffer a
   backlog of past frames for later replay (“cassette tape” lag). It MUST keep
   accumulating dirty state and emit **fewer, larger** net-effect frames (parent
   §5.3.5).
6. **Defer, do not drop truth.** If the transport cannot accept a frame
   (`FrameTransport.send` → deferred — see E-03), the producer MUST NOT advance
   `sequence` for that attempt and MUST **preserve dirty / frozen state** until a
   later tick successfully accepts an emit. Clearing dirty before accept is a defect.
7. Socket / channel watermarks (e.g. `bufferedAmount`, or equivalent) MUST use a
   **threshold**, not a strict `=== 0` emptiness check. Exact knobs land with E-03
   and remain coherent with the parent rate ladder (60→30→15→5) and client
   `PageProjectionClientState`.
8. **Site Main-thread jank is not a designed backpressure mechanism.** Happy-path
   flush MUST aim for parent E3/E5 so projection does not alter Virtual behaviour.
   Accidental slowdown under extreme overload is a last-resort physical effect, not
   an invariant to rely on for sync.
9. I/O acceptance MUST be reached through a small **FrameTransport** (or equivalent)
   seam so flush / encode do not hard-code `WebSocket` APIs. Concrete channel choice
   is E-03.

**Rationale**

Typical dirty cardinality per frame is small; direct Main-thread binary write is
simpler and usually cheaper than `postMessage` thread hops. Independent clock +
dirty-driven no-op ticks keep idle cost near zero. Preserving dirty on deferred emit
keeps the client on the **present** coalesced tree without sequence gaps. Designing
for intentional Virtual jank would violate fidelity and E1.

---

### E-03 — Virtual → Node data channel (loopback WebSocket)

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** clarifies §4 “chunked binary push to Node” with a concrete mechanism  
**Depends on:** E-02 (`FrameTransport`); E-08 (CSP / Private Network Access mitigations)

**Decision**

1. **Data plane** between the Virtual page producer and the Node sidecar MUST be a
   **loopback WebSocket** to `127.0.0.1` (OS loopback). Frame and diff bodies MUST
   travel on this plane only.
2. **Control plane** remains CDP (tab lifecycle, cookies/context, CSP/header
   interception, input inject, diagnostics). CDP MUST NOT carry mutation/frame/diff
   payloads. `page.evaluate` (and equivalents) MUST NOT be used to return bulk
   projection bodies.
3. Producer code MUST talk only to a **FrameTransport** seam (E-02 §9). The default
   implementation is **LoopbackWebSocketTransport**.
4. `FrameTransport.send(bytes)` MUST return (or equivalent):
   - **accepted** — bytes handed to the socket stack; producer MAY advance
     `sequence` for that emit;
   - **deferred** — socket under watermark pressure or not ready; producer MUST
     preserve dirty state and MUST NOT advance `sequence` (E-02 §6).
5. Watermark MUST be a configurable threshold on `bufferedAmount` (or equivalent),
   coherent with parent `maxFrameBytes` and the rate ladder — **not**
   `bufferedAmount === 0`.
6. **Part splitting** (parent §5.5 `partIndex` / `partCount`) belongs in **encode**.
   Transport sends opaque byte messages; it MUST NOT re-parse or re-chunk frame
   semantics.
7. **Session binding.** Each LiveSession gets an isolated listener binding
   (port and/or path) plus a **secret token**. The page MUST authenticate before
   frames are accepted (URL query, subprotocol, or first hello frame — pick one
   impl; token MUST be unguessable per session). Foreign sessions MUST NOT be able
   to attach.
8. Sidecar listens on loopback only (`127.0.0.1`), never on a public interface.
9. Disconnect / stall on the data plane MUST be observable to the orchestrator
   (feeds parent frame-stall / recovery behaviour). Reconnect policy MUST NOT
   invent a second sequence space.
10. **Rejected as data plane:** returning frame bodies via CDP
    `Runtime.evaluate` / Playwright `evaluate`; `Runtime.addBinding` /
    `exposeBinding` as the primary bulk path; magic `fetch` intercepted solely to
    haul bodies over CDP.
11. **Mux.** The loopback WebSocket is the **data plane**: messages are
    enveloped (`magic SP`, `channel`, payload). `PlaneChannel.Frame` carries
    opaque PP bytes; `PlaneChannel.Telemetry` carries Virtual→sidecar telemetry
    push (sidecar fans out: lab WSS / prod notification). `Control` is reserved.
    Frame backpressure remains per-send watermark on the plane; telemetry MUST
    drop under pressure and MUST NOT block the frame path. CDP remains the
    browser control plane.
12. **Implementation spike (go/no-go for flags, not for mechanism):** validate on
    Speculum’s managed Chromium that loopback WS works under real site CSP after
    E-08 mitigations, and that Private Network Access / localhost blocks are
    disabled or bypassed via **browser launch flags / control-plane policy** Speculum
    owns. Failure of the spike means fix flags/CSP (E-08) or adjust listen/auth
    details — **not** revert the data plane to CDP bulk.

**Rationale**

CDP evaluate/return of large JSON/binary was a measured host and latency bottleneck
(parent D4). Loopback WS keeps bulk bytes on the kernel loopback path between the
renderer and the sidecar process Speculum already runs, while CDP stays available
for control. Per-session tokens preserve K2. `FrameTransport` keeps encode/flush
testable and keeps E-02 defer semantics explicit.

---

### E-04 — Op vocabulary

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** none (affirms §5.4 in full)

**Decision**

1. The live and establish operation vocabulary MUST be exactly parent §5.4:
   `establishBegin` / `establishChunk` / `establishEnd`, declarative `childList`
   (`FULL` | `APPEND`), full flush-time `patch`, scroll ops, and Cssom ops
   (`cssomInstall` / `cssomSheetList` / `cssomRuleList` / `cssomPatch`), with the
   parent in-frame ordering (§5.4.3).
2. Hand-spec opcodes based on indexed `NODE_INSERT` / `NODE_REMOVE` and per-field
   attribute/text/style deltas are **rejected**. They reintroduce index-arithmetic
   hazard and destroy-and-recreate moves (parent `PP-MOVE-*`, D-class defects).
3. There is **no** reduced V1 opcode subset: shipping fewer *features* later is an
   E-09 slice concern; the wire vocabulary and encoder/decoder shapes stay aligned
   with the parent so establish, Cssom, and live Dom do not fork protocols.
4. `APPEND` remains the fast path when flush proves a pure suffix change; otherwise
   `FULL`. `patch` remains a full flush-time snapshot (idempotent), not a delta.

**Rationale**

Measured bottlenecks were DOM identity writes, O(nodes) addressing, JSON/evaluate
bulk, and per-mutation envelopes — not declarative `childList` / full `patch`.
Keeping the parent vocabulary preserves move identity, ACID apply, and O2
comparability without a second protocol to migrate later.

---

### E-05 — Identity maps

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** none (affirms §5.1 in full)

**Decision**

1. Identity MUST follow parent §5.1: per-session monotonic `uint32` ids from 1;
   `0` reserved for none; no identity attributes written into the Virtual DOM;
   text and comment nodes receive ids; ids never reused within a `generation`.
2. Producer MUST maintain:
   - **forward:** `WeakMap<Node, uint32>`
   - **reverse:** `Map<uint32, WeakRef<Node>>` with `FinalizationRegistry` cleanup
     (and cleanup on `generation` bump), so detached nodes are not retained and the
     reverse map cannot grow without bound (`PP-ID-4`).
3. A strong `Map<uint32, Node>` reverse table is **rejected** (retains detached
   nodes). Deferring the reverse map to a later slice is **rejected** — input
   resolution (§5.11) requires it from the start.
4. `speculum-anchor` appears only in establish HTML on the Projected path as in
   parent §5.1.7; never as live Virtual tracking.

**Rationale**

Forward map serves emit; reverse map serves input and sensors. WeakRef reverse is
cheap hygiene against session memory growth and is already specified by the parent.

---

### E-06 — ISR + double-buffer

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** none (affirms §5.3.2–3; records the Active/Frozen mechanism)

**Decision**

1. The `MutationObserver` callback MUST act as an **ISR only**: record into the
   parent §5.3.2 dirty structures (`newIds`, `dirtyParents`, `attrDirty`,
   `textDirty`, `stateDirty`, `scrollDirty`, `detached`, and discard
   non-published records at the top of the callback). No attribute reads, no
   tree walks for payload, no encode, no transport in the callback.
2. State sensors (parent §5.2.1) follow the same rule: mark dirty and return.
3. Accumulation MUST use an **Active / Frozen** double-buffer (or equivalent
   pointer swap): the observer and sensors write only the Active side; on each
   `FrameClock` boundary the producer swaps in O(1), freezes the prior Active as
   Frozen for flush, and continues accruing on a clean Active.
4. Flush MUST run against **Frozen only**, applying parent §5.3.3 order
   (prune ephemerals → absorb descendants → prune orphans → emit ops).
5. A single shared mutable set without swap is **rejected** (flush races with live
   mutations). Replaying raw `MutationRecord` lists as the wire unit is
   **rejected** (parent frame model).
6. If `FrameTransport.send` returns **deferred** (E-02 / E-03), dirty / Frozen
   state MUST remain until a later tick accepts an emit — no clearing truth on
   a skipped send.

**Rationale**

ISR keeps site jank off the observer path. Double-buffer isolates flush from
concurrent mutations without a Worker. Parent dirty sets + net-effect flush stay
the source of truth; Active/Frozen is the concrete concurrency shape.

---

### E-07 — Isolated World

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** none (mechanism for the in-page producer assumed by §4 / §5)  
**Related:** E-02 (Main-thread pipeline), E-03 (loopback WS client runs here)

**Decision**

1. The Virtual producer (identity, observe/ISR, FrameClock, flush, encode,
   FrameTransport client) MUST run in a Chromium **Isolated World**, not in the
   page’s main world.
2. Injection MUST use early document lifecycle (`Page.addScriptToEvaluateOnNewDocument`
   or Patchright equivalent) so arming can occur at document_start before the
   parser fills the tree (parent establish/observe intent; “Frame 0 arming”).
3. The Isolated World shares the document’s DOM/CSSOM C++ objects with the page
   and MUST NOT rely on the page’s JS builtins (`window.MutationObserver`,
   patched prototypes, etc.) when an unforgeable isolated binding exists.
4. Running the producer in the page main world is **rejected** for V1 (prototype
   pollution, site breakage, antibot surface). Hybrid main+isolated producer
   splits are **rejected** unless a later decision reopens this item with evidence.
5. Isolated World does **not** by itself authorize `connect-src` / localhost —
   that is E-08.

**Rationale**

Shared DOM is required for observation; a separate JS heap keeps the producer
from fighting the site’s runtime and from leaking Speculum state onto `window`.

---

### E-08 — CSP / connect bypass (enables E-03)

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** none (extends control-plane practice already used for script
injection; aligns with §5.2.3 meta CSP strip on the published F tree)  
**Required by:** E-03

**Decision**

1. Loopback WebSocket data plane (E-03) is **invalid** unless all of the following
   hold on Speculum-managed Virtual Chromium:
   - **HTTP CSP headers** on navigations/subresources that would block the
     connection are stripped or rewritten via the control-plane Fetch/Network
     interception path so `connect-src` (and equivalent) cannot forbid
     `ws://127.0.0.1` / the session data-plane URL.
   - **Meta CSP** in the live Virtual document cannot block the data-plane
     connect (neutralize/strip as needed; consistent with parent deny-list intent).
   - **Private Network Access / public→localhost blocks** are disabled or bypassed
     via **browser launch flags / pool policy** Speculum owns for Virtual
     instances — not by asking origins to allowlist localhost.
2. This MUST **reuse and extend** the motor’s existing CSP bypass used to enable
   script injection, rather than inventing a second ad-hoc interceptor. The
   extension explicitly covers **connect** to the loopback data plane, not only
   script-src style injection needs.
3. Bypass scope SHOULD stay minimal for the Speculum data-plane requirement;
   wholesale “disable all web security” without a documented need is rejected as
   the default story (pool flags must be named and justified in implementation).
4. The E-03 implementation spike MUST prove: after these mitigations, Isolated
   World producer can open the per-session loopback WS on representative CSP-heavy
   sites. Spike failure ⇒ fix E-08/flags — **not** move frame bodies back to CDP.

**Rationale**

E-03’s bytes never reach the sidecar if the renderer refuses the socket. The motor
already performs CSP surgery for injection; connect-src + PNA are the same class of
control-plane enablement for a owned browser, not a product workaround on the
parity path.

---

### E-09 — Slice order (WIP dual track)

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** softens §10 *sequencing during active development* only — does
**not** soften acceptance, budgets, or test exit criteria

**Decision**

1. Speculum PageProjection remains **WIP / unreleased**. A slice, spike, or green
   pipe MUST NOT be called ready, fixed, recovered, or accepted until the parent
   contract is met in full: oracles O1–O5, applicable §8 tests, and §2 budgets
   (**100%** of the claimed scope — no partial product victory).
2. **Dual track** is allowed during development:
   - **Track Oracles:** WP1/WP2 (and ongoing oracle hardening) against current and
     new paths.
   - **Track Engine:** vertical slices implementing closed extension decisions
     (e.g. Isolated World producer → loopback data plane → sidecar), including
     manual from-scratch work behind harness/flags.
3. Tracks MAY proceed **in parallel**. Merging a track into the default session
   path still requires the parent exit rule: tests + budgets for that scope hold;
   protocol-only greens never prove accept
   ([acceptance.md](acceptance.md)).
4. **Engine-first without oracles** (parent §10 ignored forever; claim success from
   smoke/pipe) is **rejected**.
5. Early slices MAY stop at Virtual producer → sidecar (before new surface/apply)
   as a development boundary; that boundary is explicit WIP, not a shipping
   Milestone “done”.

**Rationale**

Active development needs a place to build the data plane by hand without waiting
for every oracle harness line to land first — without redefining “done”. Done
remains parent-complete.

---

### E-10 — Frame generation cost under stress

**Status:** DECIDED  
**Date:** 2026-08-12  
**Amends parent:** none (affirms §2 engine budgets; rejects hand-spec absolute E2E
wording as a product contract)

**Decision**

1. Product-facing latency and parity budgets remain **exactly parent §2** (P1–P7,
   E1–E11), enforced by oracles O3/O4/O5. No absolute “end-to-end &lt; 50 ms /
   &lt; 16 ms” clause is added to the contract — that wording from the manual draft
   is **not** normative here.
2. The **spirit** of that manual draft is retained and restated correctly: under a
   expensive, high-mutation page, the cost of **producing one frame** on the
   Virtual host (ISR accrual + flush reads + encode + transport accept on
   loopback) MUST stay inside the parent engine budgets — especially **E3**
   (per live operation), **E5** (per-frame pipeline overhead), **E1** / **E6**
   (load and steady-state CPU), and density **E11** via **O4**.
3. Engineering stress evaluation MUST ask: “does frame generation keep up without
   blowing CPU or forcing cassette-tape backlog?” — answered by dirty-driven
   net-effect frames (E-02), rate ladder (parent §5.3.5), deferred-send without
   dropping truth (E-02/E-03), and the parent budgets above — **not** by a single
   absolute wall-clock E2E number that conflates unrelated stages.
4. Optional lab notes (p95 flush+encode+loopback-accept on a fixture) MAY appear
   in harness docs as diagnostics; they MUST NOT replace or weaken §2.

**Rationale**

The manual “50 ms / 16 ms” intent was host-side frame-production stress, not
network RTT. Parent §2 already names that intent with measurable engine budgets.
Keeping those avoids a misleading absolute E2E contract while preserving the
stress question that matters for ≥100 sessions.

---

### E-11 — Virtual endpoint authoring and inject bundle

**Status:** DECIDED (amended — models/contracts placement)  
**Date:** 2026-08-12  
**Amends parent:** module path — greenfield at
`Refactor/sidecar/browser/mirror/projection/` (not `patchright/mirror/page/` §9);
bundle mechanism is new

**Decision**

1. The Virtual-side PageProjection endpoint lives under `projection/virtual/`,
   organized by domain. It is **bidirectional** (frames out, client control/input
   in) — not a one-way producer.
2. **`projection/models/`** holds **shared wire models only** — types the sidecar
   imports to deserialize what Virtual sends on the data plane (`Frame`, opcodes,
   node keys, …).
3. **`projection/virtual/{domain}/`** holds that domain’s **port(s) and
   implementation(s) together** (e.g. `clock/frameClock.ts` +
   `clock/timerFrameClock.ts`). A flat `virtual/contracts/` dump is **rejected** —
   multiple impls stay next to the port they satisfy.
4. **`projection/virtual/models/`** holds Virtual-internal models that are **not**
   shared with the sidecar (e.g. `DirtySets`).
5. Build MUST emit a single IIFE `virtual.js` from `virtual/bootstrap.ts`
   (`npm run build:virtual`). Injection uses that file only via `inject/`.
6. Delivery-named dumps (`inpage/`) and outbound-only names (`producer/`) are
   rejected.
7. Sidecar assigns `globalThis.__SPECULUM_PROJECTION__` via
   `inject/buildConfigPreScript` **before** `virtual.js`. Virtual
   `config/projectionConfig.ts` reads once, freezes, fail-fast on missing
   `dataPlaneUrl`; bootstrap opens the data-plane transport from that config.

**Rationale**

Shared models exist for host deserialize. Virtual contracts/models stay under
`virtual/` because they are exclusive to the page endpoint.

---

## Open items (discussion order)

1. ~~E-01 Frame clock~~ **DECIDED**
2. ~~E-02 Worker / Main threading~~ **DECIDED**
3. ~~E-03 Loopback WS data plane~~ **DECIDED**
4. ~~E-04 Op vocabulary~~ **DECIDED**
5. ~~E-05 Identity maps~~ **DECIDED**
6. ~~E-06 ISR + double-buffer~~ **DECIDED**
7. ~~E-07 Isolated World~~ **DECIDED**
8. ~~E-08 CSP / connect bypass~~ **DECIDED**
9. ~~E-09 Slice order~~ **DECIDED**
10. ~~E-10 Frame-gen stress cost~~ **DECIDED**
11. ~~E-11 In-page TS → IIFE bundle~~ **DECIDED**

Further decisions append to the Decision log and Closed decisions sections.
