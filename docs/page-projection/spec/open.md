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
| **SEAL gap** | Current emit/apply path is wrong or unsealed | [seal-gaps.md](seal-gaps.md) §2. Unimplemented opcodes/walks are **features** (§3), not gaps. Live cutover is the **destination** ([roadmap.md](roadmap.md)), not a row there |

---

## Bugs

**OPEN-8** is closed at the table. `takeRecords` before drain is closed. CLI `--iso` proves Virtual O2 + Node table×table; tree×tree needs lab UI DOM apply. **Production cutover is not licensed** by that — see [roadmap.md](roadmap.md) cutover law.

No open DOM-table bugs. Stress-churn stacked digits = PP-FR-1 ([observability.md](observability.md) §8). Prepend `child_order` = green at seq 799 (`2026-08-15T00-32-28`). Lab tracker (QA → gaps → features): [seal-gaps.md](seal-gaps.md) — not table OPEN-*. Apply honesty P0 is closed (UI desync attr/ruleset/eof 2026-08-17). Remaining **gaps**: SVG `createElement` namespace, Cssom vs Dom id split, OPEN-1 `NODE_DROP` absent id. **Features** (not gaps): `PROP_SET`, shadow/pierce, remaining ISA, nested CSS rows.

**Lab (2026-08-15 / 2026-08-16):** CSSOM poll **algorithm** — [cssom-poll-algorithm.md](cssom-poll-algorithm.md).
**Accept:** DOM numerical 1:1; CSSOM live perceived ([acceptance.md](acceptance.md)).
Why: [cssom-sensor-journey.md](cssom-sensor-journey.md). `SHEET_*`/`RULE_*` are on the wire (phase 1
table). **C6 lab apply is shipped** for constructed sheets on `adoptedStyleSheets` + `CSSStyleRule`
(`client/applyDom.ts`); pierce still desyncs. Conditional lab CSSOM seal ≠ production cutover —
kill list: [seal-gaps.md](seal-gaps.md). Telemetry `cssomPoll` sealed for the foundation —
[observability.md](observability.md) §9 (idle + resync + snapshot scan). **No** CDP CSS domain. C5 is
**not** relocked. C6 apply telemetry is **not** the foundation cut.

---

## Protocol OPEN-* ([frame-protocol.md](frame-protocol.md) §10)

| # | Question | Status |
|---|----------|--------|
| **OPEN-1** | `NODE_DROP` of an absent id: `malformed` vs tolerated? | Open. Current code: `malformed`. If tolerated, MUST count in telemetry. |
| **OPEN-2** | Detached-row lifetime | **CLOSED 2026-08-17** — end-of-tick move/detach, deferred `lms`-age GC (`NODE_DROP_AGE_SEQUENCES` = 20), no per-row versioning. |
| **OPEN-3** | `CHECK.scope` granularity | **CLOSED 2026-08-17** — id ranges (§4.1). Units: `testApplyFrameToTableCheckedRangeScope`, `testCheckScopeRangeEncodeDecode`. |
| **OPEN-4** | Establish HTML vs table | **CLOSED — moot.** Establish deleted (§4.7). |
| **OPEN-5** | Recovery / mid-session attach | **CLOSED — §5.8.** Residuals below. |
| **OPEN-6** | Multi-document / nested documents (cross-origin iframes) | **PINNED in lab; production cutover blocker (2026-08-14).** Protocol must be per-document streams. Do not ship Live without this. |
| **OPEN-7** | `insertBatch` reverse-link | **CLOSED** — `nextSiblingOf.set(prev, before)` on insert-before-existing; unit falsifier in `unit.ts`. |
| **OPEN-8** | `unlink` last-child leaves `nextSiblingOf[prev]` | **CLOSED 2026-08-14** — tail REMOVE after prepend; see frame-protocol §10. |

---

## Rulings (do not decide in code)

| Id | Topic | Why it blocks | Notes |
|----|-------|---------------|-------|
| **CUTOVER-FULL** | Production cutover completeness | Live switch only when V4 has **CSSOM + OPEN-6 + redesigned input + canvas projection** (canvas = last product feature before Integration), then Integration. DOM-only lab is not M1. | [roadmap.md](roadmap.md) |
| **CUTOVER-SESSION** | `V4ProjectionBrowserSession` is temporary | At cutover it **is** the live `BrowserSession`. Must cover capabilities Live already has (input, cookies, eval, resize, permissions, …) **redesigned in V4**, not by keeping legado. Incomplete session fails cutover. | [roadmap.md](roadmap.md); `BrowserSession.ts` |
| **E-03 / E-08** | Loopback WS + CSP strip / PNA | **DECIDED 2026-08-14 — reject header punch.** `connect-src *` / `script-src *` / strip CSP / disable PNA to make page-JS `WebSocket(127.0.0.1)` work **is not antibot-safe** (Akamai/CF see rewritten CSP, extra sockets, public→localhost). Do **not** enable the data plane by mutating the site’s CSP. Inject = CDP `addInitScript` (already). Bytes Virtual→sidecar = **not** a page `connect()` (CDP binding / hub — implement next). Lab loopback WS stays fixtures-only. | [roadmap.md](roadmap.md) gate 6 |
| **Contracts pack fate** | Archive vs delete historical `contracts/` + `implementation/` | Already moved to `archive/`. Confirm deletion vs keep-for-provenance. | Default this pass: **keep in archive**, never implement from. |

---

## Residuals (docs / tests / budgets)

| # | Item | Blocker? |
|---|------|----------|
| 1 | Pre-V4 prose in adjacent layer files. **[input.md](input.md) reconciled 2026-08-14** — addressing is `uint32` node id (was stale `speculum-anchor`), recovery/armed vocab now §5.8, §7 bindings noted as `PROP_SET`. **[cssom.md](cssom.md) still pending** — "establish/install" CSSOM vocabulary needs a careful separate pass (sheet-snapshot semantics). | No — agents follow banners |
| 2 | [test-matrix.md](test-matrix.md) `PP-EST-*` / `PP-REC-2/3` / some `PP-FR-*` still named for childList/establish — **re-authored in place as V4 intent** this pass; WP exit table still historical | Prefer before MotorAssert live-path coverage |
| 3 | Synchronous-walk latency budget at `MAX_ROWS` for `resyncVirtual` (not `emitResyncFrame`) | Before relying on walk-based rebuild in production at huge tables |
| 4 | `contracts/07-recovery.md` full rewrite | **Dropped** — file archived; §5.8 is the spec |
| 5 | Bounded resync retry on **production** session layer with catalogued `errorCode`+`phase` | Lab has 3-attempt backoff + `resyncFailed{exhausted}`. Production hub analog is part of Production Integration |
| 6 | Dual live paths (`LivePageProjection` vs lab engine) | **YES** — cutover (when product-complete) deletes the loser same day ([roadmap.md](roadmap.md)) |
| 7 | Lab probe: `NODE_NEW` in frame S ⇒ `isConnected` — **closed** as **SEAL-DOM-P0-PROBE** (`probe.nodeNewConnected` + `iso.tree` fail-with-client). Halt iso alone still does not prove the class. | No |
| 8 | Lab DOM/CSSOM tracker | [seal-gaps.md](seal-gaps.md) — QA closed 2026-08-17. Next: gaps §2. |

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
| 2026-08-14 | PP-FR-1 V4 walk (`!isConnected` at drain); stress-churn stacked digits; phase-2 `REMOVE` desync |
| 2026-08-14 | prepend-stress O2/tree at halt — green seq 799 (OPEN-8 / takeRecords era; not a live bug) |
| 2026-08-16 | Lab seal kill lists: [seal-gaps.md](seal-gaps.md). Doc falsehood: C6 phase-2 “still no-op” corrected (constructed/`adopted` + `CSSStyleRule` shipped in lab) |
| 2026-08-17 | Inject honesty ATTR/RULESET/EOF: harness, not apply. UI 4077 PASS. [observability.md](observability.md) §7 |
| 2026-08-17 | QA closed (human looks + CHECK range + CSSStyleRule folds + detached-row GC / OPEN-2 / OPEN-3). Next: [seal-gaps.md](seal-gaps.md) §2 |
