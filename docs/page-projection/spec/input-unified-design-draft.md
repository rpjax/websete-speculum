# Unified input — design draft (TEMPORARY)

> **Status:** WORK IN PROGRESS — not normative. Code must not implement from this file until promoted.
> **Goal:** 100% defined spec → code is a direct reflection of spec.
> **When done:** replace [input-v2.md](input-v2.md) + OS-input sections elsewhere; archive superseded docs; append [decision-log.md](decision-log.md).
> **Owner decides:** Rodrigo. Agents propose; nothing here is `LOCKED` until he marks it.

**Started:** 2026-08-23 (debate with Opus + codebase review on `feat/mirror-mode`).

---

## 0. One-liner

**One pipeline, one ordered buffer path, one Input Applier (= dispatcher).** Routes by type to downstream contracts. Display over-alloc at R; Chromium/client window = subset 1:1. Wire = MessagePack (lean). Scroll SET live; upload stub until v1.1; wheel dead.

---

## 1. What this replaces (explicit discard list)

When promoted, the following are **dead** unless re-listed here as kept:

| Current | Disposition |
|---------|-------------|
| [input-v2.md](input-v2.md) Mode A (CDP fire-and-forget pointer/key) | **Discard** — replaced by peripheral contract |
| input-v2 Mode B as general Control→`domNodes` (focus/blur/input/…) | **Discard as default** — fine contracts only where explicitly listed (scroll SET, upload) |
| input-v2 Mode C (`setFiles` as CDP “input mode”) | **Rewrite** — becomes a fine contract on the Applier, not a CDP mode letter |
| [input.md](input.md) V1 CDP inject chain as primary | **Discard** |
| `PatchrightInputBackend` as production path | **Discard** |
| `OsInputBackend` relative pointer + soft-cursor + `REL_CHUNK` | **Discard** |
| `SPECULUM_INPUT_BACKEND` toggle | **Discard** |
| Sidecar identity-table replica / nodeId resolve on **peripheral** hot path | **Discard** |
| `generation` / sequence gates on input dispatch | **Discard** (journal-only fields TBD) |

**Not discarded by default:** frame pipeline, resync control plane, PageProjection apply — input must not break them.

---

## 2. Decision register

Mark cells: `OPEN` | `PROPOSED` | `LOCKED` | `REJECTED`.

| ID | Topic | Status | Proposal / notes |
|----|-------|--------|------------------|
| D-UI-00 | **Pipeline: client buffer → wire (asap) → sidecar ordered buffer → Applier** | LOCKED | Rodrigo 2026-08-23. Order preserved end-to-end. |
| D-UI-01 | **Input Applier = dispatcher contract** — routes by event type to downstream contracts it consumes | LOCKED | Does not implement peripherals itself; selects `IPointerPeripheral` / `IKeyboardPeripheral` / `IAbsoluteScroll` / `IFileUpload` / … |
| D-UI-01a | **Fine contract: absolute scroll SET** | LOCKED | Via projection runtime bus / Virtual JS. Targets: **viewport/document and element**. Identity: `contextId` + `nodeId` when element. |
| D-UI-01b | **Fine contract: file upload** | LOCKED (membership) / **DEFERRED v1.1** | v0 = **stub only** (accept intent, no real apply). Mechanism OPEN until v1.1. |
| D-UI-01c | **Catalog of fine contracts (v0 closed list)** | LOCKED | **v0 live = absolute scroll SET only.** Upload present as stub. Growth only by new D-UI row. Candidates §3.2a. |
| D-UI-02 | **Pointer device: ABS-for-all** (no REL move path) | LOCKED | Contract law. Spike D-UI-20 proves stack; no REL path in design. **No REL_WHEEL** (D-UI-22). |
| D-UI-03 | **Click = moveTo(x,y) + press + release** | LOCKED | **Always** `moveTo` on both `down` and `up`, then BTN. Sidecar never invents motion. |
| D-UI-03a | **Out-of-window coords** | LOCKED | For intent stamp `(W,H)`: outside `[0,W)×[0,H)` → **drop** + tele (bug; never clamp-accept). |
| D-UI-03b | **All pointer buttons** | LOCKED | Left/middle/right = same path; only `button` enum differs. |
| D-UI-04 | **Identity coordinate chain** + **over-alloc display / subset window** | LOCKED | Display+ABS fixed at R (over-alloc capacity). Chromium window = client W×H ≤ R at (0,0), scale 1 — **subset 1:1**, never stretch to fill R. |
| D-UI-05 | **Resize: never recreate display/uinput** — window + viewport stamp | LOCKED | Soft resize only. **No `viewportEpoch`.** Each coordinate intent carries `viewportW`/`viewportH`; sidecar drops mismatch + tele. |
| D-UI-05a | **Viewport stamp on pointer intents** | LOCKED | Client stamps its current W×H on every move/down/up. Sidecar: `x∈[0,W)`, `y∈[0,H)` for **that stamp**; stamp ≠ session active viewport → drop + tele. Client learns W×H from its surface + session resize notify (not a generation counter). |
| D-UI-06 | **Cap R:** client > R → clamp (no scale) | LOCKED | Scale forbidden. Exact numeric R still OPEN (D-UI-11). |
| D-UI-07 | **`nodeId` / `contextId` on wire** | LOCKED | Peripheral: unused. `scrollSet`: `contextId` always; `nodeId` for element. Envelope §3.7 / §10.6. |
| D-UI-08 | **Input does not sync with frame generation / resync** | LOCKED | Input stream independent of frame generation/resync. Client desync ⇒ stop emitting intents (existing PP law). Resync = OOB control, not input gate. |
| D-UI-09 | **Compositor: Xorg + dummy** | LOCKED | Per-session compositor stack for v0. |
| D-UI-10 | **N sessions per sidecar** | LOCKED | Multiple sessions per sidecar; each session = own display + browser + devices + Applier consumer. |
| D-UI-11 | **Numeric R** (Rw×Rh) | LOCKED (direction) | Over-alloc **large enough for any device** (Rodrigo). Exact constant = product tuning later — not an open design fork. |
| D-UI-12 | **Keymap v0: fixed layout → KEY_*; wire strings UTF-8** | LOCKED | Keyboard wire = **keydown/keyup stream** (+ modifiers on each event) so combos (Ctrl+C, Ctrl+V, …) replay on Virtual. Optional `type(text)` for plain typing only — never replaces combo stream. Unmapped codepoints: drop + tele. No IME v0. |
| D-UI-13 | **Touch / multitouch** | DEFERRED | Out of v0. |
| D-UI-15 | **Peripheral writer in-process** | LOCKED | One Applier consumer thread owns pointer+keyboard per session; no separate input process. |
| D-UI-16 | **Device reset / sanitize** | LOCKED | Session owns pointer+keyboard devices. **Virgin at session start** (create fresh **or** `reset()`/sanitize before admit). **Sanitize on teardown + recover** — release all BTNs/keys. If device node outlives session, `reset()` is mandatory — never inherit stuck buttons. |
| D-UI-17 | **Buffer pressure** | LOCKED | **drop oldest** + natural backpressure. Never drop/coalesce **down/up**. Scroll coalesce **100ms**/target (D-UI-33). Move coalesce **50ms** (D-UI-35). No move flush before click. |
| D-UI-18 | **Isolation** | LOCKED | No shared pointer/keyboard devices across sessions; no input-state leak between sessions. |
| D-UI-19 | **Projected + Video same intent types** | LOCKED | Same wire intent types; sidecar routes by intent type, not mirror-mode letter. Video: no S6 census (PageProjection-only). |
| D-UI-20 | **Spike ABS → Chrome click** | OPEN | **Engineering only** — proves stack. Contract D-UI-02 already LOCKED. |
| D-UI-21 | **Ordering across contracts** | LOCKED | One sidecar consumer. |
| D-UI-22 | **Wheel dead; scroll SET owns** | LOCKED | Accept Virtual has `scroll` from SET, **no** `wheel` events. |
| D-UI-23 | **Wire codec = MessagePack; lean envelope; telemetry knobs** | LOCKED | Hot path cheap. **§10.6:** `schemaVersion=1`; enum v0 `move|down|up|keyDown|keyUp|scrollSet|setFiles`; `ScrollCensus` **required inline** on PP `down`/`up`; absent on Video; `timestampClient` optional. |
| D-UI-36 | **Input telemetry v0** | LOCKED | Knobs: master + **failures** on by default; **buffer** off. Emit on gesture failures only (census, apply, validate, scroll miss) — not move coalesce noise. Catalog §10.7. |
| D-UI-24 | **Scroll SET miss** (`nodeId` / context absent) | LOCKED | **Drop** + emit telemetry event **iff** that input-telemetry capability is enabled. |
| D-UI-25 | **Upload v0** | LOCKED | Stub only; real apply = v1.1. |
| D-UI-26 | **Scroll↔click coherence (S6)** | LOCKED | Projected census + Virtual apply + peripheral click. Index §10.2; census down+up; Phase A fail ⇒ skip Phase B; apply fan-out fail-closed. |
| D-UI-27 | **ContextBus clean cutover** (no version dual-stack) | LOCKED | Everything migrates to [context-bus.md](context-bus.md); legacy bus removed same change set (Rodrigo 2026-08-23). |
| D-UI-28 | **Virtual↔sidecar loopback mux** | LOCKED | §10.1c — kinds frame/telemetry/invoke/invoke-result; v0 RPC `applyScrollCensus`; LB-01…LB-07. |
| D-UI-29 | **Domain vocab ≠ bus vocab** | LOCKED | Domain (`emitFrame`, …) independent of `bus.emit`/`bus.invoke`. Bus has zero domain semantics. |
| D-UI-30 | **bus.invoke vs bus.emit choice** | LOCKED | Invoke iff caller needs result; else emit. Await is event/TCS; invokes parallel. |
| D-UI-31 | **ContextBus domain catalog v0** (§10.1b.0) | LOCKED | Identity, frames, scroll, tele/lab rows; bus.emit vs invoke per D-UI-30. |
| D-UI-32 | **Scrollable index** (Projected only, §10.2) | LOCKED | Incremental on table/CSSOM apply; census = O(\|index\|). No Virtual metadata. Shadow **in** (SI-06). |
| D-UI-33 | **Wheel/trackpad → scrollSet capture** | LOCKED | After local scroll: emit **last known absolute** position. **Coalesce 100ms** per target (`contextId`+`nodeId`). Keeps Virtual updated between clicks; click coherence = S6 census, not this path. |
| D-UI-34 | **Iframe pointer → root viewport** | LOCKED | Client maps nested iframe `(x,y)` to **root viewport** before enqueue. Sidecar never converts frame-local coords. Video: N/A (no nested DOM surface). |
| D-UI-35 | **Move coalesce (ClientBuffer)** | LOCKED | **50ms** coalesce per pointer (last wins) — same model as scroll, finer grain. **No flush** before down/up: down/up carry `(x,y)`; Applier always `moveTo` + census (D-UI-03, S6). |

### Rodrigo sign-off column (fill as we go)

| ID | Rodrigo |
|----|---------|
| D-UI-00 | LOCKED |
| D-UI-01 | LOCKED (dispatcher) |
| D-UI-01a | LOCKED (viewport + element) |
| D-UI-01b | LOCKED membership; stub v0; real = v1.1 |
| D-UI-01c | LOCKED |
| D-UI-04 / 05 / 06 | LOCKED (over-alloc R; subset window 1:1; no scale) |
| D-UI-12 | LOCKED (UTF-8 wire; fixed keymap KEY_* only) |
| D-UI-17 | LOCKED (drop oldest + coalesce + natural BP) |
| D-UI-21 | LOCKED |
| D-UI-22 | LOCKED (no wheel on Virtual) |
| D-UI-23 | LOCKED direction (MessagePack + lean + telemetry knobs) |
| D-UI-24 | LOCKED (scroll miss = drop + tele if on) |
| D-UI-25 | LOCKED (upload stub) |
| D-UI-02 / 03 / 03a / 03b | LOCKED |
| D-UI-05 / 05a | LOCKED (viewport stamp; no epoch) |
| D-UI-16 | LOCKED (reset/sanitize; virgin at start) |
| D-UI-28 | LOCKED (loopback mux) |
| D-UI-29 / 30 / 31 | LOCKED |
| D-UI-32 | LOCKED (§10.2 SI-01…06) |
| D-UI-08 / 09 / 10 / 15 / 18 / 19 | LOCKED |
| D-UI-27 | LOCKED (clean cutover) |
| D-UI-26 | LOCKED (S6) |
| D-UI-11 | LOCKED (direction — constant later) |
| D-UI-33 / 34 / 35 | LOCKED (capture) |
| D-UI-36 | LOCKED (tele) |
---

## 3. Architecture (**LOCKED**)

### 3.1 Pipeline (Rodrigo sketch — core)

```text
[Projected / Client]
  produce events → deposit ClientBuffer

[ClientBuffer]
  consumed by wire → send down the pipe as fast as possible
  (preserve order; no inventing / reordering)

[Sidecar]
  receive from pipe → deposit SidecarBuffer (order preserved)

[Sidecar consumer]
  drain SidecarBuffer → EventApplier.apply(event)

[EventApplier]  ← dispatcher contract
  sees event.type → forwards to the matching downstream contract:
    • IPointerPeripheral / IKeyboardPeripheral / IViewportLifecycle  (~99%)
    • IAbsoluteScroll / IFileUpload  (fine catalog v0)
```

**Layers (LOCKED idea):**

```text
buffers + wire          → transport / order
EventApplier            → dispatch by type (one consumer)
downstream contracts    → behaviour (peripheral vs fine)
implementations         → uinput, projection bus JS, upload mech, …
```

**Invariant:** one ordered stream. The Applier does not spawn parallel unordered applies for the same session (**D-UI-21 LOCKED**).

### 3.2 Applier contracts (shape)

```text
EventApplier
  apply(event) → void   // serialized; never reorder

uses:
  IPointerPeripheral      moveTo / button   // NO wheel
  IKeyboardPeripheral     key / type
  IViewportLifecycle      setViewport / reset / sanitize

  IAbsoluteScroll         // fine — projection bus → Virtual JS
    setViewportScroll(contextId, x, y)
    setElementScroll(contextId, nodeId, x, y)

  IFileUpload             setFiles(...)     // v0 stub — accept, no apply
```

#### 3.2a Fine-contract candidates (NOT in v0 — suggest only)

| Candidate | Why it might deserve fine later | Why keep out of v0 |
|-----------|----------------------------------|--------------------|
| **Unicode / insertText** | uinput keymap cannot type ã/emoji reliably | Latin-1 + fixed layout may suffice; reopen with D-UI-12 |
| **IME composition** | Dead keys / CJK need composition events | Explicitly post-v0 |
| **Drag-drop files onto page** | Related to upload but different UX than `<input type=file>` | Fold into upload when mechanism is designed |
| **Clipboard paste (large / rich)** | Paste of blob/HTML often bypasses key simulation | Rare until proven otherwise |
| **Native dialogs** / permissions | Browser chrome, not viewport intent | Session lifecycle, not input catalog |

**Not suggested as fine:** focus/blur/`input` value SET — stay **peripheral** (click + type). No Mode B revival.

### 3.3 Data flow (with peripherals under Applier)

```text
ClientBuffer ──wire──► SidecarBuffer ──► EventApplier
                                            ├─► IPointerPeripheral ──► uinput ABS ──► Xorg ──► Chromium
                                            ├─► IKeyboardPeripheral ─► uinput kbd ──► …
                                            ├─► IAbsoluteScroll ─────► projection bus → Virtual JS (SET)
                                            └─► IFileUpload ─────────► stub (v1.1)
```

**Client capture (D-UI-22 / D-UI-33 / D-UI-34 / D-UI-35):**

- **Wheel/trackpad:** Projected scrolls locally → `scrollSet` ABS (last known). Coalesce **100ms**/target. Never wire `wheel`.
- **Iframe pointer:** map to **root viewport** on client before enqueue (D-UI-34).
- **Move:** coalesce **50ms** (last wins). **No flush** before down/up — down/up own `(x,y)`; Applier `moveTo` + census handles click.
- **Click coherence:** S6 census on down/up — not scroll/move stream timing.
### 3.4 Per-session topology (peripheral side)

```text
Session[i]:
  compositor     Xorg dummy @ fixed resolution R
  browser        Chromium headful, borderless, --force-device-scale-factor=1
  devices        /dev/input/eventA  pointer ABS (range = R)
                   /dev/input/eventB  keyboard
  applier        single consumer of SidecarBuffer
  peripherals    owned by applier / writer single-thread
  supervisor     health, recreate device, sanitize
```

### 3.5 Identity coordinate model

Chain (all identity, no scale in hot path) — for **peripheral** pointer events:

```text
client viewport (x,y)
  == Chromium content viewport (x,y)
  == screen pixel (x,y)
  == uinput ABS (x,y)
```

Rules:

- Display + ABS allocated once at **R = Rw × Rh** (**over-alloc capacity** — headroom to work in).
- Chromium window = client **W × H** with W ≤ Rw, H ≤ Rh, at **(0,0)**, borderless, `--force-device-scale-factor=1`.
- That window is a **subset** of the over-alloc screen — content pixels stay **1:1** with client; unused region of R is empty margin, not a stretch target.
- uinput `ABS_X`/`ABS_Y` max = R−1. Pointer coords validated against **intent stamp** `viewportW`×`viewportH` (D-UI-05a). Outside → drop + tele (D-UI-03a).
- On resize: sidecar updates active `(W,H)`; intents with stale stamp → drop + tele. **No epoch counter.**
- Client asking for size > R → **cap** to R (never scale).

### 3.6 Peripheral surface (draft)

```text
IPointerPeripheral:
  moveTo(x, y)           → ABS_X, ABS_Y, SYN
  button(btn, down)      → BTN_*, SYN  (at current cursor)
  click(x, y, btn)       → moveTo → down → up
  // wheel: DEAD (D-UI-22)

IKeyboardPeripheral:
  key(code, down, modifiers?)  → KEY_* + mods, SYN
  type(text)                     → optional; plain chars only (fixed keymap)

IViewportLifecycle:
  reset() / sanitize()           → release all buttons/keys (virgin state)
  setViewport(w, h)              → sidecar active viewport (no epoch)
```

### 3.7 Intent envelope (wire — **LOCKED**; canonical §10.6)

| `schemaVersion` | u8 | **1** (v0) |
| `viewportW`, `viewportH` | u32 | Required on pointer intents (move/down/up). Stale vs sidecar active → drop + tele. |
| `type` | enum | **v0:** `move` \| `down` \| `up` \| `keyDown` \| `keyUp` \| `scrollSet` \| `setFiles` — **no `wheel`** |
| `x`, `y` | i32 | Pointer: viewport CSS px vs stamp W×H |
| `button` | u8 | 0 left, 1 middle, 2 right — same path (D-UI-03b) |
| `key`, `code` | string | Keyboard: keydown/keyup stream |
| `modifiers` | bitfield | alt/ctrl/meta/shift — on each key event (combos) |
| `census` | `ScrollCensus` | **Required** on PP `down`/`up`; **absent** on Video; sidecar drop+tele if PP missing |
| `contextId` | u32 | Required for `scrollSet` |
| `nodeId` | u32 \| null | `scrollSet` element target; null = viewport/document of that context |
| `scrollX`, `scrollY` | i32 | `scrollSet` absolute offsets |
| `text` / files payload | … | Optional `type(text)`; upload stub |
| `timestampClient` | f64 | Optional (omit when unused) |

**generation** not a dispatch gate.

### 3.8 Scroll ↔ pointer coherence (D-UI-26 / S6 — **LOCKED**)

**Fact:** peripheral click is viewport `(x,y)` + BTN. What sits under that pixel is determined by **scroll state** (document + scrollable ancestors). Client paints with *its* scroll; OS click hits *Virtual’s* scroll.

**Why D-UI-21 is not enough:** Applier can run `scrollSet` then `down` in order in the sidecar, but those take **different paths into Chrome**:

```text
scrollSet  → projection bus → Virtual JS (scrollTop/Left)
down       → uinput → Xorg → Chrome input
```

Kernel/OS delivery is not sequenced with in-page JS. Serial Applier ≠ serial hit-test.

**Also:** client may be local-first scrolled ahead of Virtual when the user presses.

**Design constraint:** fix coherence **without** (a) putting clicks on CDP as primary, (b) blocking the move stream, (c) fragile frame/generation sync.

#### Strategy (**LOCKED:** S6)

| ID | Strategy | Status |
|----|----------|--------|
| **S6** | Multi-context scroll census at click + Virtual apply before OS pointer | **LOCKED** |
| S1–S5 | Earlier candidates | superseded by S6 |
| CDP click when scroll recently changed | **REJECTED** |

#### S6 — Projected census + Virtual apply (**LOCKED**)

**Goal:** before OS click (and other enforce-before-apply intents), Virtual scroll world = Projected scroll world.

**Clean ContextBus cutover (D-UI-27):** no dual-stack / no version flag — all in-page bus traffic uses [context-bus.md](context-bus.md).

##### Vocabulary (LOCKED idea — do not mix)

| Layer | Words | Meaning |
|-------|--------|---------|
| **Domain** (projection / input) | e.g. `emitFrame`, `applyFrame`, census RPCs | Producer/consumer of the algorithm. **Does not know** ContextBus. Tomorrow the impl could change carrier; names stay. |
| **ContextBus** | `bus.emit` / `bus.invoke` | Transport only. `emit` = fire-and-forget event. `invoke` = RPC (= reserved transport events + TCS + idle timeout). **No domain semantics.** |

Domain `emitFrame` is **not** “a bus emit”. It is a domain operation. Its **implementation** may call `bus.invoke(...)` or `bus.emit(...)` per the rule below.

##### When domain impl uses `bus.invoke` vs `bus.emit` (**LOCKED** rule)

Awaiting an `invoke` does **not** block the JS thread, other in-flight invocations, or burn CPU while waiting — the protocol is event-based; a TCS completes on response or timeout and resumes the continuation. Invocations are **independent**: N `applyFrame` (or other) invokes may be in flight at once.

Therefore the choice is only about **caring for the result**:

| Need result? (ok/error for tele, desync, crash, retry, …) | Use |
|----------------------------------------------------------|-----|
| **Yes** | `bus.invoke` |
| **No** (fire-and-forget) | `bus.emit` |

Hot path (frames) may still use `invoke` if the caller needs apply/emit outcome — cost is not “thread stuck”, it is only the protocol chatter + handler work.

##### Two fabrics (do not confuse)

| Fabric | Where | Role for S6 |
|--------|-------|-------------|
| **ContextBus** | Projected heaps ↔ Projected runtime | Index + census snapshot |
| **ContextBus** | Virtual heaps ↔ Virtual runtime | Apply scroll positions |
| **Loopback WS** (D-UI-28) | Virtual root ↔ sidecar only | Sidecar asks Virtual to run apply; not used for Projected census |

Scrollable **index** lives only on **Projected**. Virtual does not maintain a scrollable-node index — it only **applies** absolute positions when told.

##### Projected — per context

- Maintain index of scrollable nodes per §10.2 (D-UI-32) — apply hooks; census O(\|index\|).
- On nested **host create/destroy**: `emit` to `CONTEXT_BUS_RUNTIME` so runtime keeps live set of JS contexts (**including root**).

##### Projected — census RPC (**LOCKED**)

```text
Emitter (any Projected context)
  → invoke(CONTEXT_BUS_RUNTIME, "snapshotScrollPositionsFromAllContexts", …)

Runtime (servesRuntime):
  for each known contextId (parallel):
    invoke(contextId, "snapshotScrollPosition", …)
    // per-call idle timeout (ContextBus)
  if ANY fail → whole census fails (fail-closed)
  else → ScrollCensus aggregate

Emitter
  → if !ok: abort click + tele (knob)
  → if ok: attach census to intent → ClientBuffer
```

| Invocation | Destination | Returns |
|------------|-------------|---------|
| `snapshotScrollPositionsFromAllContexts` | `CONTEXT_BUS_RUNTIME` | full `ScrollCensus` or error |
| `snapshotScrollPosition` | one `contextId` | that context’s positions (viewport + indexed scrollables) |

##### Sidecar Applier — two-phase (same wire event)

```text
Phase A — enforce scroll on Virtual (await):
  sidecar → loopback invoke → Virtual root runtime
    → parallel ContextBus invoke(contextId, "applyScrollPositions", slice)
    → await all (fail-closed — any !ok ⇒ whole apply fails)

Phase B — OS pointer:
  moveTo + BTN via peripheral
  // Phase A !ok ⇒ Phase B **must not run** (LOCKED)
```

| Invocation | Where | Meaning |
|------------|-------|---------|
| `applyScrollCensus` | sidecar → Virtual (loopback) | carry census; kick Virtual runtime fan-out |
| `applyScrollPositions` | Virtual runtime → each `contextId` | SET scrollX/Y for listed nodes |

##### Fail rules (**LOCKED**)

Any Projected census RPC failure ⇒ **click does not leave client** (+ tele).  
Virtual apply failure ⇒ Applier **must not** run Phase B (+ tele).  
See §10.4 / §10.5.

##### Why this shape

- Projected knows what the user sees; Virtual only mirrors absolute SETs.
- Runtime owns fan-out on both sides; emitters do not peer-scan.
- ContextBus stays domain-agnostic; names above are **domain protocols** (§10.1b).
- Loopback is a **different** proto (D-UI-28) — typed mux Virtual↔sidecar.

##### Resolved (see §10.1b / §10.1c / §10.7)

- Host admitted/dropped event names — §10.1b.5
- Loopback envelope (kinds: frame / telemetry / invoke / invoke-result) — §10.1c
- Virtual apply miss (`nodeId` gone) vs scroll SET miss — §10.1b / D-UI-24 / §10.4

**Still OPEN (non-blocking):** parallel fan-out concurrency cap (default: unbounded).

**Bus transport:** SEALED — [context-bus.md](context-bus.md).

---

## 4. Why not hybrid REL move + ABS click

evdev fact: **`BTN_LEFT` carries no position.** Press applies where the cursor is.

If moves are REL + OS acceleration, cursor position is non-deterministic unless continuously re-anchored. Every click already requires exact `(x,y)` via move-before-press. REL does not remove that requirement; it adds soft-cursor state (`OsInputBackend` today: `_curX/_curY`, home-warp, `REL_CHUNK`).

Human path from client is already the real motion curve — re-accelerating on host is synthetic, not antibot-faithful.

**Conclusion (LOCKED):** one ABS pointer device. **Wheel dead** — scroll position only via absolute SET fine contract (D-UI-22).

---

## 5. Risks & spike plan (D-UI-20)

Historical failure (current `uinput.ts` comment): ABS pointer under xf86-input-evdev **failed to deliver core clicks to Chrome** → codebase fell back to REL-only pointer.

Spike must prove, on target stack:

1. Create ABS uinput device, range = R, `INPUT_PROP_POINTER`.
2. Bind via Xorg `InputDevice` with explicit `/dev/input/eventN` path.
3. Launch Chromium headful on dummy display R, window W×H.
4. `moveTo(x,y)` + click → hit target at `(x,y)` (DOM probe or screenshot oracle).
5. Repeat after soft resize W'×H' with viewport-stamp validation.

If fail: iterate **bind/compositor/device props** — not REL fallback.

---

## 6. Status inventory

### Design v0 — **LOCKED** (decisions)

Pipeline, Applier, peripherals, S6, ContextBus domain, loopback, scroll index, capture (D-UI-33/34/35), wire envelope (§10.6), tele pattern (§10.7), batch B, cutover law.

Formal contract sections: **§10.3–§10.7** (this draft).

### Not design — execution / promotion

| Item | Status |
|------|--------|
| **D-UI-20** spike ABS→Chrome | Engineering gate |
| **D-UI-11** numeric R constant | Product tuning (direction locked) |
| **Cutover** D-UI-27 | Implement + delete legacy paths |
| **MotorAssert / lab** | Blueprints |
| **Promote draft** → normative `input.md` | After spike + review |
| **multi-doc §4** | Amend to ContextBus |

### Deferred v0

Touch, IME/insertText, real upload (v1.1), container-per-session, Wayland, `overflow:hidden` scroll index edge.

---

## 7. Promotion checklist (draft → normative spec)

- [ ] All D-UI-* rows `LOCKED` or `REJECTED` with Rodrigo sign-off
- [ ] D-UI-20 spike PASS recorded (commands, env, oracle)
- [ ] Intent envelope + peripheral + fine APIs frozen
- [ ] Session contract updates in [browser-session.md](browser-session.md)
- [ ] Architecture cross-ref in [architecture.md](../../architecture.md) (Video + PageProjection same input)
- [ ] Supersession row in [decision-log.md](decision-log.md)
- [ ] [README.md](README.md) conflict table updated
- [ ] Old docs marked superseded / archived
- [ ] Code deletion list written (files/types to remove)
- [ ] MotorAssert / lab blueprints for input accept

---

## 8. Session log (append-only)

| Date | Who | Note |
|------|-----|------|
| 2026-08-23 | Agent + Rodrigo | Draft created. Unified OS input; discard CDP A/B/C + REL pointer. Identity model + epoch resize. Decisions D-UI-01..20 registered OPEN/PROPOSED. |
| 2026-08-23 | Rodrigo | Pipeline: ClientBuffer → wire asap → SidecarBuffer (order) → Applier. Applier = contract: peripherals ~99%; fine contracts for absolute scroll SET (`contextId`, projection bus) and file upload. Amended one-liner, discard list, D-UI-00/01/01a/01b/01c/21/22, §3. |
| 2026-08-23 | Rodrigo | LOCKED: D-UI-00, 01, 01a (viewport+element), 01b, 01c (v0=scroll+upload), 21 (serial), 22 (wheel dead). Candidates §3.2a not in v0. |
| 2026-08-23 | Rodrigo | Clarified: Applier = dispatcher over layered contracts. §6 rewritten as open inventory A–E. |
| 2026-08-23 | Rodrigo | Slice: LOCKED 04/05/06 (over-alloc+subset 1:1), 12 (UTF-8 wire / keymap KEY_*), 17 (drop oldest+coalesce+natural BP), 23 (MessagePack lean+tele knobs), 24 (scroll miss drop+tele), 25 (upload stub v1.1). Numeric R still OPEN. |
| 2026-08-23 | Rodrigo | Raised D-UI-26: OS click viewport coords vs Virtual scroll (cross-path race). §3.8 candidates S1–S5. |
| 2026-08-23 | Rodrigo | Proposed S6: client multi-context scroll census on click; sidecar two-phase (await Virtual scrolls → OS click). Concept validation pending detail pass. |
| 2026-08-23 | Rodrigo | S6 topology: host create/destroy → runtime registry; census via event to runtime then fan-out RPC + per-context timeout; any fail ⇒ whole click fail + tele. |
| 2026-08-23 | Agent | §10 contracts review queue; **§10.1 Bus + protocol** drafted for Rodrigo review (registry loose events, getScrollSnapshot / collectScrollCensus RPCs, TS interfaces). |
| 2026-08-23 | Rodrigo | Reframe: bus = dumb JS transport only (envelope, emit, invoke+heartbeat TCS). Domain protocols on top. §10.1 rewritten; census → §10.1b. Name TBD. |
| 2026-08-23 | Rodrigo | Name LOCKED **ContextBus**. Spec split to [context-bus.md](context-bus.md). Input draft §10.1 → pointer only. |
| 2026-08-23 | Rodrigo | **ContextBus SEALED** (CB-01…CB-13). Resume input at §10.1b. |
| 2026-08-23 | Rodrigo | S6 refined: Projected index+census only; Virtual apply via loopback+ContextBus; clean bus cutover; new D-UI-28 loopback mux proto. |
| 2026-08-23 | Agent | Order: **10.1b first** (REVIEW drafted), then 10.1c loopback. Master backlog §11 added. |
| 2026-08-23 | Rodrigo | Corrected: invoke await is event/TCS (non-blocking, parallel OK). Domain emitFrame ≠ bus.emit. Rule: invoke iff need result, else emit. D-UI-29/30 LOCKED. |
| 2026-08-23 | Agent | §10.1b.0 domain catalog v0 proposed (identity, frames, scroll, tele/lab) with bus.emit vs invoke per row. |
| 2026-08-23 | Rodrigo | Catalog §10.1b.0 **LOCKED** as proposed (D-UI-31). Next: 10.1c loopback or micro-opens (census down/up). |
| 2026-08-23 | Rodrigo | Topou §10.1c shape. Drafted REVIEW + OPEN sheet LB-01…LB-07. |
| 2026-08-23 | Rodrigo | §10.1c / D-UI-28 / LB-01…LB-07 **LOCKED**. |
| 2026-08-23 | Rodrigo | §10.2 / D-UI-32 / SI-01…05 **LOCKED**: Projected index on apply; census O(\|index\|); no Virtual metadata. |
| 2026-08-23 | Rodrigo | Census on pointer **down and up** LOCKED (not down-only). |
| 2026-08-23 | Rodrigo | Shadow in scrollable index LOCKED (SI-06). Phase A fail ⇒ skip Phase B LOCKED. Video: no separate census — S6 PageProjection-only. |
| 2026-08-23 | Rodrigo | §10.3 A: ABS LOCKED; always moveTo on down+up; OOB coords = drop+tele; no synthetic moves. |
| 2026-08-23 | Rodrigo | Viewport stamp W×H on pointer intents (no epoch). Device reset/sanitize LOCKED. Keyboard = key stream + modifiers for combos. |
| 2026-08-23 | Rodrigo | S6 apply fan-out fail-closed LOCKED. Batch B: D-UI-08/09/10/18/19 LOCKED. D-UI-26 S6 LOCKED. |
| 2026-08-23 | Rodrigo | D-UI-15/27 LOCKED. D-UI-11 direction LOCKED (R covers any device). Draft synced to full session decisions. |
| 2026-08-23 | Rodrigo | D-UI-33 LOCKED: wheel→scrollSet last known ABS; coalesce 100ms/target; Virtual kept fresh; click = census not scroll stream. |
| 2026-08-23 | Rodrigo | D-UI-34/35 LOCKED: iframe→root client-side; move coalesce 50ms (no rAF, no flush). §10.6/10.7 locked (not questions). |
| 2026-08-23 | Agent | **§10.3–§10.7 formal sections written** (peripherals, Applier Phase A/B, routing, wire, tele). §6 inventory + §11 backlog synced. Design v0 contract slice complete. |

---

## 9. References (current code — will be deleted)

| Area | Path |
|------|------|
| REL pointer + soft cursor | `Refactor/sidecar/browser/patchright/input/OsInputBackend.ts` |
| uinput device open (REL pointer) | `Refactor/sidecar/browser/patchright/input/uinput.ts` |
| CDP input backend | `Refactor/sidecar/browser/patchright/input/PatchrightInputBackend.ts` |
| Xorg dummy + InputDevice bind | `Refactor/sidecar/browser/patchright/Display.ts` |
| Backend selection | `Refactor/sidecar/browser/patchright/PatchrightBrowserSession.ts` |
| PP input dispatch | `Refactor/sidecar/browser/mirror/projection/input/` |
| Normative (to supersede) | [input-v2.md](input-v2.md) |
| Existing bus (extend, do not fork blindly) | `Refactor/packages/page-projection/src/virtual/bus/projectionBus.ts` |
| Multi-doc bus rules | [multi-document.md](multi-document.md) §4 |

---

## 10. TypeScript contracts (review queue)

> **Rule:** each subsection is a contract surface. Rodrigo reviews **one at a time**. Status: `DRAFT` → `REVIEW` → `ACCEPTED` / `REVISE`.
> These types are design truth for the future package; they are **not** implemented yet.
> **Layering:** §10.1 = dumb reusable **transport** between JS contexts. Domain protocols (registry, scroll census, mint, frames, …) sit **on top** — they are not the bus.

| § | Contract | Status |
|---|----------|--------|
| **10.1** | **ContextBus** (transport) | **SEALED** → [context-bus.md](context-bus.md) |
| **10.1b** | Domain protocols on ContextBus (registry + frames + scroll + lab) | **LOCKED** |
| 10.1c | Virtual↔sidecar loopback mux (D-UI-28) | **LOCKED** |
| 10.2 | Scrollable index (per context) maintenance rules | **LOCKED** (D-UI-32) |
| 10.3 | Pointer / keyboard / viewport peripherals | **LOCKED** |
| 10.4 | Fine contracts + Applier Phase A/B | **LOCKED** |
| 10.5 | EventApplier (dispatcher) | **LOCKED** |
| 10.6 | ClientBuffer / SidecarBuffer / wire MessagePack | **LOCKED** |
| 10.7 | Input telemetry capabilities | **LOCKED** |

**Order chosen:** 10.1b → 10.1c → 10.2 → 10.3 → 10.4 → 10.5 → 10.6 → 10.7 (**done** in this draft).

---

### 10.1 ContextBus — moved

**Canonical spec:** **[context-bus.md](context-bus.md)** (**SEALED**).

---

### 10.1b ContextBus domain — catalog + scroll + frames — REVIEW

> Uses [context-bus.md](context-bus.md) only as transport.  
> **D-UI-29:** domain names ≠ `bus.emit`/`bus.invoke`.  
> **D-UI-30:** implementation uses `bus.invoke` iff the caller needs a result; else `bus.emit`.  
> Clean cutover (D-UI-27). Frames are in this catalog too — same bus, same rules.

#### 10.1b.0 Domain catalog v0 (**LOCKED** 2026-08-23)

**Legend:** Bus column = what the **implementation** calls on ContextBus (not the domain name).

##### Identity / lifecycle (multi-doc)

| Domain API (conceptual) | Bus | Dest | Who calls | Who handles | Why bus choice |
|-------------------------|-----|------|-----------|-------------|----------------|
| `getScopeId()` | **invoke** `getScopeId` | parent context (not RUNTIME) | nested algorithm | parent algorithm | need `C` or retry |
| `mint()` | **invoke** `mint` | `CONTEXT_BUS_RUNTIME` | algorithm admitting host | Virtual/Projected runtime | need new `contextId` |
| host admitted | **emit** `contextHostAdmitted` | `CONTEXT_BUS_RUNTIME` | parent (after mint/install) | runtime registry | notify only |
| host dropped | **emit** `contextHostDropped` | `CONTEXT_BUS_RUNTIME` | parent | runtime registry | notify only |
| root online | **emit** `contextRootOnline` | `CONTEXT_BUS_RUNTIME` | root bus boot | runtime registry | notify only |

##### Frames (projection producer/consumer)

| Domain API | Bus | Dest | Who calls | Who handles | Why bus choice |
|------------|-----|------|-----------|-------------|----------------|
| `emitFrame(bytes)` | **invoke** `emitFrame` | `CONTEXT_BUS_RUNTIME` | Virtual algorithm (any ctx) | Virtual runtime → sidecar | need ok/error (backpressure, deferred, fault → desync/tele) |
| `applyFrame(bytes)` | **invoke** `applyFrame` | target `contextId` | Projected runtime (after sidecar delivers) | Projected algorithm in that ctx | need ok/error (apply fail → desync) |

Notes:
- Domain name `emitFrame` stays; impl is `bus.invoke('emitFrame', { bytes }, { destination: RUNTIME })`.
- Many frames may be in flight (independent invokes). No requirement to await frame N before starting N+1.
- Projected runtime routes by frame header `contextId` to `invoke(contextId, 'applyFrame', …)`.

##### Scroll census / apply (S6 / input)

| Domain API | Bus | Dest | Who calls | Who handles | Why bus choice |
|------------|-----|------|-----------|-------------|----------------|
| `snapshotScrollPositionsFromAllContexts()` | **invoke** | `CONTEXT_BUS_RUNTIME` | Projected click path | Projected runtime | need full census or fail |
| `snapshotScrollPosition()` | **invoke** | one `contextId` | Projected runtime | that Projected ctx | need snapshot or fail |
| `applyScrollPositions(positions)` | **invoke** | one `contextId` | Virtual runtime | that Virtual ctx | need ok / missingNodeIds |

##### Lab / observability / recovery (migrate from legacy bus)

| Domain API | Bus | Dest | Who calls | Who handles | Why bus choice |
|------------|-----|------|-----------|-------------|----------------|
| `emitTelemetry(msg)` | **emit** `telemetry` | `CONTEXT_BUS_RUNTIME` | any ctx | runtime → sidecar | result unused (best-effort) |
| `requestSnapshot(contextId, opts)` | **invoke** `snapshot` | that `contextId` (or routed) | lab/runtime | target ctx | need snapshot payload |
| `resumeContext(contextId)` | **invoke** `resumeContext` | that `contextId` | lab/runtime | target ctx | need ok |
| resync fan-down notify | **emit** `resyncRequest` | `*` or each nested | Projected root after Control-plane entry | nested producers | notify only; entry remains Control plane / loopback later |

##### Explicitly not ContextBus domain (other carriers)

| Concern | Carrier |
|---------|---------|
| Sidecar ↔ Virtual root bytes (frames in/out, apply-census kick, …) | **Loopback mux** §10.1c (D-UI-28) |
| Client ↔ hub intents | MessagePack session wire §10.6 |
| Resync **entry** from Projected UI | session Control plane (existing ruling) — not upward bus |

#### 10.1b.1 Shared scroll payloads

```ts
/** One scrollable: viewport (nodeId null) or element. */
export type ScrollPositionEntry = {
  nodeId: number | null;
  scrollX: number;
  scrollY: number;
};

/** One browsing context’s scroll state. */
export type ContextScrollSnapshot = {
  contextId: number;
  positions: readonly ScrollPositionEntry[];
};

/**
 * Full census — attached to enforce-before-apply intents (click, …)
 * and sent sidecar → Virtual for apply.
 */
export type ScrollCensus = {
  /** Optional journal. */
  capturedAtMs?: number;
  contexts: readonly ContextScrollSnapshot[];
};
```

#### 10.1b.2 Events (Projected → runtime) — `emit`

Destination: **`CONTEXT_BUS_RUNTIME`** (unicast). Root must also announce itself at boot (see §10.1b.5).

```ts
/** Nested host admitted — child context is live. */
export type ContextHostAdmittedEvent = {
  parentContextId: number;
  contextId: number; // child
  hostNodeId: number;
};

/** Nested host gone — drop child from registry. */
export type ContextHostDroppedEvent = {
  parentContextId: number;
  contextId: number;
  hostNodeId: number;
};

/** Root document bus came up — ensure runtime list includes root. */
export type ContextRootOnlineEvent = {
  contextId: 1; // root document id
};

/** Event `type` strings (ContextBus emit). */
export const CTX_EVENT_HOST_ADMITTED = 'contextHostAdmitted' as const;
export const CTX_EVENT_HOST_DROPPED = 'contextHostDropped' as const;
export const CTX_EVENT_ROOT_ONLINE = 'contextRootOnline' as const;
```

```text
emit(CTX_EVENT_HOST_ADMITTED, payload, { destination: CONTEXT_BUS_RUNTIME })
emit(CTX_EVENT_HOST_DROPPED,  payload, { destination: CONTEXT_BUS_RUNTIME })
emit(CTX_EVENT_ROOT_ONLINE,   { contextId: 1 }, { destination: CONTEXT_BUS_RUNTIME })
```

Runtime `onEvent` updates `IContextRegistry` (same shape as earlier draft).

#### 10.1b.3 Invocations — names

| `name` | Who registers `onInvocation` | Who calls `invoke` | Side |
|--------|------------------------------|--------------------|------|
| `snapshotScrollPositionsFromAllContexts` | Projected runtime | click emitter (any Projected ctx) | Projected |
| `snapshotScrollPosition` | each Projected document context | Projected runtime (fan-out) | Projected |
| `applyScrollPositions` | each Virtual document context | Virtual runtime (fan-out) | Virtual |

```ts
export const RPC_SNAPSHOT_ALL = 'snapshotScrollPositionsFromAllContexts' as const;
export const RPC_SNAPSHOT_ONE = 'snapshotScrollPosition' as const;
export const RPC_APPLY_SCROLL = 'applyScrollPositions' as const;

/** Args for snapshot all — empty for v0. */
export type SnapshotScrollPositionsFromAllContextsArgs = Record<string, never>;

export type SnapshotScrollPositionsFromAllContextsResult = ScrollCensus;

/** Args for one context — empty; context is invoke destination. */
export type SnapshotScrollPositionArgs = Record<string, never>;

export type SnapshotScrollPositionResult = ContextScrollSnapshot;

/** Apply slice for one Virtual context (subset of census). */
export type ApplyScrollPositionsArgs = {
  positions: readonly ScrollPositionEntry[];
};

/** Per-node outcomes optional for tele; v0 may return void ok. */
export type ApplyScrollPositionsResult = {
  /** nodeIds that were missing — empty if all applied. */
  missingNodeIds: readonly number[];
};
```

#### 10.1b.4 Algorithms (domain — on top of ContextBus)

**Projected census (fail-closed):**

```text
snapshotScrollPositionsFromAllContexts():
  ids = registry.list()  // includes root
  results = await Promise.allSettled(
    ids.map(id => bus.invoke(RPC_SNAPSHOT_ONE, {}, { destination: id }))
  )
  if any !ok or rejected → return InvokeResult ok:false
     error.message = 'census_partial_failure' (include failedContextId if known)
  else → ok:true, value: { contexts: [...], capturedAtMs? }
```

**Projected one-context snapshot:**

```text
snapshotScrollPosition():
  return {
    contextId: mine,
    positions: [
      { nodeId: null, scrollX: viewportX, scrollY: viewportY },
      ...indexedScrollables.map(...)
    ]
  }
```

**Virtual apply one-context:**

```text
applyScrollPositions({ positions }):
  missing = []
  for entry in positions:
    if entry.nodeId === null → set viewport/document scroll
    else if node missing → missing.push(nodeId)  // do not throw
    else → el.scrollLeft/scrollTop = …
  return { missingNodeIds: missing }
```

**Virtual runtime fan-out** (triggered via loopback — §10.1c):

```text
applyScrollCensus(census: ScrollCensus):
  for each contextSnap in census.contexts (parallel):
    invoke(RPC_APPLY_SCROLL, { positions }, { destination: contextSnap.contextId })
  if any invoke !ok → fail whole apply (**LOCKED** — fail-closed; align census)
  // missingNodeIds alone do NOT fail the whole apply (align D-UI-24: drop+tele per node)
```

#### 10.1b.5 Boot / teardown

| Moment | Action |
|--------|--------|
| Projected root bus ready | `emit(CTX_EVENT_ROOT_ONLINE, { contextId: 1 }, { destination: RUNTIME })` |
| Nested host admitted | parent `emit(CTX_EVENT_HOST_ADMITTED, …)` |
| Nested host dropped | parent `emit(CTX_EVENT_HOST_DROPPED, …)` |
| Projected runtime start | `onEvent` for three events; `onInvocation(RPC_SNAPSHOT_ALL)` |
| Each Projected context start | `onInvocation(RPC_SNAPSHOT_ONE)`; maintain scrollable index (§10.2) |
| Each Virtual context start | `onInvocation(RPC_APPLY_SCROLL)` only |
| Virtual runtime | fan-out helper for apply; no scrollable index |

#### 10.1b.6 Who uses census (wire)

Intents that **must** attach `ScrollCensus` before dispatch (enforce-before-apply):

| Intent | Census? |
|--------|---------|
| pointer `down` | **yes** — census + Phase A before OS press (**LOCKED**) |
| pointer `up` | **yes** — census + Phase A before OS release (**LOCKED**) |
| standalone `scrollSet` | **no** — *is* the scroll truth |
| `move` | **no** |
| `key*` | **no** |
| upload stub | **no** |

**Why both (Rodrigo 2026-08-23):** `up` without re-census can hit-test the wrong Virtual content if scroll moved during hold/drag. Wire `up` may carry `(x,y)`; OS `BTN` has no position — Applier still `moveTo` then release when coords matter. Cost is **2×** the enforce path per click gesture; accepted because each census is index read **O(\|index\|)** + in-page ContextBus fan-out (no full DOM walk, no Virtual metadata). Not free O(1): still await Runtime fan-out + loopback Phase A + Virtual apply — but no expensive discovery.

**Scope — PageProjection only:** S6 census answers “Projected scroll tree ≠ Virtual scroll tree”. **VideoStreaming** does not mirror scrollable DOM or player controls — Projected shows the `<video>` asset; Virtual plays as display proxy. Same intent types + same peripheral OS path (D-UI-19), but **no `ScrollCensus` attach** on Video clicks (nothing to sync). Not a separate “Video rule” — census simply does not apply outside PageProjection.

**Sidecar (LOCKED):** Phase A (`applyScrollCensus`) failure ⇒ **do not** run Phase B (OS pointer). Fail intent + tele (knob).

#### 10.1b.7 Status after catalog lock

| Item | State |
|------|--------|
| Catalog §10.1b.0 (all rows) | **LOCKED** |
| `emitFrame` / `applyFrame` → `bus.invoke` | **LOCKED** |
| `telemetry` → `bus.emit` | **LOCKED** |
| `getScopeId` → parent (not RUNTIME) | **LOCKED** |
| `ContextRootOnline` required at root boot | **LOCKED** (as proposed) |
| Census fail-closed | **LOCKED** (as proposed) |
| Virtual `missingNodeIds` soft (do not fail whole apply on miss alone) | **LOCKED** (as proposed) |
| Phase A fail ⇒ skip Phase B (no OS pointer) | **LOCKED** |
| Virtual apply fan-out fail-closed | **LOCKED** — any context invoke !ok ⇒ whole apply fails |
| Census on `down` + `up` | **LOCKED** — both (hold+scroll / drag; see §10.1b.6 note) |
| Fan-out concurrency cap | **OPEN** — default unbounded parallel invokes (ContextBus); cap only if measured need |

#### 10.1b.8 Explicitly deferred to later §§

| Item | Where |
|------|-------|
| How scrollable index is maintained | **§10.2 LOCKED** |
| MessagePack intent field for census | **§10.6 LOCKED** |
| Applier Phase A/B wiring | **§10.4 / §10.5 LOCKED** |
| Input tele events for census/apply failure | **§10.7 LOCKED** |

---

### 10.1c Virtual ↔ sidecar loopback mux — **LOCKED**

**Status:** **LOCKED** (2026-08-23).  
**ID:** D-UI-28.  
**Law:** exclusive link **Virtual root RUNTIME ↔ sidecar**. Not ContextBus. Not hub↔client. Carrier-agnostic (lab WS today; prod may use CDP binding / other — same envelope).

#### 10.1c.0 One-liner

Typed mux: one channel flag + `kind` discriminator. Fire-and-forget kinds (`frame`, `telemetry`) vs request/response (`invoke` / `invoke-result`) when the caller needs a result — same *rule* as D-UI-30, different carrier.

```text
Virtual RUNTIME  ←—— loopback mux ——→  sidecar
```

#### 10.1c.1 Envelope

```ts
export const VIRTUAL_LOOPBACK_CHANNEL = 'speculum.virtual.loopback' as const;

export type LoopbackKind = 'frame' | 'telemetry' | 'invoke' | 'invoke-result';

export type LoopbackEnvelope =
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'frame';
      /** PP frame bytes (header already carries contextId). */
      bytes: Uint8Array;
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'telemetry';
      message: unknown; // ProjectionTelemetryMessage when wired
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'invoke';
      correlationId: number; // u32 monotonic per sidecar session end
      name: string;
      args: unknown;
    }
  | {
      channel: typeof VIRTUAL_LOOPBACK_CHANNEL;
      kind: 'invoke-result';
      correlationId: number;
      ok: boolean;
      value?: unknown;
      error?: { message: string; name?: string };
    };
```

**Malformed** (wrong/missing `channel`, bad kind, …) → drop silently on receive.

#### 10.1c.2 Directions

| kind | Direction | Meaning |
|------|-----------|---------|
| `frame` | Virtual → sidecar | Runtime forwards domain `emitFrame` success path to session DataPlane / encode |
| `telemetry` | Virtual → sidecar | Best-effort tele |
| `invoke` | sidecar → Virtual | Sidecar needs a result from Virtual RUNTIME |
| `invoke-result` | Virtual → sidecar | Completes sidecar TCS |

No `invoke` Virtual→sidecar in v0 (frames/tele are FF). If later needed, add symmetrically.

#### 10.1c.3 Invoke names v0 (closed list — expand by decision)

| `name` | Args | Result | Used by |
|--------|------|--------|---------|
| `applyScrollCensus` | `{ census: ScrollCensus }` | `{ ok: true }` or error | Applier Phase A before OS click |

**PROPOSED later (not v0):** `publishResyncRequest`, lab `snapshot`/`resume` entry — keep Control-plane/session rulings until explicitly moved.

#### 10.1c.4 `applyScrollCensus` sequence

```text
Sidecar Applier (pointer down with census):
  send invoke { name: 'applyScrollCensus', args: { census }, correlationId }
  await invoke-result (idle timeout — OPEN LB-04)
  if !ok → do NOT Phase B OS click; tele if knob on
  if ok  → Phase B peripheral click

Virtual RUNTIME on applyScrollCensus:
  for each context in census.contexts (parallel ContextBus invoke):
    applyScrollPositions
  if any ContextBus invoke !ok → invoke-result ok:false
  else → ok:true
  // missingNodeIds soft — does not alone fail (10.1b LOCKED)
```

#### 10.1c.5 Relation to ContextBus domain catalog

| Domain (in-page) | Loopback |
|------------------|----------|
| Virtual `emitFrame` → RUNTIME (ContextBus invoke) | RUNTIME on success → `kind: 'frame'` to sidecar |
| Projected census (ContextBus) | stamp on session wire → sidecar |
| Virtual `applyScrollPositions` (ContextBus) | kicked by loopback `applyScrollCensus` |

#### 10.1c.6 Explicitly out of scope

- Projected ↔ hub MessagePack
- ContextBus iframe fabric
- User-facing resync entry (session Control plane — existing ruling)
- Replacing CDP vs loopback **carrier** choice for Live PP frames (session still picks carrier; **envelope** is shared)

#### 10.1c.7 Decisions (**LOCKED**)

| ID | Decision |
|----|----------|
| **LB-01** | Channel = `speculum.virtual.loopback` |
| **LB-02** | Frame payload = `bytes` only (contextId in PP header) |
| **LB-03** | v0 invoke names = only `applyScrollCensus` |
| **LB-04** | Invoke idle timeout default = **2000ms** |
| **LB-05** | `correlationId` = **u32** monotonic per sidecar writer |
| **LB-06** | Codec = **MessagePack** (`LoopbackEnvelope`; frame bytes as bin) |
| **LB-07** | Replace today’s `PlaneChannel` — map onto kinds; clean cutover with D-UI-27 |

#### 10.1c.8 Done

Section locked. Expand invoke name list only by new decision row.

---

### 10.2 Scrollable index (Projected only) — **LOCKED**

**Status:** **LOCKED** (2026-08-23).  
**ID:** D-UI-32.  
**Law:** each Projected document context maintains a **local index** of element scrollables. `snapshotScrollPosition` reads that index only — **no full-tree walk on click**. Virtual does **not** annotate scrollability on the wire and does **not** keep this index.

#### 10.2.0 Goals

| Goal | Rule |
|------|------|
| Cheap census | Click path cost = **O(\|index\|)** (+ viewport) |
| Cheap maintenance | Update **incrementally** on the same Projected **table/CSSOM apply** path that already touches the node |
| Truth | Index is a cache of live Projected DOM; Virtual metadata **forbidden** |

#### 10.2.1 Structure (per Projected context)

```text
scrollableIndex: Set<nodeId>   // element scrollables only
// viewport / document scroll is ALWAYS included in snapshot; not stored in the set
```

Optional impl detail: `Map<nodeId, Element>` for O(1) resolve — same contract.

#### 10.2.2 Predicate `isScrollable(el)` (v0)

```text
overflowX or overflowY (computed) ∈ { auto, scroll, overlay }
AND (scrollWidth > clientWidth OR scrollHeight > clientHeight)
```

- Use `getComputedStyle` on the element under recheck (not producer hints).
- `overflow: hidden` with programmatic scroll only: **out of v0 index** (OPEN if product later needs it).
- Viewport/`documentElement`/`body` document scroll: handled as the **null `nodeId`** snapshot entry — not via this set.

#### 10.2.3 Maintenance hooks (on Projected apply)

Hook the **existing** apply path — do **not** add a parallel MutationObserver for index truth.

| Apply event | Action |
|-------------|--------|
| `NODE_CREATE` / insert (element) | `recheck(nodeId)` |
| `NODE_DROP` / remove | remove `nodeId` from index (and descendants if apply already enumerates them) |
| ATTR / style / class that can change overflow or box | `recheck(nodeId)` |
| CSSOM apply affecting this context | mark dirty → `recheck` **indexed ∪ recently touched** nodes at **end of batch** or next rAF — **not** a full DOM walk |

```text
recheck(nodeId):
  el = table.resolve(nodeId)
  if !el → remove from index; return
  if isScrollable(el) → add to index
  else → remove from index
```

`recheck` cost: one computed style + size compares on **that** node only.

#### 10.2.4 Snapshot (ties to §10.1b)

```text
snapshotScrollPosition():
  positions = [
    { nodeId: null, scrollX, scrollY },   // viewport/document — always
    ...for nodeId in scrollableIndex:
         { nodeId, scrollX: el.scrollLeft, scrollY: el.scrollTop }
  ]
  return { contextId, positions }
```

No discovery walk here. If the index is stale vs DOM, that is an apply-hook bug — fix the hooks, do not walk on click.

#### 10.2.5 Explicitly out / OPEN

| Item | State |
|------|--------|
| Virtual producer scrollable metadata on frame nodes | **REJECTED** |
| Full-tree walk on census | **REJECTED** |
| Shadow-root scrollables in index | **LOCKED** — same hooks as light DOM (SI-06) |
| `overflow: hidden` scroll containers | **OPEN** (out of v0 predicate) |
| Video “census shortcut” | **N/A** — S6 is PageProjection scroll-mirror only; Video has no projected scroll tree (see §10.1b.6) |

#### 10.2.6 Decisions (**LOCKED**)

| ID | Decision |
|----|----------|
| **SI-01** | Index lives **Projected-only**, per document context |
| **SI-02** | Census reads index only — **O(\|index\|)** |
| **SI-03** | Maintain on **table/CSSOM apply** hooks; no Virtual wire metadata |
| **SI-04** | Predicate v0 = overflow auto/scroll/overlay **and** overflow size |
| **SI-05** | Viewport always in snapshot; not in the element set |
| **SI-06** | Shadow-root scrollables **in** index — same `recheck` hooks as light DOM |

---

### 10.3 Peripherals (pointer / keyboard / viewport) — **LOCKED**

**Status:** **LOCKED** (2026-08-23).  
**IDs:** D-UI-02, D-UI-03, D-UI-03a, D-UI-03b, D-UI-05, D-UI-05a, D-UI-12, D-UI-16.

#### 10.3.0 Law

One **ABS** pointer device + one keyboard per session. Sidecar Applier owns both (in-process, single consumer). **No REL path.** **No wheel** on wire or Virtual. Sidecar **never** synthesizes mouse curves.

#### 10.3.1 `IPointerPeripheral`

```text
moveTo(x, y)              → ABS_X, ABS_Y, SYN
button(btn, down|up)      → BTN_*, SYN  (at cursor after moveTo)
```

| Rule | ID |
|------|-----|
| **Always** `moveTo(x,y)` before `button` on **`down` and `up`** | D-UI-03 |
| Left / middle / right — same path; `button` enum only | D-UI-03b |
| Coords validated vs intent `viewportW`×`viewportH`; outside → drop + tele | D-UI-03a |
| Identity chain 1:1 client viewport = Chromium = pixel = ABS | D-UI-04 |
| Over-alloc R; window W×H ⊆ R at (0,0); no scale | D-UI-04/06 |
| Each pointer intent carries `viewportW`, `viewportH`; stale stamp → drop + tele | D-UI-05a |

#### 10.3.2 `IKeyboardPeripheral`

```text
key(code, down, modifiers?)  → KEY_* (+ mods), SYN
type(text)?                   → optional plain typing via fixed keymap
```

| Rule | ID |
|------|-----|
| Wire = **keydown/keyup stream** + modifiers (Ctrl+C/V, …) | D-UI-12 |
| UTF-8 on wire; apply = fixed keymap KEY_* only | D-UI-12 |
| Unmapped codepoint → drop + tele | D-UI-12 |

#### 10.3.3 `IViewportLifecycle`

```text
reset() / sanitize()    → release all BTNs/keys (virgin state)
setViewport(w, h)       → sidecar active viewport (no epoch counter)
```

| Rule | ID |
|------|-----|
| Session owns devices; **virgin at start** (create fresh or reset before admit) | D-UI-16 |
| Sanitize on teardown + recover | D-UI-16 |
| Device node outlives session ⇒ `reset()` mandatory | D-UI-16 |

#### 10.3.4 Decisions (**LOCKED**)

| ID | Decision |
|----|----------|
| **PE-01** | ABS-only pointer; no REL |
| **PE-02** | `moveTo` always on down **and** up |
| **PE-03** | OOB coords → drop + tele |
| **PE-04** | Viewport stamp W×H on pointer intents; no epoch |
| **PE-05** | Keyboard stream + modifiers; optional `type(text)` |
| **PE-06** | Device reset/sanitize; virgin at session start |

---

### 10.4 Fine contracts + Applier Phase A/B — **LOCKED**

**Status:** **LOCKED** (2026-08-23).  
**IDs:** D-UI-01a, D-UI-01b, D-UI-01c, D-UI-24, D-UI-26.

#### 10.4.0 Fine catalog v0

| Contract | v0 | Apply |
|----------|-----|-------|
| `IAbsoluteScroll` | **live** | ContextBus → Virtual JS SET |
| `IFileUpload` | **stub** | Accept intent; no real apply until v1.1 |

#### 10.4.1 `IAbsoluteScroll`

```text
setViewportScroll(contextId, scrollX, scrollY)
setElementScroll(contextId, nodeId, scrollX, scrollY)
```

| Rule | ID |
|------|-----|
| Absolute SET only — never delta/wheel | D-UI-01a / D-UI-22 |
| Target missing on Virtual → drop + tele (knob) | D-UI-24 |
| `missingNodeIds` on apply response do **not** alone fail whole census apply | §10.1b |

#### 10.4.2 `IFileUpload` (stub)

Accept `setFiles` on wire; Applier acknowledges; **no** Virtual apply in v0 (D-UI-25).

#### 10.4.3 Phase A / B — enforce-before-apply (S6)

Applies to PageProjection **`down`** and **`up`** only (§10.1b.6). Video: skip Phase A (no census).

```text
Phase A — enforce scroll on Virtual (await):
  validate census present (PP) / skip (Video)
  loopback invoke applyScrollCensus(census)
  await Virtual fan-out applyScrollPositions (fail-closed)
  if !ok → fail intent + tele; STOP

Phase B — OS peripheral:
  validate viewport stamp + coords
  moveTo(x,y) → button (down or up)
```

| Rule | |
|------|--|
| Phase A !ok ⇒ **no** Phase B | LOCKED |
| Virtual apply fan-out: any context !ok ⇒ whole apply fails | LOCKED |

---

### 10.5 EventApplier (dispatcher) — **LOCKED**

**Status:** **LOCKED** (2026-08-23).  
**IDs:** D-UI-00, D-UI-01, D-UI-21.

#### 10.5.0 Law

One **serial** consumer drains `SidecarBuffer` → `EventApplier.apply(intent)`. Routes by `type` only — **not** by mirror-mode letter (D-UI-19). Input **does not** sync with frame generation / resync (D-UI-08).

#### 10.5.1 Routing table (v0)

| `type` | Path |
|--------|------|
| `move` | Validate stamp/coords → `IPointerPeripheral.moveTo` |
| `down` | PP: Phase A → Phase B press. Video: Phase B press only |
| `up` | PP: Phase A → Phase B release. Video: Phase B release only |
| `keyDown` / `keyUp` | `IKeyboardPeripheral.key` |
| `scrollSet` | `IAbsoluteScroll` SET |
| `setFiles` | `IFileUpload` stub |

#### 10.5.2 Validation (common)

| Check | On fail |
|-------|---------|
| `viewportW/H` vs session active (pointer) | drop + tele |
| `x,y` ∈ `[0,W)×[0,H)` for stamp | drop + tele |
| PP `down`/`up` without `census` | drop + tele |
| Stale / malformed intent | drop + tele |

#### 10.5.3 Decisions (**LOCKED**)

| ID | Decision |
|----|----------|
| **AP-01** | One serial Applier per session |
| **AP-02** | Route by intent `type` only |
| **AP-03** | PP click = Phase A then Phase B; Video = Phase B only |
| **AP-04** | Validation failures → drop + tele (never clamp-accept coords) |

---

### 10.6 ClientBuffer / SidecarBuffer / wire — **LOCKED**

**Status:** **LOCKED** (2026-08-23).  
**IDs:** D-UI-00, D-UI-17, D-UI-23, D-UI-33, D-UI-34, D-UI-35.

#### 10.6.0 Pipeline

```text
ClientBuffer ──MessagePack──► SidecarBuffer ──► EventApplier
     ▲                              ▲
  capture + coalesce            preserve order
  wire ASAP                     single consumer
```

#### 10.6.1 Client capture (**LOCKED**)

| Source | Rule | ID |
|--------|------|-----|
| Wheel/trackpad | Local scroll → `scrollSet` last known ABS; coalesce **100ms**/target; never `wheel` on wire | D-UI-33 |
| Iframe pointer | Map to **root viewport** before enqueue | D-UI-34 |
| Move | Coalesce **50ms** (last wins); **no flush** before down/up | D-UI-35 |

#### 10.6.2 Buffer pressure

| Rule | ID |
|------|-----|
| Drop oldest under pressure | D-UI-17 |
| Never drop/coalesce **down/up** | D-UI-17 |
| Natural backpressure (client JS stalls with page) | D-UI-17 |

#### 10.6.3 Wire intent (MessagePack v0)

`schemaVersion = 1`. Types: `move | down | up | keyDown | keyUp | scrollSet | setFiles`.

| Field | Required when |
|-------|----------------|
| `viewportW`, `viewportH` | pointer types |
| `x`, `y` | pointer types |
| `button` | `down`, `up` |
| `census` (`ScrollCensus`) | PP `down`, `up` — **required**; Video **absent** |
| `contextId`, `scrollX`, `scrollY` | `scrollSet` |
| `nodeId` | `scrollSet` element (null = viewport) |
| `key`, `code`, `modifiers` | key types |
| `timestampClient` | optional |

`ScrollCensus` shape: §10.1b.1 (`contexts[]` of `{ contextId, positions[] }`).

Codec: MessagePack; lean fields; omit optional keys when unused.

#### 10.6.4 Decisions (**LOCKED**)

| ID | Decision |
|----|----------|
| **WR-01** | MessagePack; schemaVersion 1 |
| **WR-02** | Census inline required on PP down/up |
| **WR-03** | Scroll coalesce 100ms; move coalesce 50ms |
| **WR-04** | Order preserved client → sidecar → Applier |

---

### 10.7 Input telemetry — **LOCKED**

**Status:** **LOCKED** (2026-08-23).  
**ID:** D-UI-36.

#### 10.7.0 Law

Fine capability toggles at boot (same pattern as projection telemetry). **Failures only** in v0 — not move/scroll coalesce noise.

#### 10.7.1 Capabilities (v0)

| Toggle | Default | Emits |
|--------|---------|-------|
| `input.telemetry.enabled` | on | master gate |
| `input.telemetry.failures` | on | gesture/apply/validate failures |
| `input.telemetry.buffer` | **off** | move/scroll coalesce drops (noisy) |

#### 10.7.2 Events (v0 catalog)

Each failure emission includes **`errorCode`** + **`phase`** ([diagnostics.md](../../diagnostics.md)).

| Event | errorCode | phase | When |
|-------|-----------|-------|------|
| `Input.CensusFailed` | `census_failed` | `projected_gather` | Client census RPC fail — click not sent |
| `Input.ApplyScrollFailed` | `apply_scroll_failed` | `virtual_apply` | Phase A loopback/fan-out fail |
| `Input.IntentRejected` | `invalid_coords` | `validate` | OOB coords |
| `Input.IntentRejected` | `stale_viewport` | `validate` | Viewport stamp mismatch |
| `Input.IntentRejected` | `missing_census` | `validate` | PP down/up without census |
| `Input.ScrollMiss` | `scroll_target_missing` | `apply_scroll` | scrollSet target gone (D-UI-24) |
| `Input.KeyRejected` | `key_unmapped` | `apply_keyboard` | Char not in keymap |

#### 10.7.3 Decisions (**LOCKED**)

| ID | Decision |
|----|----------|
| **TE-01** | Failures on by default; buffer tele off |
| **TE-02** | Every catalogued failure has errorCode + phase |
| **TE-03** | Emit iff capability enabled |

---

## 11. Master backlog — nothing left behind

Track until promoted/SEALED. Status: `OPEN` | `PROPOSED` | `LOCKED` | `DONE` | `DEFERRED`.

### A. ContextBus / in-page domain

| ID | Item | Status |
|----|------|--------|
| CB-* | Transport | **DONE** SEALED |
| D-UI-27 | Clean cutover (delete legacy ProjectionBus same change) | **DONE** |
| D-UI-29/30 | Domain vocab ≠ bus; invoke iff need result | **LOCKED** |
| D-UI-31 | Domain catalog v0 (§10.1b.0) | **LOCKED** |
| 10.1b | Payloads/algorithms under catalog | mostly LOCKED |
| 10.1c | Loopback mux | **LOCKED** (§10.1c / D-UI-28 / LB-01…07) |
| 10.2 / D-UI-32 | Scrollable index algorithm (Projected only) | **LOCKED** (SI-01…06) |
| S6 / D-UI-26 | Overall scroll↔click coherence | **LOCKED** |
| | Shadow scrollables in index? | **LOCKED** (SI-06) |
| | Census on down + up | **LOCKED** |
| | Video census shortcut | **N/A** — S6 = PageProjection only |
| | Fan-out concurrency cap | OPEN (default: unbounded) |

### B. Virtual ↔ sidecar loopback (D-UI-28)

| ID | Item | Status |
|----|------|--------|
| D-UI-28 / §10.1c | Typed mux envelope + kinds | **LOCKED** |
| LB-01…LB-07 | Channel, frame shape, names, timeout, codec, PlaneChannel cutover | **LOCKED** |

### C. Input pipeline / Applier

| ID | Item | Status |
|----|------|--------|
| D-UI-00..01 | Pipeline + Applier dispatcher | LOCKED |
| D-UI-01a/c | Fine: scroll SET + catalog | LOCKED |
| D-UI-01b/25 | Upload stub v1.1 | LOCKED |
| D-UI-21/22 | Serial consumer; wheel dead | LOCKED |
| D-UI-08/09/10/18/19 | Batch B session/input scope | **LOCKED** |
| D-UI-02 | ABS pointer contract | **LOCKED** |
| D-UI-20 | Spike ABS→Chrome | OPEN (eng only) |
| D-UI-03/05/05a/16 | Peripheral decisions | **LOCKED** |
| D-UI-15 | Peripheral writer in-process | **LOCKED** |
| 10.3 | Peripherals (§10.3) | **DONE** |
| D-UI-11 | Numeric R constant | LOCKED (direction) — tuning later |
| D-UI-17 | Buffer pressure | LOCKED |
| D-UI-23 | MessagePack lean + tele knobs | **LOCKED** (§10.6) |
| D-UI-24 | Scroll miss drop+tele | LOCKED |
| 10.4 | Fine contracts + Phase A/B (§10.4) | **DONE** |
| 10.5 | EventApplier routing (§10.5) | **DONE** |
| 10.6 | Wire + buffers (§10.6) | **DONE** |
| 10.7 | Input telemetry (§10.7) | **DONE** |
| | Phase A fail ⇒ skip Phase B | **LOCKED** |
| | Which intents require census (§10.1b.6) | **LOCKED** (down+up; not move) |

### D. Capture / client

| ID | Item | Status |
|----|------|--------|
| | Wheel/trackpad → scrollSet (Projected) | **LOCKED** (D-UI-33) |
| | Iframe pointer → root viewport | **LOCKED** (D-UI-34) |
| | Move coalesce ClientBuffer | **LOCKED** (D-UI-35: 50ms, no flush) |
| | Video wheel → scrollSet | **N/A** (asset surface; no DOM scroll tree) |
| | Census gather latency budget / UX | **N/A** (fail-closed; no budget fork) |

### E. Docs / cutover hygiene

| ID | Item | Status |
|----|------|--------|
| | Promote input draft → normative input.md | DEFERRED until D-UI-20 spike + review |
| | Amend multi-doc §4 → ContextBus | OPEN |
| | decision-log on input unify SEAL | DEFERRED |
| | Delete list: OsInputBackend REL, PatchrightInputBackend, input-v2 paths | OPEN |
| | MotorAssert / lab blueprints for new input | OPEN |

### F. Explicitly out / later product

| Item | Status |
|------|--------|
| Touch / multitouch | DEFERRED |
| IME / insertText fine contract | DEFERRED (§3.2a) |
| Real upload (not stub) | v1.1 |
| Container-per-session | phase 2 |
| Wayland | post-v0 |
