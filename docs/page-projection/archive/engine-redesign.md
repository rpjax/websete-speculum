# PageProjection — engine redesign & implementation specification

**Status:** **DECIDED — normative.** Every open question in §12 is resolved. This document is the
contract for the PageProjection engine.
**Revision:** rev 4 (2026-08-11).
**Scope:** the engine end to end — identity, mapping, frame model, wire format, establish, recovery,
apply, interaction, surface, assets, session lifecycle, admission, telemetry, configuration, module
layout, test matrix and work packages.
**Amends:** **T4**, **T5**, **T7**, **T9**, **G-A** and the **T2/T6** wire encoding in
[diff-streams.md](diff-streams.md); **C3** encoding in
[cssom.md](cssom.md); §6.3, §6.7, §7.2, §11 and §14.3 of
[input.md](input.md).
**Supersedes:** [diff-pipeline.md](diff-pipeline.md) and
[coalesce.md](coalesce.md) entirely.

**Related:** [acceptance.md](acceptance.md) ·
[virtual-assets.md](virtual-assets.md) · [telemetry.md](../../telemetry.md) ·
[engineering-standards.md](../../engineering-standards.md) · [frontend-standards.md](../../frontend-standards.md)

**Evidence base:** `deploy/tmp-telemetry-run/pipehop-bugs-diagnosis.md`
(`parityhop-*`, `dommaphop-*`, `dommapfix-*`, `pipehop-*`) and `tmp-telemetry-run/bugs-observados.md`
(BZ1–BZ10).

---

## How to read this document

- **MUST / MUST NOT / SHOULD / MAY** are normative in the RFC sense. §5 is normative in full.
- §2 defines the budgets. §7 defines the oracles that measure them. §8 is the test matrix.
  **A work package is complete when its tests in §8 pass and its budgets in §2 hold — not when the
  code looks finished.** No exception, no "will fix later", no partially-passing exit.
- §10 is the implementation order. **WP1 and WP2 (the oracles) MUST land before any engine work.**
  An engine change that cannot be measured is not an improvement, it is a claim.
- Where this document conflicts with a superseded doc, this one wins. Where it conflicts with
  [acceptance.md](acceptance.md), **acceptance wins**.
- **When something here is genuinely ambiguous, stop and ask — do not choose.** An implementation
  that guesses and passes the pipe metrics is exactly the failure this document exists to prevent.

---

## 0. Why this document exists

The sealed Dom and Cssom contracts specify ops, payloads, chronology, ACID apply, addressing,
placeholders and stamps with precision. They **contain no cost number**. T5 says it outright:
*"Volume may be high; correctness ≠ capacity (perf track separate)."*

The implementation delivered exactly what was specified — `FrameReceived = FanOutEnqueued =
StreamDequeued = WireDelivered`, `QueueDropped = 0`, contiguous `sequence`, ACID apply — and a
Projected surface that takes **8.7 s to first paint**, costs roughly **300% of the page's own CPU**,
and renders the hero banner blank.

Four lessons are load-bearing.

**L1 — Seal invariants, not mechanisms.** T7 sealed `querySelectorAll(query).length === 1`. That is a
mechanism; the invariant was *"resolve is deterministic: exactly one node, or desync"*. Sealing the
mechanism made an **O(nodes) cost per operation** a contract requirement. Same error in T4 (identity
MUST be a DOM attribute) and T5 (one `MutationRecord` MUST be one wire envelope).

**L2 — Cost is a feature.** A budget absent from the contract does not exist.

**L3 — Parity is perceptual, not structural.** A tree that is byte-for-byte isomorphic but arrives
8.7 s late, reacts 300 ms after a click, or moves the caret while the user types has failed **K4**.

**L4 — What is not asserted will regress.** Every green metric in the current engine measures the
pipe. None measures the product. §7 closes this permanently.

---

## 1. Constraints (given — not open for debate)

| # | Constraint |
|---|------------|
| **K1** | **No pixel/video streaming in PageProjection, ever** — not partial, not per-element. Screencast belongs exclusively to `MirrorMode.VideoStreaming`. |
| **K2** | **Session state is never shared.** Cookies, storage, credentials, identity, DOM, CSSOM, the id space, and any response fetched with credentials are strictly per session. **Exception:** immutable, credential-less **public byte content** is deduplicated in a shared asset tier under the predicate in §5.12.2 — byte content carrying no session identity is not session state. Shared CSSOM, shared rewrite memo and shared id space remain rejected. |
| **K3** | **≥100 concurrent sessions** on an appropriately provisioned VPS, **with no degradation**. |
| **K4** | **Absolute 1:1 parity**, visual and interactive, per [acceptance.md](acceptance.md). |
| **K5** | **Site JavaScript executes only in the Virtual Chromium.** No page JS on the Projected surface, in any form. |

**Media clarification (so K1 is not misread):** `<video>`/`<audio>`/HLS/DASH are served as **bytes**
through the virtual-assets pass-through plane and played by the **client's own** media engine. That
is asset serving, not pixel streaming, and it stays. K1 forbids mirroring the *rendered surface* as
pixels.

**Out of scope for this document:** how sessions reach an origin at the network level — egress
address, connection reuse, TLS behaviour. Infrastructure concern, tracked elsewhere.

---

## 2. Budgets (normative)

### 2.1 Parity budgets — measured as a delta against the Virtual page

Absolute timings punish us for slow sites and reward us for fast ones; neither measures parity. Every
user-facing budget is **Projected minus Virtual**, measured in the same session on the same
navigation.

| # | Budget | Target |
|---|--------|--------|
| **P1** | Δ First contentful paint (Projected FCP − Virtual FCP) | p50 ≤ **100 ms**, p95 ≤ **200 ms** |
| **P2** | Δ Fully materialized (Projected complete − Virtual `load`) | p95 ≤ **300 ms** |
| **P3** | Live lag: Virtual mutation → painted on Projected | p50 ≤ **RTT + 20 ms**, p95 ≤ **RTT + 50 ms** |
| **P4** | Input → **local** visual feedback | ≤ **16 ms**, never network-bound |
| **P5** | Input → **authoritative** effect on the Projected surface | ≤ **RTT + 50 ms** |
| **P6** | Hard navigation: Projected document swap after Virtual FCP | ≤ **150 ms**, with **no blank frame** |
| **P7** | Visual diff Virtual vs Projected at settle | ≤ **0.5%** differing pixels **and** zero structural regions (§7 O1) |

### 2.2 Engine budgets

| # | Budget | Target | Today |
|---|--------|--------|-------|
| **E1** | Projection CPU per page load | ≤ **10%** of that page's own CPU, and ≤ **200 ms** absolute at 20k nodes | ~300% / ~5924 ms |
| **E2** | Establish wall, cold, 20k nodes, pipelined | ≤ **150 ms** | **5924 ms** |
| **E3** | Producer CPU per live operation | ≤ **10 µs** | O(nodes) |
| **E4** | Client CPU per live operation | ≤ **10 µs** | O(nodes) |
| **E5** | Per-frame pipeline overhead (encode + wire + journal + fan-out) | ≤ **100 µs** | ~4 Journal facts + 1 frame **per op** |
| **E6** | Steady-state CPU per session, continuously mutating page | ≤ **0.3%** of a core | unmeasured |
| **E7** | Speculum-side memory per session (excludes Chromium) | ≤ **16 MB**: mirror ≤ 4 MB, private L1 cache ≤ 8 MB, overhead ≤ 4 MB | unmeasured, uncapped |
| **E7b** | Host-wide shared asset tier (L2, §5.12.2) | default cap **1 GiB**, LRU | does not exist |
| **E8** | Journal facts per page load per session, default telemetry | ≤ **50** | ~28 324 |
| **E9** | Client frame apply | ≤ **4 ms**, `requestAnimationFrame`-aligned | unmeasured |
| **E10** | Session start: Chromium boot on the user's critical path | ≤ **50 ms** | **3200 ms** |
| **E11** | Density | **design for 150** sessions, **gate at 100**, with P1–P7 percentiles held | unmeasured |

### 2.3 Derivation (these numbers are not arbitrary)

**E2 = 150 ms.** 20k nodes: traversal ~20k × ~50 ns ≈ 1 ms; attribute enumeration ~100k × ~150 ns
≈ 15 ms; string interning ~100k map operations ≈ 10 ms; buffer writes ≈ 2 ms — **in-page ≈ 30–50 ms**.
Chunked transfer and client parsing overlap production; native HTML parsing of ~3 MB ≈ 30–100 ms,
overlapped. Pipelined wall ≈ **100–150 ms**. Today's 5924 ms is ~40× this, consistent with several
defects multiplying (§3), not with one slow function.

**E1 = 10%.** A ~2 s page load with 7000 operations: establish 150 ms + 7000 × 10 µs = 70 ms + frame
overhead ≈ 20 ms ⇒ **≈ 240 ms ≈ 12%**. Tight but reachable; it is the budget that decides E11.

**E11 host model.** At 100 sessions ~10% are loading at any instant, each costing the site's own
~0.5 core ⇒ ~5–6 cores of legitimate site work; ~90 live-but-idle sessions still mutate (rotating
ads, carousels, **live odds** — the primary product case). At today's 300% overhead the projection
alone would demand ~15–20 cores before any site work. At E1 it demands ~0.6.

**Calibration.** E6, E7b, E11 and the pool knobs MUST be re-derived from **O4** once it exists. The
values here are starting points, not blanks — an implementation MUST use them until O4 replaces them.

---

## 3. Defects of the current engine

### D1 — A streaming medium mirrored by a batch algorithm
The site paints progressively; the Projected surface shows nothing for 8.7 s then everything
(`Establish.FirstDiffEmitted`, `tSinceCommitMs ≈ 8680`). Already a **K4** failure: parity includes the
loading experience.

### D2 — The wire unit is the mutation record, not the frame
T4/T5 seal `1 MutationRecord = 1 diff = 1 envelope`. Measured **6964** envelopes for one cold load
(`parityhop`), 7721 (`pipehop`), 6008 (`beleza`). An SPA rendering a grid emits ~280 records in one
task whose net effect is one child-list change plus a few patches; the client never paints between
them. Under load the chain is **positive feedback**: more sessions → slower pipeline → overflow →
DropAll → `sequence_gap` → desync → OOB resync → more load. This is BZ1; the response was raising the
queue to 8192, which postpones the same collapse.

### D3 — Identity lives in the site's DOM; addressing is a CSS query
`anchorAll` writes `speculum-anchor` on ~18k elements (**599 ms**), and
`speculum-last-mutation-sequence` again per touched node per emit (`PageProjection.ts:1549`) —
delivering ~18k `MutationRecord`s **to the site's own observers**, invalidating style caches, inflating
`htmlLen` to ~3.2 M, and creating the duplicate-anchor class (BZ4) because clones copy the attribute.
Addressing runs a **full-document `querySelectorAll`** per operation on Virtual
(`DomTreeSerializer.ts:983`, from `:1040`/`:1070`), climbing up to 64 levels with another query and a
sibling-list allocation (`:1024`) per level; the client repeats the scan with no index
(`PageProjectionDiffApplier.ts:709`). ~7000 full-document scans per side per load — the only
O(nodes × ops) cost in the system and the hard ceiling on K3.

### D4 — The payload is materialized and re-encoded at every hop
Object tree → `JSON.stringify` in-page → `JSON.parse` in Node → rewrite → re-encode for the wire.
`cdpTransferMs` is not a measurement: it is `evaluateWallMs − pageTotalMs` (`PageProjection.ts:232`,
`:955`), containing scheduling behind the site's long tasks, main-thread serialization, the wire and
Playwright deserialization, indistinguishably. Proof: 18.5k nodes cold → 3944 ms; 27k nodes at resync
→ 1324 ms. **Larger payload, lower cost.** Second consequence: the API — shared by all sessions — pays
cost proportional to each session's payload because it parses what it relays.

### D5 — Telemetry is per-operation
~28 324 Journal facts per load per session, four Diff hops per op. At 100 sessions this competes with
what it measures.

### D6 — The interaction round trip is unmodelled
Every metric describes Virtual → Projected; none describes user → Projected. The path is event →
intent → data plane → inject chain → CDP → site JS → mutation → frame → wire → apply → paint:
plausibly 150–350 ms over the internet against ~0 ms for a native click. Already-filed bugs that are
this same missing principle: `click_navish` on a not-visible element (BZ10), SoftNav wrong-target, the
hit-test mitigation in input §14, the accepted caret jump in input §7.2.

### D7 — The asset plane has no cost model and sits on the critical path
CSS reaches the Projected document through `/w7s/virtual-assets/...`, and `cache` mode is specified to
**await** an in-flight fill with a timeout to 404 — a blocking wait on the paint path. Parity is
failing here now: `brokenImgs` 11 after settle, `virtualData1x1 = 21`, cloudinary 404s on
`f_avif`/`f_webp` paths with no public id, a 400 on the bare site root (BZ7/BZ8). And per-session
caching multiplies both origin traffic and host RAM by the session count.

### D8 — Node-state parity is incomplete beyond form controls
D16 covers `.value` / `.checked` / `.selected` and stops there. It does not cover imperative state
with no attribute: `dialog.showModal()` top-layer participation, `popover` state, media playback
state, `setCustomValidity`. A projected `<dialog open>` renders as a **non-modal** dialog with no
backdrop and no inertness — a visible **K4** failure on a control commerce and betting sites use
constantly.

---

## 4. Target architecture

```
VIRTUAL (Chromium)                     │ per session
  identity     WeakMap<Node,u32> + reverse map   │ no writes into the site's DOM
  observe      MO + pierce + state sensors       │ records only, zero string work
  frame        accumulate → coalesce net effect  │ boundary driven by an unthrottled clock
  encode       binary writer, reusable buffer    │ produced ONCE
  channel      chunked binary push to Node       │ never page.evaluate for bulk
        │
NODE SIDECAR
  rewrite      URLs → virtual prefixes           │ per session
  mirror       decoded tree, kept by applying frames │ resync source + O2 source
        │
API (.NET)                             │ shared by all sessions
  relay        header only, opaque body          │ O(1) per frame
        │
CLIENT
  decode       binary reader                     │
  registry     Map<u32,Node>                     │ O(1) resolve
  apply        rAF-aligned atomic frame apply    │ batched writes, no layout reads
  surface      sandboxed same-origin iframe ×2   │ real document, double buffered
  interaction  local-first + intents by id       │ perception never awaits the network
```

Five architectural invariants, each removing a defect:

1. **Nothing is written into the site's DOM.** (D3)
2. **The payload is produced once and never re-encoded.** (D4)
3. **The frame is the unit of everything** — coalescing, sequence, wire, apply, telemetry. (D2, D5)
4. **The Projected surface is a real document.** (K4; retires the CSS-rewrite debt class)
5. **Perception is local; truth is authoritative.** (D6)

---

## 5. Normative specification

### 5.1 Identity

1. Each session has an independent id space (**K2**). Ids are **`uint32`**, allocated monotonically
   from 1. `0` is reserved for "none". Ids are never reused within a `generation`.
2. The producer MUST hold `WeakMap<Node, uint32>` (forward) **and** `Map<uint32, WeakRef<Node>>`
   (reverse). The reverse map is required by input resolution (§5.11) and by state sensors. Entries
   MUST be released through a `FinalizationRegistry` and on `generation` bump, so the reverse map
   cannot retain detached nodes and cannot grow without bound.
3. The producer MUST NOT write identity attributes into the Virtual DOM.
4. **Text nodes, comments and elements all receive ids.** A `WeakMap` accepts any node; the
   element-only limitation that forced `DomSelector.childAt` no longer exists.
5. An id is allocated the first time F publishes the node. A node never published has no id.
6. A cloned node is a distinct object and therefore has no id: it is genuinely new. This replaces the
   remint / collision machinery (BZ4) with a structural guarantee.
7. `speculum-anchor` appears **only** in establish HTML (§5.6), so the client can build its registry
   from the parsed document. It MUST NOT appear in live frames — those carry the numeric id. The
   client MAY leave the attribute on the projected node; it MUST NOT rely on it for resolution.
8. **Deleted:** `speculum-last-mutation-sequence` in every form — it has no consumer and cost an
   attribute write per touched node per emit.
9. A debug-only flag MAY materialize ids as attributes on Virtual. It MUST default off and MUST NOT be
   reachable from production configuration.

**Consequences (simplifications, not losses):** `DomSelector` collapses to a bare `uint32`. The
`element` / `childAt` variants (G-A), the F-visible index space (T7), adjacent-text-run collapsing and
the "client never `normalize()`" rule (T9) become unnecessary. F publishes text nodes **1:1 with no
collapsing**, which is strictly more faithful. The pre-op/post-op index-resolution hazard disappears:
ids are stable, so resolution order is irrelevant.

### 5.2 F — the structural map

1. **Structurally 1:1.** Element slots and sibling order match Virtual after placeholder rewrite,
   across the main document and all pierced roots flattened into one tree.
2. **Placeholders** (unchanged from T13): `script`, `noscript`, `template`, `iframe`, `base`,
   `object`, `embed`, `applet` are published as a `div` host carrying `speculum-projected-tag`.
   `iframe` interior = the pierced document tree; the others publish empty interiors. Nodes are
   **never** omitted — holes break structure.
3. **Attribute policy:** deny-list. Event-handler attributes, `integrity` and `javascript:` URLs are
   removed; site CSP `meta` is stripped; `<base href>` is resolved away.
4. **URL rewriting** to `/w7s/virtual-assets/{host}{path}?query`, `/w7s/virtual-blob/{id}`,
   `/w7s/virtual-data/{id}` covers `src`, `href`, `xlink:href`, `data-src`, `poster`, `srcset`,
   `imagesrcset`, inline `style`, CSS `url()`, and the bare-string forms of `@import` and
   `image-set()`. Reserved query parameters per
   [virtual-assets.md](virtual-assets.md) §1.1.
5. **Pierce is mandatory**: main document, open and closed shadow roots, same-origin and cross-origin
   iframes, flattened into one tree. Boundary hosts carry `speculum-shadow-root`,
   `speculum-shadow-closed`, `speculum-iframe`. Shadow **slot assignment** MUST be published as the
   flattened rendered result, not light DOM plus shadow tree side by side.
6. **Document-level state MUST be published**: `<title>`, `lang` and `dir` on the root element, and
   `<meta name="viewport">`. `dir` and `lang` change rendering; omitting them is a K4 failure.

#### 5.2.1 Node state that has no attribute (extends D16 — closes D8)

These MUST ride in F and in `patch`, driven by dedicated sensors, because a `MutationObserver` cannot
see them and their absence produces divergence with **no sequence gap**:

| State | Published as | Client apply |
|-------|--------------|--------------|
| `input`/`textarea` `.value` | `speculum-input-value` | set `.value`, subject to §5.9.3 |
| checkbox/radio `.checked` | `speculum-input-checked` | set `.checked` |
| `option` `.selected` | `speculum-option-selected` | set `.selected` |
| `dialog` opened via `showModal()` | `speculum-dialog-modal="true"` | call `showModal()` so it enters the top layer with backdrop and inertness |
| `popover` shown | `speculum-popover-open="true"` | call `showPopover()` |
| media `paused` / `currentTime` / `muted` / `volume` | `speculum-media-*` | apply to the client's own media element |
| `setCustomValidity` message | `speculum-custom-validity` | `setCustomValidity(...)` so `:invalid` matches |

**Sensors.** `input`, `change`, `toggle`, `close`, media events, plus an explicit hook where no event
exists. A sensor firing marks the node in `stateDirty` (§5.3.2) and nothing more — no payload work in
the event handler.

**Explicitly out of F:** computed style, layout geometry, canvas/WebGL pixels, and caret and selection
(client-authoritative, §5.9.3).

**Rule for future additions:** a state belongs in F if and only if its absence can cause divergence
with no sequence gap. Expanding the list requires a demonstrated case, not a debate.

### 5.3 The frame model (replaces T4/T5)

#### 5.3.1 Definition

A **frame** is the net effect of all Virtual mutations observed since the previous frame, encoded as
one ordered set of operations, carrying one `sequence`, applied by the client as one atomic
transaction.

#### 5.3.2 Accumulation

Per frame the producer maintains:

- `newIds: Set<u32>` — nodes first published this frame
- `dirtyParents: Set<u32>` — nodes whose F-visible child list changed
- `attrDirty`, `textDirty`, `stateDirty: Set<u32>`
- `scrollDirty: Map<u32|VIEWPORT, position>` — last sample wins
- `detached: Set<u32>` — previously published nodes no longer connected

Records for nodes F does not publish (placeholder interiors, `<style>`/`<link>` rule bodies which
belong to the Cssom plane per C5, deny-listed subtrees) MUST be discarded **at the top of the
callback, before any identity, addressing or payload work**.

#### 5.3.3 Flush

At the frame boundary, in this order:

1. **Prune ephemerals.** Any node in `newIds` not connected at flush was created and destroyed within
   the frame: discard it and all its entries; its id is never sent. This removes a large fraction of
   SPA reconciliation churn.
2. **Absorb descendants.** For any node whose nearest published ancestor is in `newIds`, discard its
   individual entries — its state rides in the ancestor's snapshot. A 200-node subtree produces
   **one** entry, not 200.
3. **Prune orphans.** Discard entries for nodes whose ancestor is in `detached`.
4. **Emit `childList`** per surviving dirty parent, ancestor-first in document order (§5.4.3).
5. **Emit `patch`** for each surviving id in `attrDirty ∪ textDirty ∪ stateDirty`, one per node,
   carrying the **flush-time full snapshot** — not a delta. Full snapshots are idempotent and
   self-healing.
6. **Emit Cssom-plane ops** accumulated in the same window (§5.10).
7. **Emit scroll ops**, at most one per scroller, last sample, subject to echo suppression (§5.9.4).
8. Allocate **one** `sequence` and emit. A frame with no operations MUST NOT be emitted and MUST NOT
   consume a `sequence`.

#### 5.3.4 Frame boundary clock

1. The boundary is driven **in-page** by an interval clock at `frameRateHz` (default **60**).
2. **`requestAnimationFrame` MUST NOT be used for the boundary.** rAF is tied to the compositor and is
   throttled or suspended when the page is not visible. The clock MUST be a timer-based scheduler
   (`MessageChannel` / `setTimeout`) whose drift is corrected against `performance.now()`.
3. Chromium background throttling MUST be disabled for Virtual sessions
   (`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`,
   `--disable-backgrounding-occluded-windows`), and the page kept in an active lifecycle state.
   **This is not optional:** with throttling on, the frame clock silently drops to ~1 Hz and the
   engine appears to work while lagging by seconds.
4. **Watchdog.** Node MUST detect a stalled clock: if the sidecar observes page activity (asset
   requests, CDP events) while no frame has arrived for `frameStallMs` (default **1000**), it emits
   `Frame.ClockStalled` and forces a flush. Test `PP-FR-7`.
5. Node MAY change the rate at any time by sending a rate message; the page MUST apply it on the next
   boundary. Rate changes MUST NOT require a round trip per frame.

#### 5.3.5 Rate policy and backpressure

1. Degradation ladder: **60 → 30 → 15 → 5** Hz. Triggers: emit-path congestion, host pressure
   (§5.14), or a client report of apply overrun (§5.9.5). Every transition MUST emit a fact.
2. Recovery is one step at a time, no faster than once per `rateRecoverMs` (default **5000**), to
   avoid oscillation.
3. If the client reports `hidden`, the rate collapses to `hiddenRateHz` (default **1**). Mutations
   keep accumulating; the next frame is simply larger.
4. **Backpressure MUST NOT drop a frame and MUST NOT desync.** A congested pipe produces fewer, larger
   frames. `QueueDropped` exists only for genuine faults, never as a load response.
5. `maxFrameBytes` (default **1 MiB**) bounds one wire message. A frame exceeding it MUST be **split
   into parts** (§5.5), never dropped and never split into separate frames.

#### 5.3.6 Correctness argument

T5's justification was correctness. Merging records within a frame is exactly as correct as applying
them serially **provided the merge yields the same final tree**, which §5.3.3 guarantees by
construction and **O2** verifies continuously. Atomicity strictly improves: today seven envelopes can
be interrupted midway; one frame cannot. T5 conflated "do not delay for freshness" (valid, satisfied
by the ≤16 ms bound at 60 Hz) with "do not merge records" (never a correctness requirement).

**Rejected:** filtering mutations by *visual* relevance — it breaks determinism and is unnecessary
once E3/E4 hold.

### 5.4 Operation vocabulary

One opcode space covers both planes; there is **no** `plane` field on the frame header, because a
frame may carry operations from both.

| Opcode | Plane | Address | Payload |
|--------|-------|---------|---------|
| `establishBegin` | dom | none | `{ generation, viewport, scrollViewport, scrollElements[] }` |
| `establishChunk` | dom | none | `{ bytes }` — a well-formed HTML fragment (§5.6) |
| `establishEnd` | dom | none | `{ nodeCount, checksum }` |
| `childList` | dom | `parent: u32` | §5.4.2 |
| `patch` | dom | `node: u32` | full flush-time F snapshot, **no children** |
| `scrollViewport` | dom | none | `{ scrollX, scrollY }` absolute |
| `scrollElement` | dom | `node: u32` | `{ scrollTop, scrollLeft }` absolute |
| `cssomInstall` | cssom | none | `{ sheets }` with ids and scope |
| `cssomSheetList` | cssom | none | `{ removed[], added[{index, sheet}] }` |
| `cssomRuleList` | cssom | `sheet: u32` | `{ removed[], added[{index, rule}] }` |
| `cssomPatch` | cssom | `rule: u32` | `{ rule }` — applied in place |

**The `document` op of T6 is deleted.** Establish is the three `establish*` ops; there is no node-tree
document payload anywhere on the wire.

#### 5.4.1 `patch`

Full flush-time snapshot: tag, all published attributes, §5.2.1 state, and — for text and comment
nodes — the value. **No children.** Idempotent by construction, so a redundant patch is always safe.

#### 5.4.2 `childList` — declarative child list

```
childList {
  parent: u32
  mode:   FULL | APPEND
  children: [ ChildRef ]     // FULL: the complete F-visible child list, in order
                             // APPEND: entries appended at the end, nothing else changed
}
ChildRef := existing { id }  | fresh { node }
```

Client apply for `FULL`:

1. Resolve every `existing` id in the registry. Any miss ⇒ **desync**.
2. Any current child of `parent` absent from `children` is **removed** (and its subtree unregistered).
3. Nodes are placed in the declared order. An `existing` node is **moved**, never destroyed and
   recreated.
4. `fresh` entries are constructed and registered.

**Why declarative.** Remove/insert index triplets are the source of the entire index-arithmetic bug
class, and they force destroy-and-recreate on a move — which **loses client state inside the moved
subtree**: media playback position, focus, scroll offset, CSS transition continuity. A real DOM move
preserves all of it; today's remove+add does not. A live **K4** defect, not only a simplification.

**Cost and mode choice.** 4 bytes per child. `APPEND` MUST be used when the change is purely a suffix
addition; `FULL` otherwise. A `FULL` list is capped by `maxFrameBytes` through part splitting (§5.5).

#### 5.4.3 Ordering within a frame

1. `establish*` ops (only in an establish or resync frame, never mixed with live ops).
2. `cssomInstall` — when present it MUST precede any `establishChunk`, so the parser never paints
   unstyled content (this is the D-FLASH fix).
3. `childList`, **ancestor-first in document order**.
4. `patch`.
5. `cssomSheetList` / `cssomRuleList` / `cssomPatch`.
6. `scrollElement`, then `scrollViewport`.

Because addresses are stable ids, resolution order is irrelevant. Apply is still ACID: the client MUST
resolve **every** address in the assembled frame before mutating and desync on any miss.

### 5.5 Wire format

```
Frame
  magic      u16   'PP'
  version    u8    starts at 1; unknown ⇒ desync, never best-effort parse
  flags      u8    bit0 establish · bit1 resync
  generation u32
  sequence   u32
  partIndex  u16   0-based
  partCount  u16   1 when not split
  strCount   u32
  strings    [ len u32, bytes UTF-8 ] * strCount     // per part, deduplicated
  opCount    u32
  ops        [ opCode u8, payload ] * opCount

Node (preorder, self-delimiting)
  kind u8
    ELEMENT : id u32, tag strIdx u32, attrCount u16,
              [ name strIdx u32, value strIdx u32 ] * attrCount,
              childCount u32, Node * childCount
    TEXT    : id u32, value strIdx u32
    COMMENT : id u32, value strIdx u32
```

1. Little-endian; ids are `uint32`.
2. The string table is **per part** and deduplicated. Attribute names and repeated class values
   collapse to one entry; this is where most of the size reduction comes from without a compressor.
3. **Part splitting.** All parts of one frame share `generation` and `sequence` and differ by
   `partIndex`. The client buffers parts and applies the assembled frame **as one transaction** when
   `partIndex == partCount - 1` arrives. A missing part ⇒ desync. Atomicity is never split.
4. The producer MUST write into a **preallocated, reusable buffer**. No intermediate object tree, no
   `JSON.stringify`, no `JSON.parse` anywhere on this path.
5. **The API MUST NOT parse the body.** It reads the header — session, `generation`, `sequence`,
   `partIndex`, `partCount`, `flags` — and relays opaque bytes. API cost per frame is O(1) in payload
   size.
6. Transport compression MAY be enabled; the format MUST NOT depend on it.

**Rejected as the general format — HTML text.** The HTML parser reinterprets structure (foster
parenting in tables, whitespace in `select`, leading newline in `pre`) and can silently yield a tree
different from the one sent. Permitted **only** for establish (§5.6), where the whole document is
parsed at once and `establishEnd.checksum` plus **O2** verify the result.

### 5.6 Establish

1. Establish runs on emitter `init()`: at session start and on a real top-level Document swap (T3/D4
   detection unchanged — document token and/or CDP non-same-document; never `framenavigated` alone,
   never same-document navigation).
2. Order: `cssomInstall` first, then `establishBegin`, then `establishChunk`*, then `establishEnd`.
3. `establishChunk` carries **well-formed HTML**. Ids ride as `speculum-anchor` attributes. Chunk
   boundaries MUST be at points where the prefix is parseable; head and above-the-fold content MUST be
   emitted first. Chunk size target `establishChunkBytes` (default **64 KiB**).
4. The client feeds chunks into the surface document's parser (§5.8), which paints progressively —
   natively, exactly as the original site does. After `establishEnd` the client walks the document
   **once** to build `Map<u32, Node>`, and compares `nodeCount` and `checksum`; a mismatch ⇒ desync.
5. `establishBegin` carries the viewport and the scroll offsets to restore; the client applies them
   before arming.
6. **Establish ↔ live handoff (normative).** The Virtual tree mutates while establish is produced. The
   producer MUST:
   a. open the establish epoch and begin accumulating live frames **before** the walk starts;
   b. snapshot state as of the walk;
   c. after `establishEnd`, emit the accumulated frames in `sequence` order — each safe to apply over
      the snapshot, because `childList` is declarative and `patch` is a full snapshot;
   d. never leave a window in which a mutation is in neither the snapshot nor a frame.
   This race is the mechanism behind "the surface is right except one region is empty" (BZ5, the blank
   hero). Test `PP-EST-3`.
7. **Arming.** The surface arms when `establishEnd` is applied, the registry is built and verified, and
   `cssomInstall` is applied. Before arming, pointer intents MUST NOT be sent; the client MUST show
   that the surface is loading and MUST queue or visibly refuse clicks — **never** silently
   mis-target them. Arming too early is the mechanism behind the hit-test mismatch class (BZ10
   `click_navish`, SoftNav wrong-target).

### 5.7 Recovery

#### 5.7.1 Desync triggers (exhaustive)

The client MUST desync on, and only on: an id that does not resolve in the registry; a `sequence` gap;
a `generation` mismatch; a missing frame part; an unknown wire `version` or a decode error; an
`establishEnd` `nodeCount`/`checksum` mismatch; a Cssom id that does not resolve. **Overload is not a
desync trigger** (§5.3.5).

#### 5.7.2 Resync

1. On desync the client marks itself desynced, **buffers** inbound frames, disarms input (D12), and
   issues the OOB `PageProjection.Resync` request carrying its last contiguous `generation` and
   `sequence`.
2. The response is a normal frame stream with the **resync flag**: `cssomInstall`, `establishBegin`,
   `establishChunk`*, `establishEnd`, plus the watermark `{ generation, coversThroughSequence }`.
3. It is produced **from the Node mirror**, by serializing the mirror tree to HTML. The page is not
   involved — this is what keeps recovery in the tens of milliseconds, as already proven
   (`domMapMs` 6609 → 50 ms).
4. The resync fetch MUST NOT allocate or advance the live `sequence`.
5. The client rebuilds the surface (into the second buffer, §5.8.5), applies the stream, then drains
   its buffer: frames with an older `generation` or `sequence ≤ coversThroughSequence` are dropped,
   the rest applied in order. Then it re-arms.

#### 5.7.3 The Node mirror

Node MUST keep a decoded mirror of the projected tree, updated by applying every frame it relays. It
is the resync source (§5.7.2), the **O2** comparison source, and it MUST hold **E7** (≤ 4 MB for a
25k-node tree), which requires the flat decoded form, not a JS object tree.

### 5.8 Surface

1. The Projected document lives in a **same-origin iframe** with `sandbox` **without**
   `allow-scripts`. **K5 becomes browser-enforced** rather than dependent on the completeness of the
   placeholder deny-list.
2. Consequently `rem`, `vw`/`vh`, `%`, `:root`, `html`/`body` selectors, `overflow`, **media queries**,
   **`position: fixed`**, the top layer (`<dialog>`, popover) and scrollbar geometry behave natively.
   Each is viewport-relative and can only ever be **accidentally** correct in a stand-in `div` — media
   queries match the shell window, and fixed positioning depends on whether an unrelated hack
   (`container-type: size`, added for the `vw` workaround) happens to establish a containing block.
   These are existing, unlisted **K4** defects.
3. **All CSS rewriting is deleted**: no regex selector rewriting, no `html`/`body` stand-in mapping, no
   baked `rem`→`px`, no `vw`→`cqw` conversion, no forced `overflow-x: hidden`. Debt items D-FLAT,
   D-CSS-SEL, D-REGEX, D-REM, D-REM-STATIC, D-VW, D-OX, D-OX-FIXED are retired, not fixed.
4. The iframe's inner viewport MUST equal the Virtual viewport in CSS pixels. A stable client screen
   still implies zero `Resize` (MATRIX D6).
5. **Double buffering (P6).** On a real document swap or a resync the new document is built in a
   **second** iframe while the current one stays visible. The swap happens at the
   **first-meaningful-paint threshold**, defined as: `establishEnd` applied **and** `cssomInstall`
   applied **and** the body has a non-empty layout box — **or** `swapTimeoutMs` (default **1500**)
   elapsed, whichever comes first. The retired buffer is destroyed with its registry, owned CSSOM and
   id map, giving a clean epoch boundary.
6. **Zoom and device pixel ratio.** The client's `devicePixelRatio` is sent at session start as part of
   the device profile so Virtual `srcset` selection matches. A client zoom or DPR change alters the
   surface's CSS viewport — that is a genuine screen change, so it goes through the existing viewport
   policy as a `Resize` and the surface re-locksteps. This does not conflict with MATRIX D6: the rule
   is that a **stable** screen implies no `Resize`. Independent zoom of the projected content without
   a corresponding Virtual viewport change is **forbidden** — it would break hit-testing.
7. Input coordinate mapping (input §6.3) is revised for the iframe boundary: the surface rect is the
   iframe's content box and events are captured inside the iframe document.

### 5.9 Client apply and local-first interaction

#### 5.9.1 Apply loop

1. Frames are queued on arrival and applied inside `requestAnimationFrame`. If several are pending,
   **all** are applied in one callback, in `sequence` order.
2. During apply the client MUST NOT read layout (`getBoundingClientRect`, `offsetTop`, `scrollHeight`,
   computed style). Reads happen before or after the write batch.
3. Apply MUST hold **E9** (≤ 4 ms). Overrun MUST be reported (§5.9.5).
4. Registry maintenance is O(1): register on construct, unregister on removal including all
   descendants. A leaked registry entry is a memory leak and a latent wrong-target bug.

#### 5.9.2 Interaction ownership (closes D6)

| Class | Owner | Rule |
|-------|-------|------|
| `:hover`, `:active`, `:focus-visible`, CSS transitions | Client, natively | Free once the surface is a real document. Never round-tripped. |
| Scroll movement | Client, immediate | Local scroll paints at once; the intent and echo suppression follow. |
| Caret and selection | **Client-authoritative** | §5.9.3 |
| Typed character echo | Client, immediate | Local echo; upstream reconciles per §5.9.3 |
| Focus ring, control state | Client immediate, reconciled | Upstream `patch` wins only on genuine conflict |
| Navigation, submit, any document change | Virtual, authoritative | The client MUST show an instant local progress affordance so the delay reads as loading, not as a dead click |

**Principle:** anything the user perceives as immediate feedback is produced locally and reconciled by
the authoritative stream. The engine MUST NOT block a perception on a round trip.

#### 5.9.3 Caret and selection (amends input §7.2)

1. Caret position and selection range are **owned by the client** and are never dictated by Virtual.
2. While a control is dirty, an upstream `speculum-input-value` that differs MUST be applied **without
   moving the caret**: reconcile the value and restore the caret to its logical position.
3. If reconciliation cannot preserve that position, the client MUST prefer the user's caret and report
   the conflict. Under **K4**, a caret that jumps while the user types is one of the most perceptible
   defects a text interface can have.

#### 5.9.4 Scroll

Local scroll applies immediately and paints at once (**P4**). Intents are coalesced per scroller, last
sample. Echo suppression is unchanged from the Dom-plane seal: Virtual records the last position it
applied from a client intent and does not emit an observed scroll equal to it. Scroll is never dropped
under inject-chain pressure; it collapses to the latest sample for that scroller.

#### 5.9.5 Client → server control channel

The client MUST send `PageProjectionClientState` on change and at most every `clientStateMs`
(default **1000**):

```
PageProjectionClientState {
  visibility:            "visible" | "hidden"
  appliedThroughSequence: u32
  queuedFrames:           u16
  applyP50Ms, applyP95Ms: f32
  overrunCount:           u32     // applies exceeding E9 since the last report
}
```

The producer uses it for the rate policy (§5.3.5). It is a control message, not a diff; it MUST NOT
affect `sequence`.

### 5.10 Cssom plane

C1–C9 are kept, with four deltas:

1. **Encoding** follows §5.5; a Cssom id is a `uint32` in the same numeric space as Dom ids, and the
   opcode disambiguates sheet from rule.
2. **Chronology** follows the frame model: Cssom ops ride in the same frame and share the `sequence`.
3. **Ordering:** `cssomInstall` precedes `establishChunk` (§5.4.3) so the parser never paints unstyled
   content.
4. **Coalescing** applies to this plane too: within a frame, repeated writes to the same rule collapse
   to one `cssomPatch`; a sheet added and removed within the frame is never sent.

Scope enforcement (C7 `main` | `pierceHost`) is unchanged and MUST be preserved: a flattened tree in a
single document would otherwise let pierced CSS leak into the parent. Measured `install` cost is
~18 ms for 4462 rules — this plane is not a bottleneck and MUST NOT be redesigned beyond the above.

### 5.11 Input (amends input §6.7 and §11)

1. **Intents address elements by `uint32` id**, not by `speculum-anchor` string. The attribute does not
   exist on Virtual, so the sidecar resolves through the reverse map of §5.1.2. A resolution miss
   follows the existing race policy (input §8: retry, then drop with `AnchorMiss`).
2. Pointer coordinates remain surface CSS pixels mapped to the Virtual viewport (input §6.3), with the
   iframe adjustment of §5.8.7.
3. Everything else in [input.md](input.md) stands: no wire `click`,
   CDP-only dispatch, the inject chain, move collapsing under pressure, file upload via `setFiles`,
   disarm while desynced, the two scroll intent types.
4. Input intents MUST NOT be sent before arming (§5.6.7).

### 5.12 Asset plane (closes D7)

#### 5.12.1 Serving rules

1. **Priority.** CSS and in-viewport images are fetched ahead of everything else; below-fold and
   decorative assets are deferred. **P1** depends on this as much as on establish speed.
2. **No blocking await on the paint path.** The `cache`-mode await-then-404 behaviour MUST NOT stall
   first paint; a slow asset degrades that element only.
3. **Honour upstream cache headers within the session**, so re-navigation inside a session is nearly
   free — this is where most repeat traffic actually is.
4. **Coalesce duplicate in-flight requests**, within a session and across sessions (§5.12.2.4).
5. **Fix the rewrite defects**: `virtualData1x1`, cloudinary paths emitted without a public id, the
   bare-root 400 on `/virtual-assets/{host}/`. These are **K4** failures and they also generate
   useless origin traffic.

#### 5.12.2 Two-tier cache

**Rationale.** Refetching an identical public asset once per session wastes origin round trips on the
paint path, and storing it once per session multiplies host RAM by the session count — direct costs
against **P1** and **E7**. Byte content carrying no session identity is not session state.

**Layer.** The shared tier MUST live in the **virtual-assets serve plane**, the only layer that sees
all sessions. Each Virtual Chromium already caches within its own profile, which solves nothing across
sessions.

| Tier | Contents | Scope |
|------|----------|-------|
| **L1** | Everything the session fetched, including credentialed and private responses | Per session, authoritative for it |
| **L2** | Only entries satisfying the predicate below, stored **once**, reference-counted | Host-wide |

An L1 entry whose content is shareable holds a **reference** into L2, never a copy.

**1. Shareability predicate — an entry enters L2 only if ALL hold:** the request carried no `Cookie`
and no `Authorization`; the response is not `Cache-Control: private`, `no-store` or `no-cache`; the
response does not `Vary` on `Cookie` or `Authorization`; the status is cacheable per HTTP semantics
(**errors are never shared** — one session's 404 must not become another's, cf. BZ7); and the request
is a **subresource** fetch, never a navigation document, XHR or `fetch` API response.

Anything failing the predicate stays in L1 only. This is not a conservative default to relax later —
**it is the boundary between "public bytes" and "session state"**, and it is what keeps K2 intact.

**2. Cache key** = scheme, host, port, path, full query **after stripping only Speculum-reserved
parameters**, plus the values of every request header named in the response's `Vary`, plus the
credential mode. **Never the URL alone.** Signed CDN URLs with expiring tokens differ in the query and
key differently — a correct miss rather than a wrong hit.

**3. Revalidation.** `ETag` / `Last-Modified` are honoured; a session's conditional revalidation
refreshes the shared entry; a `304` must not be mistaken for an empty body.

**4. In-flight coalescing.** Concurrent requests for the same L2 key across sessions join one origin
fetch. This is the main **P1** win at density: sessions 2..N pay memory speed instead of an origin
round trip.

**5. Media stays out of L2.** Pass-through (`video/*`, `audio/*`, HLS/DASH segments) is streamed,
large and usually behind expiring signed URLs.

**6. Accounting.** L2 has a host-wide byte cap with LRU eviction (**E7b**); L1 has a per-session cap
(**E7**). Eviction from L2 while a session holds a reference MUST NOT invalidate that session's view.

**Precedent and accepted residual.** Browsers moved from a global HTTP cache to a **partitioned** one
(Chrome, Firefox, Safari, ~2020) because an unpartitioned cache leaks across security boundaries — by
content when responses are personalized, and by **timing**, since a fast hit reveals someone already
fetched that URL. The predicate closes the content leak. The timing channel remains and is
**accepted**: it can only reveal that *some* session fetched a public credential-less asset, it
carries no session identity, and Speculum sessions are not mutually hostile tenants. If that
assumption changes, the mitigation is a normalized first-read latency, not removing L2.

### 5.13 Session lifecycle

1. **Pre-warmed pool.** Chromium boot is **3200 ms** today, paid on every session start (`bootMs`,
   `parityhop-*`). A pool of pre-launched, never-navigated instances removes it from the user's
   critical path (**E10**).
2. **K2 guarantee, mandatory and tested:** an instance is handed out **clean** — fresh context and
   profile, never navigated — and an instance released by a session is **destroyed**, never recycled.
   Pooling clean resources is not sharing state; getting this wrong is a cross-session data leak.
   Test `PP-SESS-2`.
3. Pool size and refill rate are configurable (§5.16); refill MUST be throttled so a burst of session
   starts cannot saturate the host.
4. `bootMs` MUST remain reported separately from load time and MUST NOT be mixed into any site-load
   verdict.

### 5.14 Admission and degradation

1. Capacity admission MUST be gated on **measured** host resources (CPU, memory, pool availability),
   not a configured session count.
2. Per-session budgets: frame rate, `maxFrameBytes`, bytes/s and a CPU share. A session exceeding them
   degrades — frame rate first — and the degradation is reported.
3. A single session MUST NOT be able to consume the host. A mutation storm, a runaway ad or an infinite
   render loop degrades that session only. Test `PP-LOAD-3`.
4. Ladder and thresholds are configuration, calibrated by **O4**.

### 5.15 Telemetry (closes D5)

1. The unit is the **frame**. Default facts per load MUST hold **E8** (≤ 50).
2. Default-on facts: `Establish.Started` / `.Completed` (with phase timings) / `.Failed`,
   `Diff.GenerationBumped`, `Diff.Desynced` (with trigger), `Diff.ResyncRequested` / `.ResyncServed`,
   `Frame.RateChanged`, `Frame.ClockStalled`, `Frame.ApplyOverrun`, `Session.PoolAcquired` /
   `.PoolReleased`, `Asset.ServeMiss` / `.ServeSlow`, and a periodic `Frame.Aggregate`
   (frames, ops, bytes, apply p50/p95) at `aggregateIntervalMs`.
3. Per-frame and per-operation facts exist **only** under the ParityDebug pack, with its cost
   documented. Disabled emitters MUST early-return **before any allocation**.
4. Catalogue prefix `Telemetry.Sessions.PageProjection.*`; planes MUST NOT share facts.
5. Every catalogued failure carries `errorCode` + `phase` (engineering-standards).
6. The PageEpoch story machinery and `build-page-epoch-story.cjs` are kept; only the unit changes.

### 5.16 Configuration surface

Runtime-configurable under Sessions → PageProjection. Every value below is a **starting default** that
an implementation MUST use until **O4** replaces it.

| Knob | Default | Notes |
|------|---------|-------|
| `frameRateHz` | 60 | target rate |
| `frameRateLadder` | 60,30,15,5 | degradation steps |
| `hiddenRateHz` | 1 | client reports hidden |
| `rateRecoverMs` | 5000 | minimum interval between upward steps |
| `frameStallMs` | 1000 | clock watchdog (§5.3.4.4) |
| `maxFrameBytes` | 1 MiB | split into parts, never drop |
| `establishChunkBytes` | 64 KiB | establish chunk target |
| `swapTimeoutMs` | 1500 | double-buffer swap fallback |
| `clientStateMs` | 1000 | client control report interval |
| `applyBudgetMs` | 4 | client overrun threshold (E9) |
| `mirrorMaxBytes` | 4 MiB | per session (E7) |
| `assetCacheL1MaxBytes` | 8 MiB | per session, LRU (E7) |
| `assetCacheL2MaxBytes` | 1 GiB | host-wide, LRU (E7b) |
| `assetCacheL2Enabled` | true | kill switch; false ⇒ every session L1-only |
| `assetPriorityViewportPx` | 200 | prefetch margin |
| `browserPoolSize` | 8 | pre-warmed instances |
| `browserPoolRefillPerSec` | 2 | refill throttle |
| `aggregateIntervalMs` | 10000 | `Frame.Aggregate` period |
| existing input knobs (input §11) | unchanged | |

**Deleted:** every coalesce knob from `coalesce.md` (`strategy`, `coalesceWindowMs`,
`maxWaitMs`, `maxBufferBytes`, `maxOpsPerFlush`) and `PageProjectionDiffQueueCapacity` as a load
control. Validation MUST reject values that could stall emission indefinitely.

---

## 6. What is kept (do not re-debate)

- Dom / Cssom **plane split**, shared `sequence` and `generation`, one pipe (C1, C9).
- **ACID validate-then-apply** — strengthened, since a frame is a larger atomic unit.
- Cssom operation vocabulary (C3) and the C3.1 anti-flicker rules; **owned CSSOM** on the client
  instead of URL reload (C6).
- **Generation policy** (T3/D4): bump only on a real top-level Document swap; pierced document swaps
  never bump (G-B).
- Node-side **mirror** for OOB resync — proven (`domMapMs` 6609 → 50 ms).
- **Placeholder** set and interior rules (T13).
- The **input contract**, except §6.3, §6.7, §7.2, §11 and §14.3 as amended here.
- **PageEpoch / ParityDebug** instrumentation.
- **Resync is OOB** and MUST NOT advance the live `sequence`; input stays disarmed while desynced; one
  desync covers both planes (T8, C8, D12).

---

## 7. The oracles (WP1/WP2 — nothing else starts first)

The engine degenerated because **the only automated verdict measured the pipe**: a run could report
`FrameReceived = WireDelivered = 6964`, `QueueDropped = 0` and a contiguous sequence while the hero
banner was blank (BZ5) and product images were collapsed to slivers (BZ6).
[acceptance.md](acceptance.md) states the right bar in prose and has
**no assert**.

| # | Oracle | Definition |
|---|--------|------------|
| **O1** | **Visual diff** | Screenshot Virtual and Projected at the same viewport and defined settle points; assert **P7**. **Region-aware:** a connected differing region covering ≥ **2%** of the viewport area, or any region where one side has rendered text and the other does not, is a **structural region** and fails regardless of the global pixel percentage. This is what would have caught the blank hero. |
| **O2** | **Structural self-check** | Compare `F(Virtual)` against the Node mirror and against the client tree; all three MUST be isomorphic. Converts the ghost-desync class into a CI assert and is what makes net-effect coalescing safe. **Full comparison is CI and debug only** — it costs O(nodes) and would violate E1 in production. Production runs a cheap variant: node count plus a rolling checksum of the mirror against a client-reported checksum, at `aggregateIntervalMs`; a mismatch triggers desync. |
| **O3** | **Budget gate** | §2 enforced in CI. Exceeding any of P1–P7 or E1–E11 fails the build. |
| **O4** | **Density harness** | Drive N concurrent sessions against a heavy commerce page, a live-odds page and a soft-nav SPA; report per-session p50/p95 of P1–P6 plus host CPU, memory and rate degradation. Purpose: find the **knee** — the session count at which per-session experience degrades — and make it a tracked regression metric. **K3 cannot be claimed without it.** |
| **O5** | **Interaction latency probe** | Automated click, type and scroll measuring time-to-local-feedback and time-to-authoritative-effect; asserts P4/P5, including with the network artificially stalled. D6 is invisible to every other diagnostic. |

O1, O2 and O5 MUST run against at least `www.belezanaweb.com.br` (heavy commerce, the existing
baseline), an Eneba soft-nav flow, and a live-odds page.

---

## 8. Test matrix

Coverage truth for this engine, in the style of `Speculum.Api.SessionsTest.Tests/MATRIX.md`. Every row
MUST be an effect assert; `200` / `ok: true` / a delivered frame count never proves a row. No row may
be softened or skipped (`docs/assert-failure-policy.md`).

| ID | Assert |
|----|--------|
| `PP-ID-1` | No `speculum-anchor` or `speculum-last-mutation-sequence` attribute exists in the Virtual DOM at any point in a session |
| `PP-ID-2` | Cloning a published node yields a distinct id; no duplicate ids are ever emitted |
| `PP-ID-3` | Text and comment nodes receive ids and are addressed directly; no `childAt` form appears on the wire |
| `PP-ID-4` | The reverse id map releases detached nodes; it does not grow without bound over a 5-minute soak |
| `PP-F-1` | Projected tree is structurally isomorphic to `F(Virtual)` after settle (O2) |
| `PP-F-2` | Adjacent text nodes are published 1:1 without collapsing; the client never calls `normalize()` |
| `PP-F-3` | Slotted shadow content publishes the flattened rendered result |
| `PP-F-4` | Closed shadow roots and cross-origin iframes are pierced and published |
| `PP-F-5` | `<title>`, `lang`, `dir` and `meta viewport` are projected; an RTL page renders RTL |
| `PP-D16-1` | `showModal()` on Virtual produces a modal dialog on Projected: top layer, backdrop, inertness |
| `PP-D16-2` | Popover shown on Virtual is shown on Projected |
| `PP-D16-3` | Media pause / seek on Virtual is reflected on the client's media element |
| `PP-D16-4` | `setCustomValidity` makes `:invalid` match on Projected |
| `PP-FR-1` | A node created and destroyed within one frame is never sent |
| `PP-FR-2` | A 200-node subtree rendered in one task produces exactly one `childList` entry, not 200 operations |
| `PP-FR-3` | N attribute writes to one node within a frame produce exactly one `patch` |
| `PP-FR-4` | A frame with no operations consumes no `sequence` |
| `PP-FR-5` | Records for non-published subtrees are discarded before any identity or payload work |
| `PP-FR-6` | Frames applied to the client tree yield a tree identical to Virtual (O2) over a 5-minute soak on a live-odds page |
| `PP-FR-7` | With the page not focused, the frame clock still runs at `frameRateHz`; the watchdog fires if it does not |
| `PP-FR-8` | A frame exceeding `maxFrameBytes` is split into parts, applied as one transaction; a missing part desyncs |
| `PP-MOVE-1` | Moving a node containing a playing `<video>` preserves playback; the node is not destroyed and recreated |
| `PP-MOVE-2` | Moving a node containing the focused element preserves focus |
| `PP-MOVE-3` | Moving a scrolled container preserves its scroll offset |
| `PP-WIRE-1` | The API never parses a frame body; relay cost is O(1) in payload size |
| `PP-WIRE-2` | An unknown frame version desyncs, never a best-effort parse |
| `PP-WIRE-3` | No `JSON.stringify` / `JSON.parse` occurs on the frame or establish path |
| `PP-EST-1` | Establish streams; the surface paints before the stream completes |
| `PP-EST-2` | Establish holds **E2** at 20k nodes |
| `PP-EST-3` | **Handoff:** mutations during establish are neither lost nor double-applied (drive continuous mutation during establish, then assert O2) |
| `PP-EST-4` | Scroll position at establish time is restored before arming |
| `PP-EST-5` | Pointer intents are not sent before arming; pre-arm clicks are queued or visibly refused, never silently mis-targeted |
| `PP-EST-6` | `cssomInstall` is applied before the first chunk reaches the parser; no flash of unstyled content |
| `PP-EST-7` | An `establishEnd` `nodeCount`/`checksum` mismatch desyncs |
| `PP-SURF-1` | A media query matching in Virtual matches in Projected at the same viewport |
| `PP-SURF-2` | `position: fixed` elements stay fixed to the surface viewport on scroll |
| `PP-SURF-3` | No script executes in the Projected surface even when a `<script>` is injected into the payload |
| `PP-SURF-4` | No CSS text rewriting occurs anywhere in the client |
| `PP-SURF-5` | A client zoom or DPR change produces a Virtual viewport update and correct hit-testing afterwards; a stable screen produces zero `Resize` |
| `PP-NAV-1` | Hard navigation shows no blank frame; the old document is held until the new one paints (**P6**) |
| `PP-NAV-2` | Soft navigation does not bump `generation` and does not re-establish |
| `PP-NAV-3` | The retired buffer's registry, owned CSSOM and id map are fully released |
| `PP-LOAD-1` | Under induced congestion the frame rate degrades and **no** desync occurs |
| `PP-LOAD-2` | `QueueDropped` is zero under sustained overload; drops occur only on genuine faults |
| `PP-LOAD-3` | A session with a runaway mutation loop degrades itself and does not affect other sessions |
| `PP-LOAD-4` | A client reporting `hidden` drops to `hiddenRateHz` and resumes correctly with no desync |
| `PP-REC-1` | Each §5.7.1 trigger desyncs, and only those; overload never does |
| `PP-REC-2` | Resync is served from the Node mirror without involving the page, and the surface is correct afterwards (O1) |
| `PP-REC-3` | Resync does not advance the live `sequence`; buffered frames drain correctly against the watermark |
| `PP-IN-1` | Hover, active and focus-visible are visible within **P4** with the network stalled |
| `PP-IN-2` | Typing does not move the caret when an upstream value patch arrives (§5.9.3) |
| `PP-IN-3` | Scroll paints within **P4** with the network stalled |
| `PP-IN-4` | Click to authoritative effect holds **P5** |
| `PP-IN-5` | Intents address by `uint32` id and resolve through the reverse map; a miss follows the retry-then-drop policy |
| `PP-ASSET-1` | CSS and in-viewport images are fetched before below-fold assets |
| `PP-ASSET-2` | A stalled asset degrades that element only and does not delay first paint |
| `PP-ASSET-3` | `brokenImgs = 0` and `virtualData1x1 = 0` at settle on the baseline sites |
| `PP-ASSET-4` | The per-session L1 cache respects its LRU byte cap |
| `PP-ASSET-5` | Two concurrent sessions requesting the same public asset produce **one** origin fetch and **one** stored copy; the second is served at memory speed |
| `PP-ASSET-6` | L2 respects its host cap with LRU; eviction while a session holds a reference does not invalidate that session's view |
| `PP-ASSET-7` | Signed CDN URLs with differing query tokens key differently — a miss, never a wrong hit |
| `PP-ASSET-8` | With a warm L2, session N's **P1** is at least as good as session 1's |
| `PP-ISO-1` | A response fetched with `Cookie` or `Authorization`, or marked `private`/`no-store`, or varying on `Cookie`, never enters L2 and is never served to another session |
| `PP-ISO-2` | No session state crosses sessions: cookies, storage, CSSOM, DOM, id space and credentialed responses stay per session |
| `PP-ISO-3` | An error response is never shared; one session's 404 does not become another's |
| `PP-SESS-1` | Session start holds **E10** with a warm pool |
| `PP-SESS-2` | A released browser instance is destroyed and never handed to another session |
| `PP-TEL-1` | Default telemetry holds **E8**; disabled facts allocate nothing |
| `PP-TEL-2` | Every catalogued failure carries `errorCode` + `phase` |
| `PP-DEN-1` | 100 concurrent sessions hold the P1–P6 percentiles (**O4**) |
| `PP-DEN-2` | The degradation knee is measured and recorded as a regression metric |

---

## 9. Module layout, size ceilings and deletions

The current producer and applier total ~230 KB across three files (`DomTreeSerializer.ts` ~94 KB,
`PageProjection.ts` ~87 KB, `PageProjectionDiffApplier.ts` ~53 KB) — beyond practical review, which is
how the defects in §3 survived. **No file may exceed 600 LOC.** Orchestration files MUST contain no
algorithm.

```
sidecar/browser/patchright/mirror/page/
  identity.ts       WeakMap + reverse map, id allocation (§5.1)     ≤ 250
  fmap.ts           F: publish rules, attrs, placeholders, URLs      ≤ 500
  observe.ts        MO install, pierce lifecycle, state sensors      ≤ 400
  frame.ts          accumulation, coalescing, flush (§5.3)           ≤ 500
  clock.ts          unthrottled frame clock + rate policy (§5.3.4-5) ≤ 200
  encode.ts         binary writer + string table (§5.5)              ≤ 300
  establish.ts      HTML stream + handoff (§5.6)                     ≤ 350
  cssom.ts          Cssom sensors and ops (§5.10)                    ≤ 400
  channel.ts        page → Node push channel, chunking (§5.7)        ≤ 200
  PageProjection.ts orchestration only                               ≤ 300

sidecar/browser/patchright/mirror/page/node/
  mirror.ts         decoded mirror, frame apply, HTML serialize      ≤ 400
  rewrite.ts        URL rewriting on the Node side                   ≤ 300

web/src/features/sessions/live/page/
  registry.ts       Map<u32, Node>                                   ≤ 150
  decode.ts         binary reader + part assembly                    ≤ 300
  applyDom.ts       Dom apply (§5.4, §5.9.1)                         ≤ 400
  applyCssom.ts     Cssom apply                                      ≤ 300
  surface.tsx       iframe host, double buffer, arming (§5.8)        ≤ 350
  interaction.ts    local-first + intents (§5.9)                     ≤ 400
  clientState.ts    control channel (§5.9.5)                         ≤ 150
  ProjectionClient.ts orchestration only                             ≤ 300
```

**Deleted at cutover** (no aliases, no dead code left behind):
`sidecar/.../mirror/dom/DomTreeSerializer.ts`, `mirror/dom/PageProjection.ts`,
`mirror/dom/parityUtil.ts`, `mirror/dom/VirtualEpochTelemetry.ts` (folded into §5.15),
`web/.../live/dom/PageProjectionDiffApplier.ts`, `live/dom/DomProjector.tsx`,
`live/dom/rewriteHtmlBodySelectors.ts` and its test. `live/dom/DomElementInput.ts` and
`mirror/dom/DomElementInput.ts` are **ported**, not deleted (id addressing per §5.11).
`mirror/dom/DomAssetCache.ts` and `srcsetParse.ts` are **kept**.

**Kept, not rewritten:** gRPC and proto plumbing, the hub, fan-out, admission, configuration,
telemetry transport, the input admission and inject chain, and the virtual-asset serve plane (fixed
per §5.12, not rebuilt).

**Verification during the rewrite:** run the old and the new producer against the same page **inside
the harness** and compare outputs node by node. This is a test fixture, not a product shim, and does
not violate the no-V1-aliases rule.

---

## 10. Work packages

A package is complete when **all** its tests pass and **all** its budgets hold. Not when the code is
written, not when most tests pass.

| WP | Content | Exit criteria |
|----|---------|---------------|
| **WP1** | Oracles O1, O2, O3, O5 against the **current** engine | All four run in CI and **fail** on today's engine with the §3 defects visible. An oracle that passes today is broken and must be fixed before anything else proceeds. |
| **WP2** | O4 density harness | Produces a knee curve for the current engine; `PP-DEN-2` records the baseline |
| **WP3** | Identity + registries (§5.1) | `PP-ID-1..4`; O2 still passes |
| **WP4** | Frame model, clock, rate policy, declarative `childList` (§5.3, §5.4.2) | `PP-FR-1..8`, `PP-MOVE-1..3`, `PP-LOAD-1..4`; E3, E4 |
| **WP5** | Binary wire, part splitting, relay-only API, telemetry unit (§5.5, §5.15) | `PP-WIRE-1..3`, `PP-TEL-1..2`; E5, E8 |
| **WP6** | Node mirror + recovery (§5.7) | `PP-REC-1..3` |
| **WP7** | Surface as a real document, zoom/DPR (§5.8.1–4, §5.8.6) | `PP-SURF-1..5`; O1 improves measurably |
| **WP8** | Double buffering (§5.8.5) | `PP-NAV-1..3`; P6 |
| **WP9** | Streamed establish, handoff, arming, CSSOM ordering (§5.6, §5.10.3) | `PP-EST-1..7`; E2, P1, P2 |
| **WP10** | Local-first interaction, caret, control channel, id-addressed intents (§5.9, §5.11) | `PP-IN-1..5`; P4, P5 |
| **WP11** | Node-state extensions (§5.2.1) | `PP-D16-1..4` |
| **WP12** | Asset plane and two-tier cache (§5.12) | `PP-ASSET-1..8`, `PP-ISO-1..3`; P1 |
| **WP13** | Browser pool + admission (§5.13, §5.14) | `PP-SESS-1..2`; E10 |
| **WP14** | Density calibration | `PP-DEN-1` at 100 sessions; §5.16 knobs set from measurement; E6, E7, E7b, E11 |
| **WP15** | CDP spike (below) | Decision recorded: adopt or reject, with evidence |
| **WP16** | Doc closure | Supersession banners, T11/T12 closed, amended contracts updated, §11 published in the support matrix |

**WP15 — spike, not a commitment.** `DOMSnapshot.captureSnapshot` returns the flattened tree from the
browser process in columnar form — already the shape §5.5 wants — with `backendNodeId` as a
browser-side identity that could serve as the id in §5.1 with no allocation. Verify before adopting:
coverage of closed shadow roots and cross-origin iframes; the cost of `DOM.enable` with node tracking;
and that §5.2.1 state is not in the DOM domain and still needs in-page sensors. Secondary
consideration: heavy in-page instrumentation is more detectable by antibot than CDP traffic.
**Caution:** relocating work does not by itself reduce host CPU — at 100 sessions the total is what
binds. Adopt only where it also reduces total work.

---

## 11. Accepted gaps (K1 + K5 consequences — explicit, never silent)

| Area | Status |
|------|--------|
| `<canvas>` / WebGL pixels | **Not projectable.** Box and `speculum-canvas-placeholder` only. Maps, charts, games, 3D. |
| MSE / DRM playback | Stub attributes; bridges later |
| File / HLS / DASH media | **Works** — bytes via the pass-through serve plane, played by the client's media engine |
| Animations driven by page JS / WAAPI | Only their DOM/CSSOM effects project |
| IME / composition (CJK) | Non-support in V1 |
| Timing-critical interaction (drag, freehand drawing, games) | Bounded by **P5**; cannot beat the round trip |
| Independent client zoom of projected content | **Forbidden** — zoom propagates to the Virtual viewport (§5.8.6); independent zoom would break hit-testing |

`:hover`, `:focus-within`, `:active` and CSS transitions **do** work locally once the surface is a real
document. Text selection and copy work natively — an advantage over pixel-based isolation.

These MUST appear in the product support matrix. An accepted gap that is not published is a bug.

---

## 12. Decisions (all resolved)

| # | Decision | Status |
|---|----------|--------|
| Q1 | §2 budgets (P1–P7, E1–E11) are contract, enforced by O3 in CI | **DECIDED** |
| Q2 | T4/T5 amended: the frame is the atom; net-effect coalescing; one `sequence` per frame; backpressure degrades rate and never desyncs | **DECIDED** |
| Q3 | T4/T7/T9/G-A amended: identity is an off-DOM `uint32` with forward and reverse maps; the address is the id; `childAt`, the F-visible index space and text-run collapsing are deleted | **DECIDED** |
| Q4 | T2/T6/C3 encoding amended: binary frame with part splitting; the API relays without parsing; the `document` op is deleted in favour of `establish*` | **DECIDED** |
| Q5 | `childList` is declarative with an `APPEND` fast path; moves preserve node identity | **DECIDED** |
| Q6 | The Projected surface is a sandboxed same-origin document, double buffered | **DECIDED** |
| Q7 | Establish streams into the parser; HTML is permitted for establish only, verified by `establishEnd` checksum and O2; handoff and arming rules as specified | **DECIDED** |
| Q8 | Local-first interaction classification adopted; caret is client-authoritative (amends input §7.2) | **DECIDED** |
| Q9 | Published node state extended per §5.2.1 (dialog, popover, media, validity) | **DECIDED** |
| Q10 | Frame-rate policy: 60 Hz default, 60/30/15/5 ladder, `hiddenRateHz` 1, recovery throttled, unthrottled clock with watchdog | **DECIDED** |
| Q11 | Per-session and host caps set in §5.16 as starting defaults; O4 recalibrates | **DECIDED** |
| Q12 | Pre-warmed browser pool with the clean-instance / destroy-on-release guarantee | **DECIDED** |
| Q13 | Session state is never shared; credential-less public byte content is deduplicated in L2 under the §5.12.2 predicate. Egress/network behaviour is out of scope | **DECIDED** |
| Q14 | Client zoom and DPR propagate to the Virtual viewport through the existing viewport policy; independent projected zoom is forbidden | **DECIDED** |
| Q15 | Producer and applier are rewritten; plumbing kept; dual-run comparison in the harness; 600 LOC ceiling; deletions listed in §9 | **DECIDED** |
| Q16 | §11 is published in the product support matrix | **DECIDED** |
| Q17 | Supersession banners on the pipeline and coalesce docs; T11/T12 closed; the input doc amended | **DECIDED** |
| Q18 | Input intents address by `uint32` id via the reverse map (amends input §6.7) | **DECIDED** |
| Q19 | Wire `plane` header field removed; one opcode space covers both planes | **DECIDED** |
| Q20 | O2 runs in full only in CI and debug; production uses the cheap checksum variant | **DECIDED** |

To reverse any decision, append to the decision log below and update the affected section. Do not
leave a contradiction in place.

---

## Decision log (append-only)

| Date | Topic | Decision |
|------|-------|----------|
| 2026-08-11 | Meta | Redesign document created. Constraints K1–K5 given. |
| 2026-08-11 | Meta (rev 2) | Added interaction budgets and the local-first principle (D6); asset cost model (D7); session lifecycle and pool; double-buffered navigation; density harness and latency probe; establish↔live handoff and arming; structural record filtering; per-frame sequence; rewrite-vs-refactor method. |
| 2026-08-11 | K2 / Q13 | Session state is never shared; credential-less public byte content is deduplicated in a host-wide L2 tier under the §5.12.2 predicate, reference-counted so bytes are stored once. Motivation: N× origin refetch on the paint path (**P1**) and N× RAM (**E7**). Timing side channel accepted and reasoned. Egress and network-level behaviour declared out of scope. |
| 2026-08-11 | Meta (rev 3) | Converted to implementation specification: normative §5, test matrix, module layout, work packages with test-based exit criteria. Budgets restated as deltas against Virtual and tightened. Text nodes gained ids, deleting `childAt`, the F-visible index space and text-run collapsing. |
| 2026-08-11 | Meta (rev 4) | **Closed every gap; all decisions resolved.** Blocking fixes: input intents re-addressed to `uint32` ids with a reverse id map (Q18 — the previous revision left input resolving a `speculum-anchor` attribute that no longer exists on Virtual); the `document` op deleted in favour of `establishBegin`/`Chunk`/`End`, removing the contradiction between a node-tree document payload and a streamed establish (Q4); the wire `plane` header removed in favour of one opcode space, since a frame carries both planes (Q19). Added: frame-clock specification with background-throttling ban and a stall watchdog (§5.3.4); rate recovery and hidden-rate policy (§5.3.5); part splitting that preserves atomicity (§5.5.3); §5.7 recovery with an exhaustive desync-trigger list and mirror-served resync; the client→server control channel (§5.9.5); `cssomInstall` ordered before establish chunks to fix D-FLASH (§5.4.3); the first-meaningful-paint threshold for the double-buffer swap (§5.8.5); zoom/DPR policy (Q14); Cssom coalescing (§5.10.4); O1 structural-region threshold and O2's production-cost limit (Q20); concrete starting defaults for every knob including the pool; explicit file deletions (§9); `PP-ID-4`, `PP-FR-7/8`, `PP-EST-6/7`, `PP-SURF-5`, `PP-LOAD-4`, `PP-REC-1..3`, `PP-IN-5`, `PP-TEL-2`. |
