# PageProjection — open items (bugs, gaps, rulings)

**Status:** living tracker. Single place for a weaker agent to see what is **not** done.  
**Do not** treat a missing row here as permission to invent a workaround. If you find a new defect, **append**.  
**Protocol OPEN-* source of truth** remains the table in [frame-protocol.md](frame-protocol.md) §10; this file copies it plus product/cutover items.

---

## How to use

| Kind | Meaning | Ship rule |
|------|---------|-----------|
| **BUG** | Implementation violates a sealed V4 rule | Must fix before production cutover if tagged **cutover-blocker** |
| **OPEN-n** | Design question in frame-protocol §10 | Do not implement a guess; ask |
| **RULING** | Human decision required (Rodrigo) | Do not pick in code |
| **RESIDUAL** | Docs/tests/budget leftover, not a protocol hole | Can trail cutover unless tagged blocker |
| **PINNED** | Deferred on purpose | Do not pull forward without a site that needs it |
| **ACCEPTED GAP** | Product boundary | Listed in [support-matrix.md](support-matrix.md) — not a bug |

---

## Bugs

**OPEN-8** is closed at the table (unit green). Mid-churn O2 was also confounded by missing `MutationObserver.takeRecords()` before drain ([observability.md](observability.md) §5 / frame-protocol §5.2) — that hole is closed. Re-run `prepend-stress.html` before treating remaining O2 red as engine bug. CLI `--iso` is Virtual-only until a client apply surface is plugged in.

---

## Protocol OPEN-* ([frame-protocol.md](frame-protocol.md) §10)

| # | Question | Status |
|---|----------|--------|
| **OPEN-1** | `NODE_DROP` of an absent id: `malformed` vs tolerated? | Open. Current code: `malformed`. If tolerated, MUST count in telemetry. |
| **OPEN-2** | Detached-row lifetime | **Leaning closed** — end-of-tick move/detach, deferred sequence-age GC (`NODE_DROP_AGE_SEQUENCES` retuned 120→20), no per-row versioning. Needs explicit sign-off to seal. |
| **OPEN-3** | `CHECK.scope` granularity | **Resolved in favour of id ranges** in §4.1. Confirm before sealing. |
| **OPEN-4** | Establish HTML vs table | **CLOSED — moot.** Establish deleted (§4.7). |
| **OPEN-5** | Recovery / mid-session attach | **CLOSED — §5.8.** Residuals below. |
| **OPEN-6** | Multi-document / nested documents (cross-origin iframes) | **PINNED.** Protocol must be per-document streams, not one flat id space. Revisit before pierce/iframe fixtures — not before. Not a first-cutover blocker for single-document sites. |
| **OPEN-7** | `insertBatch` reverse-link | **CLOSED** — `nextSiblingOf.set(prev, before)` on insert-before-existing; unit falsifier in `unit.ts`. |
| **OPEN-8** | `unlink` last-child leaves `nextSiblingOf[prev]` | **CLOSED 2026-08-14** — tail REMOVE after prepend; see frame-protocol §10. |

---

## Rulings (do not decide in code)

| Id | Topic | Why it blocks | Notes |
|----|-------|---------------|-------|
| **E-03 / E-08** | Loopback WebSocket data plane + CSP strip / PNA bypass | Stage 4 resync request uses `PlaneChannel.Control` on lab loopback. Real sites (Wikipedia) block `connect-src` to loopback. Production Integration cannot copy the lab channel blindly. | Accept-with-mitigation **or** reject in favour of the binding/hub channel. Archive: `engine-redesign-extension.md`. |
| **Contracts pack fate** | Archive vs delete historical `contracts/` + `implementation/` | Already moved to `archive/`. Confirm deletion vs keep-for-provenance. | Default this pass: **keep in archive**, never implement from. |
| **OPEN-2 sign-off** | Seal detached-row GC | Implementation already shipped in lab | Rodrigo |
| **OPEN-3 sign-off** | Seal CHECK id-range scope | Implemented | Rodrigo |

---

## Residuals (docs / tests / budgets)

| # | Item | Blocker? |
|---|------|----------|
| 1 | Pre-V4 prose in adjacent layer files. **[input.md](input.md) reconciled 2026-08-14** — addressing is `uint32` node id (was stale `speculum-anchor`), recovery/armed vocab now §5.8, §7 bindings noted as `PROP_SET`. **[cssom.md](cssom.md) still pending** — "establish/install" CSSOM vocabulary needs a careful separate pass (sheet-snapshot semantics). | No — agents follow banners |
| 2 | [test-matrix.md](test-matrix.md) `PP-EST-*` / `PP-REC-2/3` / some `PP-FR-*` still named for childList/establish — **re-authored in place as V4 intent** this pass; WP exit table still historical | Prefer before MotorAssert live-path coverage |
| 3 | Synchronous-walk latency budget at `MAX_ROWS` for `resyncVirtual` (not `emitResyncFrame`) | Before relying on walk-based rebuild in production at huge tables |
| 4 | `contracts/07-recovery.md` full rewrite | **Dropped** — file archived; §5.8 is the spec |
| 5 | Bounded resync retry on **production** session layer with catalogued `errorCode`+`phase` | Lab has 3-attempt backoff + `resyncFailed{exhausted}`. Production hub analog is part of Production Integration |
| 6 | Dual live paths (`LivePageProjection` vs lab engine) | **YES** — cutover deletes the loser same day ([roadmap.md](roadmap.md) gate 5) |

---

## Accepted product gaps

See [support-matrix.md](support-matrix.md). Canvas/WebGL pixels, MSE/DRM, IME, timing-critical games, independent client zoom. **Iframes:** not an accepted gap — OPEN-6 is unfinished protocol, so pierced XO iframes are **unsupported until OPEN-6**, not “working.”

---

## Closed recently (do not reopen)

| Date | Item |
|------|------|
| 2026-08-13 | Establish deleted; cold start = resync frame |
| 2026-08-13 | OPEN-5 recovery design |
| 2026-08-13 | 48 KB first-frame = injected `<script>` leak; `currentScript.remove()` |
| 2026-08-13 | `resolvedBefore` O(N²) → `walkSiblingRun` |
| 2026-08-14 | NODE_DROP subtree resurrection + same-tick reattach race |
| 2026-08-14 | Stage 4 lab: client resync + real double buffer; `everArmed` cold-start vs mid-session |
| 2026-08-14 | Spec tree reorganized to V4 live + `archive/` |
| 2026-08-14 | OPEN-7 `insertBatch` reverse `nextSiblingOf` — fixed + unit falsifier |
| 2026-08-14 | O2 local oracle (table × live DOM) wired in lab |
| 2026-08-14 | Lab Chromium path folded into `V4ProjectionBrowserSession`; lab is caller only |
| 2026-08-14 | Torn O2 (split `page.evaluate`) → `flushAndSnapshot` one JS turn |
| 2026-08-14 | Telemetry-as-assert (`table_size_matches_telemetry`) removed; digest probe at sequence S |
| 2026-08-14 | OPEN-8 `unlink` last-child `nextSiblingOf[prev]` — prepend-stress O2 / table walk `[118]` |
