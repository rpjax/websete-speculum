# PageProjection — lab tracker (QA / gaps / features)

**Status:** living tracker for the lab engine. Append; do not paper over.  
**Index:** [README.md](README.md). Protocol OPEN-* / rulings: [open.md](open.md). Coverage: [test-matrix.md](test-matrix.md).  
**Accept bar:** [acceptance.md](acceptance.md). Protocol: [frame-protocol.md](frame-protocol.md).

Work order: **QA and tests first**, then **gaps** in the path that already exists, then **features not built yet**. Do not file an unimplemented opcode or walk as a gap.

---

## How to classify a row

| Kind | Means | Does **not** mean |
|------|--------|-------------------|
| **QA / test** | The behaviour exists. Missing piece was a human look or a fail-closed gate. | A new opcode, a new walk, production cutover |
| **Gap** | The **current** emit/apply path already claims this and does it wrong, incomplete, or unsealed. | Something never shipped (that is a feature) |
| **Feature** | Not on the wire / not in the walk / not in the happy path yet. Build it; do not call it a gap in `NODE_NEW`/`RULE_SET`/CHECK. | A bug in an op that already runs |

**DOM vs CSSOM** stay independent tracks. A green CSSOM foundation run does not prove DOM; tree×tree green does not prove CSSOM apply.

**Live cutover** (delete the legacy path, ship V4 as Live) is the product destination — [roadmap.md](roadmap.md). It is **not** a row in this file.

A row closes only with an **effect assert** that matches the claim. Protocol greens (`200`, `ResyncServed`, `ownedRules`, hop counts) never close a row — [acceptance.md](acceptance.md), [observability.md](observability.md).

Status: **open** | **closed** (date + assert id). Do not mark PASS in [test-matrix.md](test-matrix.md) until the assert exists and fails when the bug returns.

Ids (`SEAL-*`) are stable cross-references. Kind (QA / gap / feature) is the working taxonomy; old P0/P1/P2 labels are only in the closed-honesty archive below.

---

## 1. QA and tests

**Done 2026-08-17.** Next work is §3 (features).

### Human look (4077) — closed

| What | Blueprint (id — description) | Fixture | Confirm |
|------|------------------------------|---------|---------|
| Projected tree | `apply-attrs` — ATTR success — act attrSet, DOM O2, iso tree when a DOM client is present | `fixtures/apply-attrs.html` | **2026-08-17 UI 4077:** visually OK |
| Projected tree (soak) | `soak` — Timed soak with optional CPU and coherent iso probes | `fixtures/demo.html` | **2026-08-17 UI 4077:** visually OK |
| No double paint | `cssom-double` — PP-CSSOM-A-2 — author `<style>` + constructed adopted; one paint path | `fixtures/cssom-double.html` | **2026-08-17 UI 4077:** visually OK |
| Inject desync (attr) | `apply-honesty-desync-attr` — ATTR desync — inject NODE_NEW with invalid attr name (DOM client required) | `fixtures/static-dom.html` | **2026-08-17 UI 4077:** `apply.desync.attr` PASS. Idle static page is expected. |
| Inject desync (ruleset) | `apply-honesty-desync-ruleset` — RULESET desync — inject RULE_SET on a grouping MediaRule (DOM client required) | `fixtures/static-dom.html` | **2026-08-17 UI 4077:** `apply.desync.ruleset` PASS. |
| Inject desync (eof) | `apply-honesty-desync-eof` — EOF desync — ghost live CSS rule then CHECK (DOM client required) | `fixtures/static-dom.html` | **2026-08-17 UI 4077:** `apply.desync.eof` PASS. |

Automated: CHECK by id range, live `CSSStyleRule` folds, detached-row GC — closed 2026-08-17 (archive).

Until shadow/pierce ships (feature below), a closed-shadow fixture must **fail explicit unsupported**, never soft-skip.

---

## 2. Gaps (current path is wrong or unsealed)

**Empty.** SVG namespace closed 2026-08-17. Form `PROP_SET` closed 2026-08-18. Next work is §3 (features) — shadow/pierce.

Honesty P0 for apply (flush-after-desync, failed `setAttribute`, phase-1 pres, `NODE_NEW` connected probe, `RULE_SET` on grouping, EOF rule membership, author vs adopted paint, doc/code alignment) is **closed** — archive at the bottom. UI desync proofs for attr / ruleset / eof: 2026-08-17.

---

## 3. Features not implemented

Not gaps in `NODE_NEW` / `RULE_SET` / CHECK. These ops or walks **are not on the lab happy path yet**.

### DOM / protocol

| Id | What to build | Assert | Status |
|----|---------------|--------|--------|
| **SEAL-DOM-P1-SHADOW** | Shadow trees on the publish walk (or pierce policy). Today the single-doc walk does not enter shadow. | Policy + probe: closed shadow either unsupported-fail or matches chosen pierce (**PP-F-3** / **PP-F-4**). | open |
| **SEAL-DOM-P2-ISA** | Remaining opcodes on the happy path: `NODE_META`, `DOC_STATE`, `SCROLL_*`, `NODE_SNAPSHOT`, related. | Per-opcode matrix (**PP-F-5**, **PP-EST-4**, **PP-MOVE-3**, **PP-D16-***) with **effect** probes — not “opcode exists”. | open |
| **SEAL-DOM-P2-OPEN6** | Multi-document / nested documents (cross-origin iframes). Pinned in lab; production cutover blocker. | Per-document streams + pierce asserts (**PP-F-4**); fail unsupported until the protocol ships. | open |

### CSSOM

| Id | What to build | Assert | Status |
|----|---------------|--------|--------|
| **SEAL-CSSOM-P2-PIERCE** | Iframe / shadow sheets (C7). Lab client desyncs pierce today. | OPEN-6 + **PP-F-4** / C7 asserts. | open |
| **SEAL-CSSOM-P2-NESTED** | Nested rules as table rows vs grouping `cssText` only (I2). | Nested walk oracle + matrix row when the protocol chooses rows. | open |
| **SEAL-CSSOM-P2-C5** | Write-path CSSOM hooks vs poll as the primary sensor — not relocked ([cssom-poll-algorithm.md](cssom-poll-algorithm.md)). | Ruling + sensor journey update; foundation settle asserts still hold. | open |
| **SEAL-CSSOM-P2-SCALE** | Scale amortizations (generations, skip-serialize, hints) after the path is correct. | Capacity in `perf.yml`; functional settle still fails on an incomplete sheet. | open |
| **SEAL-CSSOM-P2-ISO** | Automated Projected CSS vs Virtual (beyond table×live). | New probe class; CLI `--iso` does **not** claim this today ([observability.md](observability.md)). | open |

### Product (not this file’s kill list)

- Dual live paths, full V4 session contract, redesigned input, `<canvas>` **content**: [roadmap.md](roadmap.md). Canvas is the last product feature before Integration — [support-matrix.md](support-matrix.md).

---

## Counts (open only)

| Kind | Open | Notes |
|------|------|--------|
| **QA / tests** | 0 | Human looks + CHECK range + CSSStyleRule live + detached-row GC closed 2026-08-17 |
| **Gaps** | 0 | SVG namespace closed 2026-08-17 |
| **Features** | 8 ids | shadow, remaining ISA, multi-doc, pierce CSS, nested rows, C5, scale, CSS iso |

Closed honesty + QA 2026-08-17: FLUSH, ATTR, PHASE1, PROBE, OPEN2, OPEN3, RULESET, DOUBLE, EOF, DOCS, STYLE, IDSPACE, OPEN-1, SVG.

---

## How to close a row

1. **Gap:** fix the designed algorithm (no ad-hoc second path — [acceptance.md](acceptance.md) T3). **Feature:** implement the opcode/walk. **QA:** land the fail-closed assert or the human date.
2. Named assert (unit and/or lab gate and/or matrix row) that **fails** if the claim is false.
3. Flip Status to `closed YYYY-MM-DD` here; update [test-matrix.md](test-matrix.md) only when the assert is real.
4. If it was an OPEN-*/ruling, append [decision-log.md](decision-log.md) and update [open.md](open.md).

---

## Related

- **Live cutover:** [roadmap.md](roadmap.md) — not a row here.
- Other product boundaries (MSE, …): [support-matrix.md](support-matrix.md).
- Named bugs / OPEN-* copy: [open.md](open.md).

---

## Archive — closed honesty (former P0)

Kept so ids and dates stay searchable. Do not reopen because CLI `--iso` skipped an iframe; the UI desync proofs are dated above.

### DOM

| Id | Problem (one line) | Assert | Status |
|----|--------------------|--------|--------|
| **SEAL-DOM-P0-FLUSH** | `DomFrameApplier.flush` kept applying later frames in the same batch after a desync return. | **PP-APPLY-1**: `applyFramesUntilDesync`; unit `testDomFrameApplierFlushStopsOnDesync`. | **closed 2026-08-16** |
| **SEAL-DOM-P0-ATTR** | `applyAttrs` empty `catch` swallowed failed `setAttribute`. | **PP-APPLY-2**: unit + `apply-attrs` O2 + UI `apply.desync.attr` (2026-08-17). CLI without DOM client skips (3). | **closed 2026-08-16** (function + O2; UI desync 2026-08-17) |
| **SEAL-DOM-P0-PHASE1** | Phase-1 pres weaker than §6 validate-then-materialize. | **PP-APPLY-3**: unit `testApplyFrameToTableCheckedPhase1Pres`. | **closed 2026-08-17** |
| **SEAL-DOM-P0-PROBE** | `NODE_NEW` in frame S ⇒ `isConnected` probe missing. | **PP-FR-1**: `probe.nodeNewConnected`; `iso.tree` fail when client relay and skipped. UI tree OK 2026-08-17 (`apply-attrs` / `fixtures/apply-attrs.html`, `soak` / `fixtures/demo.html`). | **closed 2026-08-17** |
| **SEAL-DOM-P1-OPEN2** | Detached-row GC (end-of-tick detach, `lms`-age `NODE_DROP`, no per-row versioning). | Units: `testCollectDroppableIdsAgeAndLimitBound`, `testCollectDroppableIdsExcludesSameTickReattach`, `testNodeDropRemovesSubtreeAndDescendants`. | **closed 2026-08-17** |
| **SEAL-DOM-P1-OPEN3** | `CHECK` over id ranges. | Units: `testApplyFrameToTableCheckedRangeScope`, `testCheckScopeRangeEncodeDecode`. | **closed 2026-08-17** |
| **OPEN-1** | `NODE_DROP` of an absent id. | **malformed** (Rodrigo). Unit `testApplyFrameToTableCheckedRejectsNodeDropAbsentId`. | **closed 2026-08-17** |
| **SEAL-DOM-P1-SVG** | `NODE_NEW` always HTML `createElement`. | **PP-F-SVG-1**: units `testNodeNewElementNsWire`, `testStructuralDiffNsMismatch`; lab `svg-ns` (CLI tree skip without DOM client; `ns_mismatch` fails with client). | **closed 2026-08-17** |
| **SEAL-DOM-P1-PROP** | Live form properties not on the wire / not applied as properties. | **PP-PROP-1**: units `testPropSetWire`, `testPropSetTableAndCheck`, `testFormPropDirtyDoesNotBlockTable`; lab `forms-state` (CLI `iso.formProps` skip explicit without DOM client; with client, Virtual vs Projected properties fail on mismatch). | **closed 2026-08-18** |

### CSSOM

Conditional scope at close: constructed sheets on `adoptedStyleSheets` + top-level `CSSStyleRule`. Pierce still desyncs (feature).

| Id | Problem (one line) | Assert | Status |
|----|--------------------|--------|--------|
| **SEAL-CSSOM-P0-RULESET** | `RULE_SET` on non-`CSSStyleRule` could no-op. | **PP-CSSOM-A-1**: emit+table + foundation O2 + UI `apply.desync.ruleset` (2026-08-17). | **closed 2026-08-16** (emit + O2; UI desync 2026-08-17) |
| **SEAL-CSSOM-P0-DOUBLE** | Author `<style>` vs constructed/`adopted` boundary. | **PP-CSSOM-A-2**: emit skips `ownerNode`; `cssom-double` cascade+O2; UI 4077 visually OK 2026-08-17 (`fixtures/cssom-double.html`). | **closed 2026-08-17** (emit + Virtual fold; Projected paint human 2026-08-17) |
| **SEAL-CSSOM-P0-EOF** | EOF CSSOM check verified sheet handles only. | **PP-CSSOM-A-3**: unit + O2 + UI `apply.desync.eof` (2026-08-17). | **closed 2026-08-16** (function + O2; UI desync 2026-08-17) |
| **SEAL-CSSOM-P0-DOCS** | Comments claimed C6 phase-2 still no-op. | Docs + `opcodes.ts` match `client/applyDom.ts`. | **closed 2026-08-16** |
| **SEAL-CSSOM-P1-STYLE** | In-scope `CSSStyleRule` live updates existed; fold could pass if snaps/op-windows were missing. | **PP-CSSOM-F-3..F-5**, **PP-CSSOM-H-1** (automated): `cssom-foundation` / `cssom-heavy` require named snaps + `ops.styleSet` / `ops.theme`; `cssomO2` mismatch fails. | **closed 2026-08-17** |
| **SEAL-CSSOM-P1-IDSPACE** | Leftover Dom vs Cssom id ranges. | Units: `testSessionIdsSharedDomAndCssom`, `testCssomEncodeDecode` (sheet id 2). Bootstrap: `CssomIds(() => domNodes.mint())`. | **closed 2026-08-17** |
