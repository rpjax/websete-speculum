# PageProjection — CSSOM poll algorithm (lab design)

**Status:** I3 walk + §4.6 ops on the wire (2026-08-15). **Does not relock [cssom.md](cssom.md) C5**
until Rodrigo seals a sensor change. Phase 1 table applies `SHEET_*`/`RULE_*` so `CHECK` /
`preTableHash` stay honest. **Lab C6 apply is shipped** for constructed / `adoptedStyleSheets` +
`CSSStyleRule` (`client/applyDom.ts`); pierce still desyncs — seal gaps: [seal-gaps.md](seal-gaps.md).
**Code (poll):** `Refactor/sidecar/browser/mirror/projection/virtual/cssom/` + attach at
`virtual/frame/frameEmitter.ts`. **No CSSOM in `virtual/dom/` builders.** Idle hashes the **copy** in
batches (`timeRemaining`); it does not iterate the live `cssRules` list across a yield.  
**Observability of the pass:** [observability.md](observability.md) §9 (`cssomPoll`).  
**Accept bar:** [acceptance.md](acceptance.md) — DOM remains numerical 1:1; **CSSOM live is perceived /
eventual 1:1**, not 60 Hz lockstep. This file does not license declaring site accept from poll
telemetry.  
**Why this detector:** [cssom-sensor-journey.md](cssom-sensor-journey.md) (two truths, ownership).

---

## Design law — worst case first

The algorithm is **specified against the worst load we intend to survive**, not against “typical
CSS rarely changes.”

If the algorithm is **correct, complete (eventually), and schedulable** on that load, cheaper
pages and later **amortizations** only **reduce** cost. They must never become the thing that
makes the design true. They **do** carry perceived CSSOM 1:1 on real sites ([acceptance.md](acceptance.md)) —
intimate with practice, not a substitute for reconcile+idle.

The inverse — design for the static case and hope the adversarial case is rare — is how a poll
becomes an incomplete sensor with a footnote.

**Amortizations are not this algorithm.** Skip `cssText` when identity looks unchanged, authored
`<style>.textContent` as the content signal, round-robin sheets, CDP CSS-domain dirty bits,
prototype write hooks as lab truth — none of these are the completeness path. They may be
considered later only if I1–I11 still hold. Scheduling (idle slices, topological copy) **is**
the algorithm, not an optimization bolted on afterwards.

---

## Worst case (the design load)

The design load is **readable, programmatic CSSOM at Instagram-like volume**, not a CDN
`<link>` the page cannot `cssRules`.

| Axis | Design load |
|------|-------------|
| Readable sheets | ~10, `cssRules` does not throw (`unreadableSheetCount` = 0) |
| Top-level rules | ~14 000 (`topLevelRulesVisited`) |
| Nested rules | ~16 000–17 000 rule objects if walked; grouping `cssText` already includes inners |
| Mutation | In-place `rule.style.*`, `insertRule`/`deleteRule`, `replaceSync` / `replace` (new rule objects), `adoptedStyleSheets` order |
| Concurrency with DOM | Same main thread; DOM tick at ~60 Hz must not *run* the CSSOM pass |
| Sessions | Each Virtual renderer pays this on **its** main thread (×100 is ×100 processes, not one mega-N) |

Lab fixture that instantiates volume: `cssom-scale.html?n=14244&sheets=10&nested=2466`.  
Churn modes (`styleSet`, `insertRule`) instantiate the **mutation** axis of the same load.

Unreadable / cross-origin sheets are **out of this algorithm** (asset plane). They shrink N;
they are not allowed to be the reason the readable worst case works.

---

## Premises (platform — not tunables)

These are facts the algorithm is built on. Changing one is a new design, not a knob.

1. **One JS thread.** There is no parallel CSSOM hash. Idle is cooperative time-slicing on the
   same stack as the page and the DOM producer. Between yields the page **will** mutate CSSOM;
   that is reality, not a race to paper over.
2. **CSSOM has no MutationObserver and no public generation/dirty bit per rule.** Completeness
   means reading live CSSOM and reconciling to the last **committed** snapshot.
3. **`rule.cssText` (or equivalent serialization) is the complete in-page content signal** for a
   rule. Object identity does not see in-place writes. `cssRules.length` does not see in-place
   writes. `<style>.textContent` does not see `insertRule`.
4. **`replaceSync` / `replace` allocate new rule objects.** Identity-only match would emit
   drop+new of the whole sheet — forbidden by C3.1 when we emit. The algorithm must **list-diff**
   (identity first, content/position when identity is gone).
5. **DOM and CSSOM mutate disjoint table row kinds** (nodes vs sheet/rule). They share
   `sequence` / `generation` / one pipe ([cssom.md](cssom.md) C1, frame-protocol §1.1). They must
   not share a drain function or a builder file.
6. **Antibot:** no prototype hooks as the lab sensor; no CDP CSS-domain dirty bit. Inject remains
   CDP init script; data plane is not page `WebSocket` (E-03/E-08).
7. **Eventual CSSOM vs DOM ticks is a clock contract**, not a performance trick: a coherent
   CSSOM **commit** may attach on a **later** frame boundary than the DOM mutations of the same
   wall time. Inserts that miss a pass’s topological copy wait for the **next** pass. That lag
   is part of this algorithm. It is **not** site accept (acceptance.md).
8. **A live `cssRules` walk that yields mid-list is unsafe.** `replaceSync` / insert / delete
   during the loop tears the epoch (mix of old and new objects as if one snapshot). Yield is
   allowed only **after** a topological copy of refs (phase A), hashing **the copy** (phase B).

---

## Invariants (the algorithm must keep)

**I1 — Eventual completeness; a commit is garbage-free.** Every readable rule that stays live
long enough appears in some **committed** snapshot. A single commit must not mix two sheet
epochs, must not hash dead refs, and must not treat a mass-stale copy as “sheet empty.”
`insertRule` after the topological copy that was not hashed this pass is **omitted** (next
pass) — never `RULE_NEW` without text. Cancelled idle, halt, or **aborted sheet** → no commit
for that sheet. A cancelled pass must not write torn `lastRules`.

**I2 — Worst-case pass is a full readable scan of the copy.** A committed pass classifies all
sheets, then for every readable sheet that is not aborted, serializes **every live ref in that
sheet’s topological copy**. Skipping serialize because “probably static” is not part of this
algorithm. An aborted sheet retries on the next pass (still a full scan of the new copy).

**I3 — Topological copy atomic; content walk sliceable.** Phase A (cheap, synchronous, no
yield): copy `cssRules.item(i)` **refs** + length for that sheet — not `cssText`. Phase B
(idle): hash `cssText` on that copy, yielding between **batches** of rules. A 14k-rule sheet
may span many idle slices. The walk must stay resilient across yields (stale skip / mass
abort). **Do not** iterate the live list across a yield.

**I4 — Idle ≠ DOM drain.** CSSOM CPU must not run inside `TableFrameBuilder.build` /
MutationObserver drain. Work is `requestIdleCallback` (timeout fallback). The frame pipe only
**takes a finished pass** at `FrameEmitter` boundary.

**I5 — Attach on next boundary, one pipe.** A finished pass is pending until the next frame
clock `onBoundary` (including ticks that publish no DOM frame). Same `sequence` space when ops
exist. No second CSSOM sequence. No CDP merge.

**I6 — Identity then content.** Rules are keyed by live `CSSRule` object (WeakMap) across
**committed** passes. Content hash detects in-place change. Membership/order change is
`ruleListChanged`. `replaceSync` → appeared/disappeared after a **successful** pass on the new
objects, then content list-diff — never `SHEET_DROP` of a live sheet to refresh rules (C3.1),
and never commit DROP×N from a mass-stale in-flight copy.

**I7 — Unreadable isolation.** `cssRules` `SecurityError` increments `unreadableSheetCount` and
skips that sheet. It must not abort the pass or poison readable sheets.

**I8 — Halt vs snapshot vs resync.** Stop/cancel idle; drop in-flight uncommitted pass. Snapshot
default (`flushAndSnapshot` / `takeSnapshot` with `cssom: 'none'`) does not wait for CSSOM.
`cssom: 'committed'` takes a finished pass; `cssom: 'scan'` blocking-scans (debug). **Resync
always blocking-scans CSSOM** (`rebuildAndResync` / `emitResyncFrame`) — rare, full cost.
CSSOM halt-blindness on a `none` snapshot is explicit (same class as the live eventual clock).

**I9 — Folder split.** Algorithm use cases at `virtual/resync.ts` (system resync) and
`virtual/snapshot.ts` (tunable snapshot). `virtual/dom/` = DOM plane (including `domResync.ts`).
`virtual/cssom/` = CSSOM plane (`CssomPlane`). `virtual/frame/` = pipe only. CSSOM must not
edit `tableFrameBuilder` / `applyDom` / `domResync`. `bootstrap.ts` wires only.

**I10 — Telemetry is not truth.** `cssomPoll` investigates cost, I3 abort/skip, and §4.6 op counts
for **idle**, **resync**, and **snapshot scan**. Table × owned CSSOM isomorphism, when it exists, is a
**probe at sequence S** — [observability.md](observability.md). `pollMs` is **wall** time (includes
waits between idle slices); it is not CSSOM CPU.

**I11 — Emit granularity (when opcodes land).** Smallest sufficient op: `CSSStyleRule` in-place →
`RULE_SET`; grouping-rule content change (in-place patch cannot work) → `RULE_DROP` + `RULE_NEW`;
structural → `RULE_NEW`/`RULE_DROP`/`SHEET_*` as in §4.6. No live full-text sheet rewrite.

---

## Walk (A / B / commit)

Mutations **between yields are accepted as reality.** The walk is designed so garbage from the
last yield is skipped, discarded, or the sheet is aborted — never committed as mixed-epoch
truth.

### Phase A — topological copy (atomic, cheap)

At the start of work on a sheet (one synchronous slice, no `cssText`):

- Record sheet identity (`CSSStyleSheet` object).
- Copy `length` and `cssRules.item(0 .. n-1)` **object refs** in order.

This is **not** a content snapshot. Pointers only.

### Phase B — hash the copy (idle, batched)

On idle, walk **the copy**, not the live list:

- While `deadline.timeRemaining()` is above a small floor (or the timeout fallback fires),
  process the next **batch** of refs. **Not** one `requestIdleCallback` per rule.
- Before reading `cssText`: if the ref is garbage since the last yield — object gone,
  `parentStyleSheet !== sheet`, or the object is no longer in the live list — **discard the
  slot** (treat as disappeared / replaced). Do not serialize a corpse; do not invent `RULE_SET`.
- Else: hash current `cssText` (in-place writes since copy start are the current truth for
  that object).

### Stale policy

| Observation | Action this pass |
|-------------|------------------|
| One / few refs dead; sheet still mostly the same objects | Skip those slots; they disappeared or were replaced |
| `insertRule` after A; new objects not in the copy | Do not invent NEW without text; **next pass** (new copy) sees them |
| `deleteRule` of a copied ref | Slot stale → skip (disappeared vs last commit at commit time) |
| In-place `style.*` on a still-live copied ref | Hash whatever `cssText` is **now** |
| **Mass divergence** (`replaceSync` / almost all copy refs stale / length exploded vs copy) | **Abort the sheet:** drop in-flight hashes; **do not commit**; do not emit DROP×N then NEW×N. Next pass copies the post-replace world and scans that |
| Halt / snapshot `cssom: 'none'` | Abort whole uncommitted pass (I8) |
| Resync (`emitResyncFrame` / `rebuildAndResync`) | Blocking CSSOM scan; never a partial CSSOM resync |

Mass abort exists so C3.1 is not violated by a **false empty sheet** at commit. The worst case
still pays a full 14k `cssText` on the **following** pass; it must not pay a lying frame.

### Commit (cheap identity + only hashed content)

When phase B finishes for the sheets in the pass (or the pass is ready to commit):

1. Re-read **live** topology (refs + order) — cheap, no required full serialize.
2. List-diff last **committed** membership vs live membership + hashes **actually obtained**.
3. Live refs that were hashed → content compare / `RULE_SET` when ops exist.
4. Copy refs that are dead → disappeared (if they were in last commit).
5. Live refs **not** in the copy and **not** hashed → leave for the next pass (no `RULE_NEW`
   without text).
6. If the sheet was aborted in B → skip 2–5 for that sheet; `lastRules` unchanged.

Whole-pass `lastRules` updates only for sheets that committed. One torn sheet must not poison
other sheets in the same pass (I7-class isolation for abort).

---

## What this algorithm is (one paragraph)

On a floor interval (`cssomPollHz` → min interval between **starts**), an idle scheduler
classifies `document.styleSheets` + `adoptedStyleSheets`. For each readable sheet it takes an
atomic **topological copy** of rule refs, then hashes `cssText` on that copy in idle batches
(yield when the deadline is exhausted). Stale refs are skipped; a mass-stale sheet is aborted.
Inserts that missed the copy wait for the next pass. When the pass can commit, it reconciles
live membership to last committed using only hashes it actually has, sets **pending**, and the
DOM frame emitter takes pending on the next boundary (telemetry now; `SHEET_*`/`RULE_*` when
the wire is wired). The DOM producer is unaware of the pass. The worst case is still “all
readable rules, mutating,” fully scanned — scheduled off the DOM drain, eventually attached,
without a torn mixed-epoch commit.

---

## Use cases (not plane toggles)

These are **algorithm** use cases. `emitResyncFrame` / `rebuildAndResync` are not “DOM folder
APIs”; they orchestrate the system. Protocol §5.8 still says `resyncVirtual` for the rebuild
strength — that name is `rebuildAndResync` in code.

| Use case | What is in the result | CSSOM cost |
|----------|----------------------|------------|
| **Live ticks** | DOM frame at ~60 Hz; CSSOM pending attached on the next boundary (eventual) | Idle slices; degrade with the page |
| **Resync** | One `resync` frame, one `CHECK`, **both** planes. Always. No CSSOM-only or per-rule resync frame | Halt in-flight idle; **blocking** full readable scan; pay even if rare (~tens of ms at design load) |
| **State snapshot** | Lab/debug probe at sequence S | Tunable: `none` (default, halt-blind), `committed` (take finished pass), `scan` (same CSSOM cost as resync) |

Granular **rule** resync is forbidden: if membership is known well enough to send a subset, that
is the **live** list-diff, not the `resync` header bit (wholesale replace). Detection of “which
rules the client got wrong” is not available on Virtual.

Mid-session recover still uses the trusted-map strength (`emitResyncFrame`) per Stage 4; cold
start uses `rebuildAndResync`. Both pay CSSOM `blockingScan`. Wire CSSOM ops remain empty until
§4.6; the scan still commits in-page `lastRules` so live idle is not torn after recover.

---

## Scheduling (idle starvation)

CSSOM work uses `requestIdleCallback` so it **does not steal** the page’s main-thread budget
(I4). A page that never yields starves the poll — the window grows. That is accepted: **degrade
the poll with the page**, do not preempt site JS with a forced timeout scan on the live path.
Resync/snapshot-`scan` are the explicit exceptions (rare / debug).

Live CSSOM lag on the order of `cssomPollHz` (lab 200 ms) plus idle wait is a **clock** property.
**Accept:** perceived 1:1 / P7 at settle — [acceptance.md](acceptance.md). Same-turn CSS-in-JS
(`className` + `insertRule`) may trail a poll interval; that is not a DOM-style 60 Hz defect.
Establish/first paint remains install-before-paint (PP-EST-6). A rule that lives shorter than
one committed pass may never project (CSSOM analogue of PP-FR-1, **poll-interval** granularity).

**Sensor** stays one in-page JS bundle. No CDP CSS-domain dirty bit in the walk (premise 6).
Hints, if any, stay in that bundle — not host CDP inside the algorithm.

Grouping `cssText` (I2 top-level only): an inner change re-hashes the grouping rule; when ops
exist that is a coarser `RULE_SET` and **interacts with C3.1** (wider paint). Still open vs a
nested walk.

---

## Code map

`Refactor/sidecar/browser/mirror/projection/virtual/` — checklist [COMPONENTS.md](../../../Refactor/sidecar/browser/mirror/projection/virtual/COMPONENTS.md).

| Symbol | Role |
|--------|------|
| `CssomPlane` | `halt` / `takePending` / `blockingScan` (ops `[]` until wire) |
| `rebuildAndResync` | §5.8 `resyncVirtual`: rebuild DOM identity, then system `emitResyncFrame` |
| `emitResyncFrame` | Trusted maps; DOM describe + CSSOM blocking scan + CHECK |
| `takeSnapshot` / `flushAndSnapshot` | Snapshot use case; `cssom` option |
| `FrameEmitter` | Pipe; does not run CSSOM CPU; resync build owns the scan |

---

## Lab reading (not the algorithm)

Measured on the Instagram-shaped fixture while the **implementation** still serialized a sheet
in one slice: `cssText` dominates; identity walk is cheap; `pollMs` p50 includes idle **waits**
and is not CPU. Static fixture → `steadyFrameCount` 0 is expected (DOM idle; CSSOM still
attaches on the 60 Hz boundary when pending exists). Those numbers justify **slicing the
content walk** (I3); they do not license skip-serialize as completeness.

---

## Open (not decided here)

- Relock C5 from write-path hooks to this poll as **primary sensor** — Rodrigo.
- Nested-rule walk vs grouping `cssText` only (I2 today = top-level serialize; C3.1 if inner
  change re-sets the grouping rule).
- Lab O2-class CSSOM (table × Virtual live) exists: `flushAndSnapshot({ cssom: 'scan'|'committed' })`
  and `npm run lab:cssom-foundation`. Not a substitute for I1–I11; not automated Projected CSS iso
  ([seal-gaps.md](seal-gaps.md) **SEAL-CSSOM-P2-ISO**).
- Exact mass-abort threshold (fraction stale vs `replaceSync` detection) — lab uses ≥90% copy stale
  or live `length` &lt; 0.1× / &gt; 2× copy.
- Isolated CSSOM-CPU-per-pass at design load feeds **E6/E11**, not sealing the walk. Functional ≠
  perf.
- Which amortizations ship first (generations / skip serialize / in-page hints) — after I3 exists
  and there are numbers. None of them may hide a sheet that is still wrong **at settle**.
- Remaining CSSOM **lab seal** honesty (RULE_SET verify, author vs adopted boundary, end-of-frame
  rule check): [seal-gaps.md](seal-gaps.md) CSSOM P0.

---

## Decision log (this file)

| Date | Topic |
|------|--------|
| 2026-08-15 | Worst-case-first poll algorithm; idle + next-boundary attach; I1–I11; C5 not relocked |
| 2026-08-15 | I3 implemented in lab: copy refs, idle-batch hash, slot skip vs mass abort, whole-pass `lastRules`; §4.6 ops on the wire |
| 2026-08-16 | Doc correction: lab C6 apply (constructed/`adoptedStyleSheets` + `CSSStyleRule`) is shipped in `client/applyDom.ts`; pierce still desyncs. Prior “C6 still no-op” banners were false — see [seal-gaps.md](seal-gaps.md) **SEAL-CSSOM-P0-DOCS** |
| 2026-08-15 | Layers: resync always both planes + blocking CSSOM scan; snapshot CSSOM tunable; §5.8 `resyncVirtual` = `rebuildAndResync`; idle degrades with the page; no CDP in the walk |
| 2026-08-15 | Accept: DOM numerical 1:1; CSSOM live perceived/eventual; worst-case synthetic stresses the detector, not a 60 Hz CSSOM SLO |
| 2026-08-16 | I11 | Grouping-rule content change → `RULE_DROP`+`RULE_NEW`; `CSSStyleRule` still `RULE_SET` |
