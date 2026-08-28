# PageProjection — observability, probes, lab (V4)

**Status:** normative for how we **observe** and **assert** the lab engine.  
**Not** the accept bar ([acceptance.md](acceptance.md)).  
**Not** the frame opcodes ([frame-protocol.md](frame-protocol.md)).  
**Not** the lab host/UI/CLI/dossier **product shape** — that is [lab-design.md](lab-design.md) (shipped 2026-08-16). This file still **wins** on probes vs events, **state snapshot** procedure, and I10.  
**Session method names / DTOs:** [browser-session.md](browser-session.md) (SEALED 2026-08-21) wins.  
**Who decides architecture:** Rodrigo. This file records sealed rules from 2026-08-14 lab work (+ 2026-08-21 snapshot contract).

If this file conflicts with a green smoke that compared telemetry fields to pass an invariant, **this file wins**.

---

## 1. One Chromium path

There is **one** place that owns Patchright Chromium, inject of `virtual.js`, the data plane, frame relay, telemetry fan-out, and in-page probes: **`PageProjectionBrowserSession`** implementing [browser-session.md](browser-session.md). Live composition: `createSealedBrowserSessionFactory` (Launch `mirrorMode=pageProjection`). Video mode is a sibling (`VideoStreamingBrowserSession`). `LivePageProjection` is gone. Product-complete M1 (canvas + `web/` Integration) is separate — [roadmap.md](roadmap.md).

The **lab is a caller**, not a second browser:

- `LabSession` must not launch Chromium, must not call `page.evaluate` / CDP itself, must not open a private data-plane WebSocket beside the session.
- Humans use the lab UI (`npm run lab:projection`). Agents use the same suite via CLI (`npm run lab:run -- --blueprint …`). Both compose **the same** runner / dossier.
- gRPC / .NET in production will be another caller of the same session contract. Do not grow lab-only Chromium shortcuts that production cannot share.

A second in-page producer, a lab-owned Chromium, or a “bootstrap dump” to make hopdiag green is **ad-hoc** ([acceptance.md](acceptance.md) T3).

The lab Projected **surface** iframe (4077 apply sandbox) is **not** a nested browsing context of the target. OPEN-6 `contextId` is for the site’s `iframe` / `frame` / `object` / `embed` — [multi-document.md](multi-document.md).

---

## 2. Three kinds of telemetry (do not collapse)

All of this is *telemetry* in the product sense. They are **not interchangeable**.

| Kind | Who pushes | When it costs | What it is for |
|------|------------|---------------|----------------|
| **Events** | Producer or client **pushes** on `PlaneChannel.Telemetry` / lab WS (`frameEmitted`, `applyResult`, `desync`, aggregates, clock) | Zero when the matching capability is off at inject (`__SPECULUM_PROJECTION__`) | Time-series: plot, percentiles, investigation, O3 *inputs* |
| **Embedded** | Rides an existing artefact (e.g. `buildMs` / `encodeMs` on `frameEmitted`; hashes already on the frame) | Paid only if that artefact is produced | Same as events, without a second channel |
| **Probes** | **Caller invokes** a session method (`getStateSnapshot`, `haltClocks` / `resumeClocks`, `emitFrame`, CDP `startCpuProfile`/`stopCpuProfile`, client `requestSnapshot`) | Zero in production if nobody calls | **Deterministic fetch of state** at a named moment |

**CPU profiling is a probe**, not an algorithm event. Samples come from CDP `Profiler` on the Chromium process. Capability `cpuProfiling` at launch ([browser-session.md](browser-session.md) core); refuse if off. Not PP-only.

**`dossier` is not a session method.** The session exposes streams and probes. The **lab** composes the dossier (`lab-runs/<timestamp>-<slug>/`, start at `report.json` pointer → `manifest.json` / `verdicts.json`). Verdicts are `pass` | `fail` | `skipped` (skipped must say why — e.g. no client apply surface on CLI).

---

## 3. Hard rule — events never assert state invariants

**Telemetry events are for investigation.** They are **not** a pass/fail source for table identity, DOM isomorphism, or “producer and client agree.”

Wrong (category error, observed 2026-08-14): `FrameInvariantMonitor` failing `table_size_matches_telemetry` because a wire **shadow** `liveIds.size` disagreed with `frameEmitted.tableSize`, or because `tableSize` was `DomNodeTable.size` (WeakRef identity map) while the protocol table still held detached rows until `NODE_DROP`. Those numbers measure **different sets**. Plot them; do not `assert.equal` them.

Right:

- **Wire hygiene** (decode, sequence+1, generation vs `EPOCH_RESET`, dangling/duplicate ids, insert cycles) — `FrameInvariantMonitor` on **frame bytes only**. Telemetry handlers on that monitor are no-ops for pass/fail.
- **State at sequence S** (replicated table, live child-order, client table, client tree, …) — **state snapshot** (§5). Session returns **raw planes**; lab builds oracles. Compare Virtual dump at S to client snapshot after it has applied S.
- **Form control properties (`PP-PROP-1`)** — Virtual vs Projected `.value` / `.checked` / `.selected` at S **at settle** (nobody typing). Lab `forms-state` / `iso.formProps`. Tree iso does **not** include live properties (tags/attrs can match with a stale `.value`). A green `CHECK` while the Projected field is dirty is **not** a fail. CLI without a DOM client skips the Projected side explicitly — do not pass from a Virtual-only read.

`applyResult.ok`, desync counts, and `lastTableSize` in metrics remain **diagnostic**. A green event stream with a broken surface still fails [acceptance.md](acceptance.md).

---

## 4. `tableSize` vs `identitySize` (event semantics)

On `frameEmitted` / `applyResult`:

| Field | Meaning | Use |
|-------|---------|-----|
| `tableSize` | `ReplicatedTable.size` after that frame’s ops. Detached rows remain until `NODE_DROP`. Document id 1 is implicit and is **not** a row. | Time-series of protocol table occupancy |
| `identitySize` (optional) | `DomNodeTable` WeakRef map size. GC-sensitive. | Diagnosis only; never an assert target |

Do not rename `tableSize` to mean identity-map size to make an old monitor green.

Probe compact identity of the **same** table: `ReplicatedTableDigest` `{ rowCount, tableHash }` (`models/tableDigest.ts`). `rowCount` === `ReplicatedTable.size`. Compare digest×digest at S; that is the table invariant.

---

## 5. State snapshot (one JS turn **and** `takeRecords`)

JavaScript is **run-to-completion**. `MutationObserver` **callbacks**, `rAF`, and timers **cannot**
interleave *inside* one `page.evaluate` / in-page function. They **can** interleave between two
separate evaluates. That forbids halt / emit / capture split across evaluates (torn read).

That guarantee is **necessary and not sufficient.** MutationObserver **delivery** is a microtask.
Records for mutations already visible on the live DOM may still sit in the observer's internal queue
until the callback runs **or** `observer.takeRecords()` pulls them. Emit that only drains the
callback-fed `mutationBuffer` builds frame S from **stale delivered** records while a later live
child-order read sees **current** DOM → `child_order_mismatch` under churn that is **snapshot lag**,
not proof of a table bug. Do **not** discard mid-churn table×DOM red as “torn read, ignore.”

**Required** (state snapshot — per **context instance**, OPEN-6):

**Sequence S is per `contextId`, not global.** Nested contexts have independent `generation` / `sequence` counters. A lab iso pass collects N snapshots at the same wall-clock moment; it does **not** align S across contexts.

Per instance (Virtual: bus RPC `snapshot` where `contextId === mine`; session port `getStateSnapshot(contextId, opts)` — [browser-session.md](browser-session.md)):

1. `observer.takeRecords()` into the mutation buffer (undelivered queue).
2. Drain the buffer and emit **frame S** for **that instance** (`flushNow` / `emitFrame` path).
3. In the **same turn**, capture **raw state planes** bound to that instance’s S, gated by opts:
   - always on success: table digest (`rowCount` + `tableHash`);
   - `table: 'full'` + `liveChildOrder`: rows + `childrenByParent` for **offline** table×DOM;
   - `cssom: 'committed' | 'scan'`: CSSOM table + live `cssRules` dumps (not a verdict);
   - optional `tree`, `formProps`, `frameNewNodes` (NODE_NEW id + `isConnected` facts).
4. Stop **that instance’s** producer clock so S+1 cannot publish before the client applies S for that `contextId`. Resume via session `resumeClocks()` (all-contexts broadcast) when continuing.
5. Client applies frames for that `contextId`, then lab `requestSnapshot(contextId)` returns that applier’s table digest (+ tree). CLI table apply for nested contexts is **skipped** unless explicitly extended — UI lab (4077) is the source of truth for Projected nested iso.
6. **Lab** compares Virtual dump vs Projected **per contextId** (oracles live in lab/helpers — **not** on the session DTO). No `identical` / `o2` fields from the sidecar.

A snapshot is a **raw state dump at S**, not an oracle result and not “a DOM dump.” Any indexer that must be true at S belongs on that object when opted in. Fixture paint-boundary (`cascade` / PP-CSSOM-A-2) is **lab/fixture**, not a session plane.

Default CSSOM mode is **`none`** (halt idle; DOM capture is not delayed for a CSSOM scan). Pass `{ cssom: 'committed' | 'scan' }` when the probe needs CSSOM — [cssom-poll-algorithm.md](cssom-poll-algorithm.md) use cases. Resync is not a snapshot: it always blocking-scans CSSOM.

**What a lab CLI `--iso` run actually proves today:** Virtual table×DOM + digest at S, **CSSOM table×live** (Sheet/Rule × live Virtual `cssRules`, I2 top-level) via one `getStateSnapshot` turn, wire invariants, and table×table vs Node phase-1 apply. It does **not** prove tree×tree, or automated Projected CSS 1:1 vs Virtual paint. Form-control **property** 1:1 (`PP-PROP-1`) is lab `forms-state` (`iso.formProps`); CLI without a DOM client skips Projected explicitly. Lab client **does** materialize constructed CSSOM (C6) on the 4077 surface; CLI `--iso` still does not assert that paint. `cssomPoll` is investigation only (I10). O1 / O4 / O5 are not implemented. Seal kill lists: [seal-gaps.md](seal-gaps.md).

---

## 6. Oracles vs this file

Oracles are **lab/spec features on top of** the state dump. They are **not** fields on `StateSnapshotResult` ([browser-session.md](browser-session.md)).

| Oracle | How it is taken (lab) |
|--------|------------------------|
| O2 local (table × Virtual live DOM) | Same-turn dump with `table: 'full'` + `liveChildOrder`; lab runs `compareTableToLiveOrder` offline. Sheet/Rule kinds are excluded from child-order. |
| O2 CSSOM (table × Virtual live CSSOM) | Same turn after `cssom: 'scan'` (stash pending → flush → dump both planes); lab compares. Readable `cssRules` only; unreadable sheets are not required. Verdict `iso.cssom` — not DOM O2, not automated Projected paint iso. Lab gate: `npm run lab:run -- --blueprint cssom-foundation` — fold **fails** if required snaps or op-windows are missing or cssom compare diverges ([lab-design.md](lab-design.md)); `cssomPoll` is not a mid-run gate. Heavy: `npm run lab:run -- --blueprint cssom-heavy` (same fail-closed snaps + `ops.theme`). |
| O2 structural (Virtual tree × client tree) | Same probe pair at S with `tree: true` — not a mid-run torn `requestSnapshot` while the clock ticks. Tags/attrs/text/ns — **not** live `.value` / `.checked` / `.selected`. |
| Form properties (`PP-PROP-1`) | Same S **at settle** with `formProps: true` on Virtual + Projected read. Missing Projected surface = explicit skip, not pass. Do not assert mid-keystroke (dirty). |
| O2 table×table | Digest×digest Virtual vs apply at S — CLI: Node caller table; UI: DOM client table |
| PP-FR-1 (`NODE_NEW` ⇒ connected) | `frameNewNodes` facts on the dump; lab decides pass/fail |
| O1 / O4 / O5 | Unchanged — not implemented; do not fake with event greens |
| O3 inputs | Event percentiles in `report.json`; not yet a CI fail gate |

Full comparison remains lab/CI only (O(n) — [oracles.md](oracles.md), E1).

---

## 7. Process notes (so the next agent does not re-learn this)

| Date | What we thought | What was true | What we do now |
|------|-----------------|---------------|----------------|
| 2026-08-14 | O2 mid-churn fail = table bug | Halt/flush/O2 split across evaluates **and** undelivered MO queue (no `takeRecords`) | One-turn snapshot **plus** `takeRecords` before drain. Do not discard remaining mid-churn red. |
| 2026-08-14 | `table_size_matches_telemetry` fail = producer/client diverge | Monitor compared wire shadow and/or identity map to a field that later meant protocol table size | Stop asserting that; digest probe at S; polish event field names |
| 2026-08-14 | Lab may `page.evaluate` for convenience | That is a second Chromium path | Session probes only |
| 2026-08-14 | Many CLI scripts = the test pyramid | Throwaway profilers duplicated math | One run suite → `report.json`; scripts wrap CLI |
| 2026-08-14 | prepend-stress O2 fail after OPEN-7 = oracle artifact or GC | `unlink` of last child left `nextSiblingOf[prev]`; next tail REMOVE skipped `lastChildOf` (OPEN-8) | Table falsifier + delete derived next when unlinking last child |
| 2026-08-14 | Stress-churn “stacked digits” = layout / CSS / swallowed REMOVE / producer table dirt | Observer **history** (`addedNodes`) sent as live tree. Same-tick create+destroy (textContent replace faster than the frame clock) got `NODE_NEW`+`INSERT`. Halt O2/tree green (end of S). Virtual never stacked. After PP-FR-1 prune, glue gone; 0 desync so the REMOVE guard was not the visual cause | Drain `isConnected` (PP-FR-1); `REMOVE` iff ended detached with a prior id; client parent mismatch → desync anyway. Halt iso does **not** prove this class. §8 |
| 2026-08-17 | Inject ATTR / RULESET / EOF: client still synced → apply algorithm broken | Hostile lab frames used constructed `hostNode: 1` (phase 2 rejects ≠ 0); bundled client threw `desyncPhase is not defined` after a real apply fail; wait treated `sequence >= N` as applied; fold lowercased the reason then searched mixed-case tokens; `lastDesyncReason` stuck across Runs | Fix harness only (`lab/runner/hostileFrames.ts`, `labProjectionClient.ts`, inject wait until `desynced`, fold). Same decode/apply path — not a second algorithm. UI 4077 PASS the same day. Do not reopen `applyDom.ts` for these three. |
| 2026-08-21 | Snapshot DTO carried oracle verdicts | Contract sealed: session returns raw planes; lab builds O2 / PP-FR-1 / etc. | [browser-session.md](browser-session.md); rename wave for method names |

Code: `sidecar/browser/mirror/projection/` (`session/PageProjectionBrowserSession.ts`, `lab/probes/isomorphism.ts`, `virtual/bootstrap.ts` `flushAndSnapshot`). Sealed method names: `haltClocks` / `resumeClocks` / `emitFrame` / `getStateSnapshot` / `requestResync`.

---

## 8. Halt-blind stream divergence (PP-FR-1 incident, 2026-08-14)

**Class:** the wire describes nodes that are **not** in the live Virtual DOM at end of tick. Projected
**paints** them during churn. State snapshot at halt (table×DOM, table×table, tree×tree **including text**)
is green because it samples **after** a complete frame S.

This is **not** a telemetry-assert problem and **not** “O1 first.” It is producer construction (§5.4
second trap, §5.6). Lab check: dump `frameNewNodes` (`NODE_NEW` in this frame ⇒ `connected`) — **closed 2026-08-17** (`probe.nodeNewConnected` / [seal-gaps.md](seal-gaps.md) SEAL-DOM-P0-PROBE; sealed face name `frameNewNodes`). Not a telemetry event.

### What we saw

`stress-churn.html`: 20-column grid; each rAF appends cells and sets `cell.textContent` (replace = kill
old `#text`, birth new). Page ~60 rAF; frames often slower → **several replaces per tick**. CSS is an
inline `<style>` (DOM-projected, not a CSSOM-plane gap). Virtual headed Chrome: **never** stacked.
Projected iframe: cells like `2297523025` (two numbers in one box) **during** the run.

### What the oracles said (and why they lied about the screen)

| Probe | Result | Why it did not catch it |
|-------|--------|-------------------------|
| O2 Virtual table × Virtual DOM | pass | Table matched **live** Virtual. Dead nodes were not in that DOM. |
| table×table (UI client) | pass | Client table matched after applying S. |
| tree×tree at halt (text included) | pass | Halt DOM had one `#text` per cell, same strings as Virtual. |
| `applyOk` / desync | 0 desync | Events are not this invariant. |

CLI `--iso` without a DOM apply surface never sees Projected paint. The catching run **was** lab UI
4077 (client plugged in). Still green at halt.

### False paths (do not revive)

- Fixture overflow / `1fr` too narrow — would glue **Virtual** too. It did not.
- Missing `<style>` / CSSOM v0 — `<style>` is an element; Projected applied it.
- Producer table accumulating ephemerals — O2 would be red. It was not.
- Prepend-stress `child_order` as proof of the same bug — different fixture; it **avoids** same-tick
  create+destroy. Halt iso **green** 2026-08-15T00-32-28 (seq 799). Old red = OPEN-8 / torn snapshot.
- `TEXT_SET` + rebind id as the fix — new identity rule, text-only ramal. Optional later.
- Silent client `REMOVE` (`if (parentNode === parent) remove; return true`) as **the** visual cause —
  same-parent `INSERT` then `REMOVE` does find the node. After fail-closed `REMOVE`, a 25s UI rerun
  had **0 desync** and **no glue**. Guard remains mandatory honesty (§6); it did not clear the grid.

### What was true

`TableFrameBuilder.walkSiblingRun` allocated every `addedNodes` entry. `emitDeferredRemoves` skipped
`REMOVE` when `visited.has(node)` (meant “move”). Same-tick corpses were visited. Attr/text already
honoured `isConnected`; structure did not.

Projected applied those `INSERT`s. Virtual never had the corpses in the live tree. Halt sampled
survivors only.

### Fix (shipped)

1. **PP-FR-1:** at drain, `!isConnected` → no allocate, no `INSERT` (`tableFrameBuilder.ts`).
2. **`REMOVE`:** ended the tick detached **and** already had an id. `visited` is not the criterion.
3. **Client:** `REMOVE` whose node is not a child of `op.parent` → `bad_target` desync, not a skip
   (`applyDom.ts`).

### Evidence after the fix

`lab-runs/2026-08-15T00-00-21-773Z-127.0.0.1-4077/` (UI, 25s, stress-churn): 1462 apply, 0 desync,
iso identical at 1462. Human: **no stacked digits**. Ops p95 551→326; published fps ~24→~58 on
**unequal** durations — no measured **degradation**; extra `isConnected` is a boolean on nodes already
walked; the work that left the wire was garbage.

### What a lab test for this **class** looks like (not built)

After `build()`, every `NODE_NEW` in the frame must be `isConnected`. Put that on the state
snapshot, halt **and** a mid-run S. Fixture: create+destroy in one tick (need not be the 20-col grid).
Second line, after client apply of S: client DOM × **client table** (phase 2). Do not add event kinds.

---

## 9. CSSOM poll (`cssomPoll`)

Lab-only producer event. **Investigation**, not an isomorphism assert (I10). One kind covers the
foundation detector: idle pass, resync `blockingScan`, and snapshot `scan`. Capability toggle
`cssomPoll` (lab on, prod inject default off).

Design: `requestIdleCallback`; phase A copies rule **refs** atomically; phase B hashes `cssText` on
that copy in idle **batches** (stale skip / mass abort — [cssom-poll-algorithm.md](cssom-poll-algorithm.md) I3).
A finished idle pass is **not** applied on idle — `FrameEmitter` takes it on the **next frame-clock
boundary** (eventual vs the DOM tick). Default snapshot (`cssom: 'none'`) **cancels** idle and does
not wait for CSSOM. **Resync** always `blockingScan`. §4.6 ops ride the **frame**; this event counts
them. `cssomPollHz` is the minimum interval between pass *starts* (lab default 5 → 200 ms), not a
blocking timer. `pollMs` is wall time (includes waits between slices), not CPU.

| Field | Meaning |
|-------|---------|
| `source` | `'idle'` \| `'resync'` \| `'snapshotScan'` |
| `sequence` | Frame that attached the ops; `0` if the pass was not attached to a frame |
| `pollMs` | Wall time of one poll pass |
| `identityWalkMs` | Walk top-level `CSSRule` object identity (no `cssText`) |
| `cssTextSerializeMs` | Read `rule.cssText` + hash — the expensive part |
| `topLevelRulesVisited` | Top-level `cssRules` entries (does **not** recurse `@media` children) |
| `topLevelRulesSerialized` | How many of those had `cssText` read this pass |
| `readableSheetCount` / `unreadableSheetCount` | `cssRules` ok vs `SecurityError` |
| `rulesAppeared` / `rulesDisappeared` | Object identity vs previous pass |
| `rulesTextChangedInPlace` | Same `CSSRule` object, different `cssText` |
| `sheetsWithRuleListChanged` | Order or membership changed on that sheet |
| `styleTagTextUnchangedSheets` | `<style>` `textContent` hash matched previous pass |
| `sheetsAborted` | Mass-abort sheets this pass (I3 / I7) |
| `slotsSkipped` | Dead copy slots skipped (not abort) |
| `idleSlices` | `requestIdleCallback` entries this pass (blocking scan = 0) |
| `opCount` / `opSheetNew` … `opRuleSet` | §4.6 ops emitted this pass (zeros explicit) |

Do not pass/fail table, DOM, or Projected CSS from these fields. C6 apply telemetry is not this event.
Lab `cssom-foundation` blueprint **observes** these events and folds at the end: zero idle polls over the
whole run (cap on) may fail `sensor.idle`; it is not a mid-run gate. See [lab-design.md](lab-design.md).

Algorithm (worst-case-first, I1–I11): [cssom-poll-algorithm.md](cssom-poll-algorithm.md).

---

## 10. Multi-context observability (OPEN-6) — **shipped 2026-08-19**

**Status:** implemented in lab (`feat/mirror-mode`). Production cutover still needs the same contracts on the live session path.

| Topic | Rule |
|-------|------|
| **Telemetry** | Every producer **and** client event (`frameEmitted`, `applyResult`, `desynced`, `cssomPoll`, resync lifecycle, …) carries **`contextId: u32`** (root = `1`). Lab validators treat missing `contextId` as malformed. Events remain **investigation only** — never iso pass/fail. Wire: **`TELEMETRY_WIRE_VERSION` 2**. |
| **Nested producer** | Nested algorithm instances do **not** open the DataPlane. They emit loose **`telemetry`** on the postMessage bus; the **root runtime** fans out to `PlaneChannel.Telemetry`. |
| **Snapshot probe** | Not “root-only `page.evaluate` on one table.” **Control RPC `snapshot`** on the bus: each instance runs state dump iff `contextId === mine`. Lab: N× `getStateSnapshot(contextId, opts)` (same wall-clock batch, **no** cross-context sequence sync). Do not reintroduce `snapshotAllContexts` on the session. |
| **Iso** | N pairwise comparisons (Virtual dump ↔ lab client snapshot) per active `contextId`: digest, table×DOM, CSSOM table×live, `formProps`, optional tree — **lab-built** from raw planes. Root recursive tree remains an optional sanity check only. |
| **Lab context index** | Lab-only registry of `contextId`s seen on the wire (`1` + every nested `≥ 2`). Not algorithm code, not client apply code. Persisted in dossier `journal/contexts.json`. |
| **Wire invariants** | `FrameInvariantMonitor` **one per `contextId`** in lab chassis — never one monitor mixing streams from different contexts. |
| **CPU Profiler** | CDP `Profiler` stays **one probe per tab** (renderer process). Do **not** claim per-`contextId` Profiler breakdown. Per-scope operational CPU comes from `buildMs` / `encodeMs` / `applyMs` on tagged telemetry events. Optional dossier field: `activeContextCount` at profile stop. |
| **Stream HUD** | Lab UI **Stream** tab: per-`contextId` table (wire frames, emit/apply ±, desync, resync, overrun, seq, build/apply ms). Investigation only. |

Code: `virtual/bus/contextBus.ts` + `virtual/bus/virtualDomainBus.ts` (telemetry + snapshot RPC + resync fan-down), `client/nestedResyncSurface.ts`, `client/nestedProjectedApply.ts`, `lab/host/contextIndex.ts`, `lab/probes/isomorphism.ts` (N-way).

