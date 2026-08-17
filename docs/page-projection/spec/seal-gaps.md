# PageProjection — lab tracker (QA / gaps / features)

**Status:** living tracker for the lab engine. Append; do not paper over.  
**Index:** [README.md](README.md). Protocol OPEN-* / rulings: [open.md](open.md). Coverage: [test-matrix.md](test-matrix.md).  
**Accept bar:** [acceptance.md](acceptance.md). Protocol: [frame-protocol.md](frame-protocol.md).

Work order: **QA and tests first**, then **gaps** in the path that already exists, then **features not built yet**. Do not file an unimplemented opcode or walk as a gap.

---

## How to classify a row

| Kind | Means | Does **not** mean |
|------|--------|-------------------|
| **QA / test** | The behaviour exists (or the ruling is already in prose). What is missing is a human look, a fail-closed gate, or sign-off. | A new opcode, a new walk, production cutover |
| **Gap** | The **current** emit/apply path already claims this and does it wrong, incomplete, or unsealed. | Something never shipped (that is a feature) |
| **Feature** | Not on the wire / not in the walk / not in the happy path yet. Build it; do not call it a gap in `NODE_NEW`/`RULE_SET`/CHECK. | A bug in an op that already runs |

**DOM vs CSSOM** stay independent tracks. A green CSSOM foundation run does not prove DOM; tree×tree green does not prove CSSOM apply.

**Live cutover** (delete the legacy path, ship V4 as Live) is the product destination — [roadmap.md](roadmap.md). It is **not** a row in this file.

A row closes only with an **effect assert** that matches the claim. Protocol greens (`200`, `ResyncServed`, `ownedRules`, hop counts) never close a row — [acceptance.md](acceptance.md), [observability.md](observability.md).

Status: **open** | **closed** (date + assert id). Do not mark PASS in [test-matrix.md](test-matrix.md) until the assert exists and fails when the bug returns.

Ids (`SEAL-*`) are stable cross-references. Kind (QA / gap / feature) is the working taxonomy; old P0/P1/P2 labels are only in the closed-honesty archive below.

---

## 1. QA and tests pending

Do these before treating remaining gaps as “the next algorithm bug.”

### Human look (4077)

Dated **2026-08-17** (Rodrigo, UI). Reopen the matching row if a later look shows unusable Projected.

| What | Blueprint (id — description) | Fixture | Confirm |
|------|------------------------------|---------|---------|
| ~~Projected tree~~ | `apply-attrs` — ATTR success — act attrSet, DOM O2, iso tree when a DOM client is present | `fixtures/apply-attrs.html` (manifest id `apply-attrs`) | **2026-08-17 UI 4077:** visually OK — tree not SKIP; Virtual and Projected match by eye |
| ~~Projected tree (soak)~~ | `soak` — Timed soak with optional CPU and coherent iso probes | `fixtures/demo.html` (manifest id `demo`) | **2026-08-17 UI 4077:** visually OK — tree visible, matches Virtual |
| ~~No double paint~~ | `cssom-double` — PP-CSSOM-A-2 — author `<style>` + constructed adopted; one paint path | `fixtures/cssom-double.html` (manifest id `cssom-double`) | **2026-08-17 UI 4077:** visually OK — `#author-probe` red, `#adopted-probe` blue, once each |
| ~~Inject desync (attr)~~ | `apply-honesty-desync-attr` — ATTR desync — inject NODE_NEW with invalid attr name (DOM client required) | `fixtures/static-dom.html` (manifest id `static-dom`) | **2026-08-17 UI 4077:** `apply.desync.attr` PASS (`malformed:nodeNew`). Idle static page is expected. |
| ~~Inject desync (ruleset)~~ | `apply-honesty-desync-ruleset` — RULESET desync — inject RULE_SET on a grouping MediaRule (DOM client required) | `fixtures/static-dom.html` (manifest id `static-dom`) | **2026-08-17 UI 4077:** `apply.desync.ruleset` PASS (`bad_target:ruleSet`). |
| ~~Inject desync (eof)~~ | `apply-honesty-desync-eof` — EOF desync — ghost live CSS rule then CHECK (DOM client required) | `fixtures/static-dom.html` (manifest id `static-dom`) | **2026-08-17 UI 4077:** `apply.desync.eof` PASS (setup stayed synced, ghost on adopted, CHECK `address_miss:ruleNew`). |

### Automated tests / sign-off (open)

| Id | Missing | Assert to close | Status |
|----|---------|-----------------|--------|
| **SEAL-DOM-P1-OPEN2** | Detached-row GC is implemented lean; lifetime policy not signed off ([open.md](open.md) OPEN-2). | Ruling recorded + soak **PP-ID-4** (map does not grow without bound); no silent resurrection. | open |
| **SEAL-DOM-P1-OPEN3** | `CHECK` over id ranges is chosen in prose; not confirmed fail-closed ([open.md](open.md) OPEN-3). | Unit: CHECK over published id ranges fails closed on mismatch; sign-off in [decision-log.md](decision-log.md). | open |
| **SEAL-CSSOM-P1-STYLE** | In-scope `CSSStyleRule` live updates already exist; gates are still observe-only. | **PP-CSSOM-F-3..F-5**, **PP-CSSOM-H-1** fail closed after settle on foundation+heavy (not “looked OK”). | open |

Until shadow/pierce ships (feature below), a closed-shadow fixture must **fail explicit unsupported**, never soft-skip.

---

## 2. Gaps (current path is wrong or unsealed)

The emit/apply path **already runs** these. Fix the algorithm; do not add a second path ([acceptance.md](acceptance.md) T3).

| Id | Problem | Assert to close | Status |
|----|---------|-----------------|--------|
| **SEAL-DOM-P1-SVG** | `NODE_NEW` always `createElement` (HTML). SVG / namespaced elements are the wrong namespace or inert vs Virtual. | Fixture with SVG subtree: table×DOM + tree×tree / paint at S; `namespaceURI` matches Virtual. Proposed **PP-F-SVG-1**. | open |
| **SEAL-CSSOM-P1-IDSPACE** | Leftover split Dom vs Cssom id ranges vs one monotonic session allocator ([decision-log.md](decision-log.md)). | Wire + table: Sheet/Rule ids share the DOM allocator; no high-bit Cssom range. Unit / decode invariant. | open |
| **OPEN-1** ([open.md](open.md)) | `NODE_DROP` of an absent id: `malformed` vs tolerate. Current code: `malformed`. Not a new opcode. | Ruling + test that matches the ruling (if tolerated, MUST count in telemetry). | open |

Honesty P0 for apply (flush-after-desync, failed `setAttribute`, phase-1 pres, `NODE_NEW` connected probe, `RULE_SET` on grouping, EOF rule membership, author vs adopted paint, doc/code alignment) is **closed** — archive at the bottom. UI desync proofs for attr / ruleset / eof: 2026-08-17.

---

## 3. Features not implemented

Not gaps in `NODE_NEW` / `RULE_SET` / CHECK. These ops or walks **are not on the lab happy path yet**.

### DOM / protocol

| Id | What to build | Assert | Status |
|----|---------------|--------|--------|
| **SEAL-DOM-P1-PROP** | `PROP_SET` (§4.4) on the wire — `value` / `checked` / form controls. | **PP-IN-2** / form fixture: Virtual control state ↔ Projected after settle; missing op **fails**, not skip. | open |
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
| **QA / tests** | 3 ids | OPEN2, OPEN3, STYLE (human looks dated 2026-08-17) |
| **Gaps** | 2 ids + OPEN-1 | SVG namespace; Cssom id split; `NODE_DROP` absent id |
| **Features** | 9 ids | PROP, shadow, remaining ISA, multi-doc, pierce CSS, nested rows, C5, scale, CSS iso |

Closed honesty (P0): 8 ids (FLUSH, ATTR, PHASE1, PROBE, RULESET, DOUBLE, EOF, DOCS).

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

### CSSOM

Conditional scope at close: constructed sheets on `adoptedStyleSheets` + top-level `CSSStyleRule`. Pierce still desyncs (feature).

| Id | Problem (one line) | Assert | Status |
|----|--------------------|--------|--------|
| **SEAL-CSSOM-P0-RULESET** | `RULE_SET` on non-`CSSStyleRule` could no-op. | **PP-CSSOM-A-1**: emit+table + foundation O2 + UI `apply.desync.ruleset` (2026-08-17). | **closed 2026-08-16** (emit + O2; UI desync 2026-08-17) |
| **SEAL-CSSOM-P0-DOUBLE** | Author `<style>` vs constructed/`adopted` boundary. | **PP-CSSOM-A-2**: emit skips `ownerNode`; `cssom-double` cascade+O2; UI 4077 visually OK 2026-08-17 (`fixtures/cssom-double.html`). | **closed 2026-08-17** (emit + Virtual fold; Projected paint human 2026-08-17) |
| **SEAL-CSSOM-P0-EOF** | EOF CSSOM check verified sheet handles only. | **PP-CSSOM-A-3**: unit + O2 + UI `apply.desync.eof` (2026-08-17). | **closed 2026-08-16** (function + O2; UI desync 2026-08-17) |
| **SEAL-CSSOM-P0-DOCS** | Comments claimed C6 phase-2 still no-op. | Docs + `opcodes.ts` match `client/applyDom.ts`. | **closed 2026-08-16** |
