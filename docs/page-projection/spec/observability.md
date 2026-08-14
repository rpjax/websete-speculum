# PageProjection — observability, probes, lab (V4)

**Status:** normative for how we **observe** and **assert** the lab engine.  
**Not** the accept bar ([acceptance.md](acceptance.md)).  
**Not** the frame opcodes ([frame-protocol.md](frame-protocol.md)).  
**Who decides architecture:** Rodrigo. This file records sealed rules from 2026-08-14 lab work.

If this file conflicts with a green smoke that compared telemetry fields to pass an invariant, **this file wins**.

---

## 1. One Chromium path

There is **one** place that owns Patchright, inject of `virtual.js`, the data plane, frame relay, telemetry fan-out, and in-page probes: a **`BrowserSession`** implementation (`V4ProjectionBrowserSession` in the lab; production still `PatchrightBrowserSession` + legacy `LivePageProjection` until M1 cutover).

The **lab is a caller**, not a second browser:

- `LabSession` must not launch Chromium, must not call `page.evaluate` / CDP itself, must not open a private data-plane WebSocket beside the session.
- Humans use the lab UI (`npm run lab:projection`). Agents use the same suite via CLI (`npm run lab:run`). Both compose **the same** `runTools` / `report.json`.
- gRPC / .NET in production will be another caller of the same session contract. Do not grow lab-only Chromium shortcuts that production cannot share.

A second in-page producer, a lab-owned Chromium, or a “bootstrap dump” to make hopdiag green is **ad-hoc** ([acceptance.md](acceptance.md) T3).

---

## 2. Three kinds of telemetry (do not collapse)

All of this is *telemetry* in the product sense. They are **not interchangeable**.

| Kind | Who pushes | When it costs | What it is for |
|------|------------|---------------|----------------|
| **Events** | Producer or client **pushes** on `PlaneChannel.Telemetry` / lab WS (`frameEmitted`, `applyResult`, `desync`, aggregates, clock) | Zero when the matching capability is off at inject (`__SPECULUM_PROJECTION__`) | Time-series: plot, percentiles, investigation, O3 *inputs* |
| **Embedded** | Rides an existing artefact (e.g. `buildMs` / `encodeMs` on `frameEmitted`; hashes already on the frame) | Paid only if that artefact is produced | Same as events, without a second channel |
| **Probes** | **Caller invokes** a session method (`flushProjectionSnapshot`, `resumeProjectionWorld`, `compareProjectionTableToLiveDom`, CDP CPU profile, client `requestSnapshot`) | Zero in production if nobody calls | **Deterministic fetch of state** at a named moment |

**CPU profiling is a probe**, not an algorithm event. Samples come from CDP `Profiler` on the Chromium process. Capability `cpuProfiling` at launch; refuse if off.

**`report.json` is not a BrowserSession method.** The session exposes streams and probes. The **lab** composes the dossier (`lab-runs/<timestamp>-<slug>/`, start diagnosis at `report.json`). Verdicts are `pass` | `fail` | `skipped` (skipped must say why — e.g. no client apply surface on CLI).

---

## 3. Hard rule — events never assert state invariants

**Telemetry events are for investigation.** They are **not** a pass/fail source for table identity, DOM isomorphism, or “producer and client agree.”

Wrong (category error, observed 2026-08-14): `FrameInvariantMonitor` failing `table_size_matches_telemetry` because a wire **shadow** `liveIds.size` disagreed with `frameEmitted.tableSize`, or because `tableSize` was `DomNodeTable.size` (WeakRef identity map) while the protocol table still held detached rows until `NODE_DROP`. Those numbers measure **different sets**. Plot them; do not `assert.equal` them.

Right:

- **Wire hygiene** (decode, sequence+1, generation vs `EPOCH_RESET`, dangling/duplicate ids, insert cycles) — `FrameInvariantMonitor` on **frame bytes only**. Telemetry handlers on that monitor are no-ops for pass/fail.
- **State at sequence S** (replicated table, indexer tables, live DOM, client table, client tree) — **coherent snapshot probe** (below). Compare Virtual snapshot at S to client snapshot after it has applied S.

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

## 5. Coherent snapshot (one JS turn **and** `takeRecords`)

JavaScript is **run-to-completion**. `MutationObserver` **callbacks**, `rAF`, and timers **cannot**
interleave *inside* one `page.evaluate` / in-page function. They **can** interleave between two
separate evaluates. That forbids halt/flush/O2/tree split across evaluates (torn read).

That guarantee is **necessary and not sufficient.** MutationObserver **delivery** is a microtask.
Records for mutations already visible on the live DOM may still sit in the observer's internal queue
until the callback runs **or** `observer.takeRecords()` pulls them. `flushNow` that only drains the
callback-fed `mutationBuffer` builds frame S from **stale delivered** records while O2 reads **current**
DOM → `child_order_mismatch` under churn that is **snapshot lag**, not proof of a table bug. Do **not**
discard mid-churn O2 red as “torn read, ignore.”

**Required** (`flushAndSnapshot` / `BrowserSession.flushProjectionSnapshot`):

1. `observer.takeRecords()` into the mutation buffer (undelivered queue).
2. Drain the buffer and emit **frame S** (`flushNow` — same pull happens at the top of every tick).
3. In the **same turn**, capture state bound to S: table digest, table×live-DOM oracle (O2 local), optional structural tree.
4. Stop the producer clock so S+1 cannot publish before the client applies S.
5. Apply S, then snapshot that apply’s table digest (+ tree if a DOM surface exists). CLI: Node `applyFrameToTableChecked` in the **caller** (not `IBrowserSession`, not a second tab). UI lab: browser apply at 4077. Tree is `skipped` without DOM apply. Node table×table is **not** Projected.
6. Compare. Then `resumeProjectionWorld`.

A snapshot is a **state snapshot**, not “a DOM dump.” Any indexer that must be true at S belongs on that object.

**What a lab CLI `--iso` run actually proves today:** Virtual O2 + digest at S, wire invariants, and table×table vs Node phase-1 apply. It does **not** prove tree×tree or 1:1 Projected. O1 / O4 / O5 are not implemented.

---

## 6. Oracles vs this file

| Oracle | How it is taken (lab) |
|--------|------------------------|
| O2 local (table × Virtual live DOM) | `takeRecords` + drain + emit S + oracle, one turn ([observability.md](observability.md) §5) |
| O2 structural (Virtual tree × client tree) | Same probe pair at S — not a mid-run torn `requestSnapshot` while the clock ticks |
| O2 table×table | `ReplicatedTableDigest` Virtual vs apply at S — CLI: Node caller table; UI: DOM client table |
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

Code: `Refactor/sidecar/browser/mirror/projection/` (`session/V4ProjectionBrowserSession.ts`, `lab/isomorphism.ts`, `lab/runTools.ts`, `virtual/bootstrap.ts` `flushAndSnapshot`).
---
