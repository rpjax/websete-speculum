# PageProjection — lab seal gaps (DOM × CSSOM)

**Status:** kill list for **lab algorithm seal**. Living tracker; append new gaps, do not paper over.  
**Index:** [README.md](README.md). Bugs/OPEN-* narrative: [open.md](open.md). Coverage rows: [test-matrix.md](test-matrix.md).  
**Accept bar:** [acceptance.md](acceptance.md). Protocol: [frame-protocol.md](frame-protocol.md).

---

## Purpose / what “seal” means

| Term | Means | Does **not** mean |
|------|--------|-------------------|
| **Lab DOM seal** | DOM table + phase-2 materialize algorithm is **honest** and meets **numerical 1:1** for the **stated single-document lab scope**, with assert-backed proofs (probes / units / lab gates). | Production Live cutover; dual-path deletion; full ISA; OPEN-6 pierce |
| **Lab CSSOM seal** | Owned CSSOM path for **constructed / `adoptedStyleSheets` + `CSSStyleRule`** is **honest** and meets **perceived/eventual** live bar for that scope ([acceptance.md](acceptance.md)), with assert-backed proofs. | Projected CSS automated iso vs a second browser; pierce; nested-as-rows; C5 sensor relock; `web/` production cutover |

**Two independent tracks.** Kill DOM items without waiting on CSSOM, and vice versa. A green CSSOM foundation gate does not seal DOM; tree×tree green does not seal CSSOM apply honesty.

**Seal gaps vs destination:** rows below are **lab algorithm honesty / parity** at the current stated scope. **Live cutover** (delete dual path, ship V4 as Live) is the **product goal after seals** — [roadmap.md](roadmap.md). It is **not** a seal gap and does **not** appear in this kill list.

**Law:** every gap below closes only with an **effect assert** that matches the claim (function unit ≠ state parity ≠ desync-when-needed). Protocol greens (`200`, `ResyncServed`, `ownedRules`, hop counts) alone never close a row — [acceptance.md](acceptance.md), [observability.md](observability.md).

**Priority ladder (both tracks):**

| Priority | Meaning | Kill order |
|----------|---------|------------|
| **P0** | Implementation honesty / false-green / protocol divergence at the **current lab V4 point** | First |
| **P1** | Parity holes inside the **current stated seal scope** | After P0 |
| **P2** | Incremental features, deferred ISA, scale opts (still lab seal scope — not Live cutover) | Last |

Status values: **open** | **closed** (date + assert id). Do not mark PASS in [test-matrix.md](test-matrix.md) until the assert exists and fails when the bug is reintroduced.

---

## DOM seal gaps

### P0 — honesty / false-green / divergence

| Id | Problem (one line) | Assert to prove closed | Status |
|----|--------------------|------------------------|--------|
| **SEAL-DOM-P0-FLUSH** | `DomFrameApplier.flush` keeps applying later frames in the same batch after a desync return — dirty client continues as if armed. | **PP-APPLY-1**: `applyFramesUntilDesync` + `applyFrame` boolean; unit `testDomFrameApplierFlushStopsOnDesync` in `Refactor/sidecar/unit.ts` (flush uses the helper). | **closed 2026-08-16** (unit PP-APPLY-1) |
| **SEAL-DOM-P0-ATTR** | `applyAttrs` empty `catch` swallows failed `setAttribute` → table attrs can diverge from live DOM without desync. | **PP-APPLY-2**: (1) function: `testApplyAttrPairsReportsFailure`. (2) parity: lab `apply-attrs` snap O2 after `attrSet` (`fold/applyAttrs`). (3) desync: `apply-honesty-desync-attr` inject `NODE_NEW` invalid name → client snapshot `desynced` (`apply.desync.attr`). CLI without DOM client **skips** (3), does not close from skip. | **closed 2026-08-16** (function + O2 fold; desync fold requires lab client) |
| **SEAL-DOM-P0-PHASE1** | Phase-1 structural preconditions are weak vs §6 “validate then materialize” — address/topology can pass table then fail (or skip) in phase 2 inconsistently. | **PP-APPLY-3**: frames that violate published preconditions abort phase 1 with `precondition`/`malformed` and **zero** phase-2 side effects; unit falsifiers per op class under test. | **closed 2026-08-17** (unit `testApplyFrameToTableCheckedPhase1Pres` — INSERT/REMOVE/ATTR/TEXT/RULE/SHEET Pre; failing op not applied) |
| **SEAL-DOM-P0-PROBE** | Tree×tree CI incomplete; `NODE_NEW` in frame S ⇒ `isConnected` probe not built — halt iso is blind to PP-FR-1-class stream leaks ([observability.md](observability.md) §8, residual #7 in [open.md](open.md)). | **PP-FR-1** probe + CLI/UI tree×tree path: after settle, every `NODE_NEW` in S is connected; tree×tree not `skipped` on the lab gate that claims DOM seal. | **closed 2026-08-17** (`probe.nodeNewConnected` on flush/iso; `iso.tree` **fail** when `hasClientRelay` and skipped; CLI without iframe still explicit skip) |

### P1 — parity holes (current single-doc lab scope)

| Id | Problem (one line) | Assert to prove closed | Status |
|----|--------------------|------------------------|--------|
| **SEAL-DOM-P1-SVG** | `NODE_NEW` uses `createElement` only — SVG / namespaced elements wrong or inert vs Virtual. | Lab fixture with SVG subtree: table×DOM + tree×tree / paint probe at S; element namespaceURI matches Virtual. Proposed **PP-F-SVG-1**. | open |
| **SEAL-DOM-P1-SHADOW** | Shadow trees are invisible to the single-doc publish walk (not flattened / not pierced) → Projected misses shadow UI. | Explicit scope assert: either documented **unsupported until OPEN-6 / pierce policy** with failing probe on closed shadow, or publish path matches chosen policy (**PP-F-3** / **PP-F-4** honesty — fail open, never soft-skip). | open |
| **SEAL-DOM-P1-PROP** | `PROP_SET` (§4.4) not on the lab wire — form/`value`/checked/etc. numerical 1:1 breaks on real controls (feature-shaped but **parity** for browseable pages). | **PP-IN-2** / form fixture: Virtual control state ↔ Projected property after settle; missing op fails, not skip. | open |
| **SEAL-DOM-P1-OPEN2** | OPEN-2 detached-row lifetime: implemented lean; needs explicit sign-off to seal ([open.md](open.md)). | Ruling recorded + soak assert **PP-ID-4** (map does not grow without bound); no silent resurrection. | open |
| **SEAL-DOM-P1-OPEN3** | OPEN-3 `CHECK.scope` id-range: resolved in prose; needs confirm-before-seal ([open.md](open.md)). | Unit: CHECK over published id ranges fails closed on mismatch; sign-off row in decision-log. | open |

### P2 — incremental (after current single-doc seal)

| Id | Problem (one line) | Assert to prove closed | Status |
|----|--------------------|------------------------|--------|
| **SEAL-DOM-P2-ISA** | ISA incomplete in lab: `NODE_META`, `DOC_STATE`, `SCROLL_*`, `NODE_SNAPSHOT` (and related) not sealed on the happy path. | Per-opcode matrix rows (**PP-F-5**, **PP-EST-4**, **PP-MOVE-3**, **PP-D16-***) with effect probes — not “opcode exists”. | open |
| **SEAL-DOM-P2-OPEN6** | OPEN-6 multi-document / pierce — pinned in lab; outside single-doc seal scope. | Per-document streams + pierce asserts (**PP-F-4**); fail unsupported until protocol ships. | open |

---

## CSSOM seal gaps

**Seal scope (conditional):** constructed sheets on `adoptedStyleSheets` + top-level **`CSSStyleRule`** in-place updates. Outside that scope → P2 / support-matrix honesty, not silent green.

### P0 — honesty / false-green / divergence

| Id | Problem (one line) | Assert to prove closed | Status |
|----|--------------------|------------------------|--------|
| **SEAL-CSSOM-P0-RULESET** | `RULE_SET` on non-`CSSStyleRule` (e.g. `CSSMediaRule`) can no-op (`cssText` assign) without verify/desync → table text ≠ live rule. | **PP-CSSOM-A-1**: (1) emit+table: `testCssomGroupingContentChangeEmitsDropNew`. (2) parity: `cssom-foundation` `ops.mediaInner` (`ruleSet=0`, `ruleDrop>=1`, `ruleNew>=1`) + `mediaInner.*` cssomO2. (3) desync: `apply-honesty-desync-ruleset` inject `RULE_SET` on grouping → `apply.desync.ruleset`. CLI without DOM client skips (3). | **closed 2026-08-16** (emit + opWindow/O2 fold; desync fold requires lab client) |
| **SEAL-CSSOM-P0-DOUBLE** | `<style>` / `document.styleSheets` vs constructed/`adoptedStyleSheets` boundary unclear — risk of double-apply or missing author sheet on Projected. | **PP-CSSOM-A-2**: fixture with both author `<style>`/`link` and constructed adopted; after settle, Projected has **one** effective paint path matching Virtual policy (no double cascade / no missing sheet). Probe at S, not event counts. | **closed 2026-08-17** (emit: `collectCssomPlaneSheets` skips `ownerNode`; lab `cssom-double` Virtual cascade+cssomO2; Projected `doublePaint` fold requires lab client — CLI skips (3)) |
| **SEAL-CSSOM-P0-EOF** | End-of-frame CSSOM check (`cssomHandlesMatchTable`) verifies **sheet handles only**, not rule membership/order vs table. | **PP-CSSOM-A-3**: (1) function: `testCssomEndOfFrameMatch`. (2) parity: foundation snaps after successful frames (`cssomO2.identical`). (3) desync: `apply-honesty-desync-eof` ghost live rule + CHECK → `apply.desync.eof`. CLI without DOM client skips (3). | **closed 2026-08-16** (function + O2 fold; desync fold requires lab client) |
| **SEAL-CSSOM-P0-DOCS** | Spec/code comments claimed C6 phase-2 still no-op while lab client materializes constructed sheets — process false-green. | Docs + `opcodes.ts` header match `client/applyDom.ts` (C6 constructed/adopted shipped in lab; pierce still desync). Checklist item — **closed in this pass** when prose matches code. | **closed 2026-08-16** (doc/comment alignment) |

### P1 — parity / id-space honesty (current seal scope)

| Id | Problem (one line) | Assert to prove closed | Status |
|----|--------------------|------------------------|--------|
| **SEAL-CSSOM-P1-IDSPACE** | Residual D-SPEC-8 disjoint Dom/Cssom id ranges vs V4 **one monotonic id space** ([decision-log.md](decision-log.md)) — any leftover split assumes must die for seal honesty. | Wire + table assert: Sheet/Rule ids share the session monotonic allocator with DOM; no high-bit Cssom range. Lab unit / decode invariant. | open |
| **SEAL-CSSOM-P1-STYLE** | In-scope `CSSStyleRule` live updates (`RULE_SET` / insert/delete) perceived parity after settle on foundation+heavy fixtures. | Existing **PP-CSSOM-F-3..F-5**, **PP-CSSOM-H-1** + human 4077; keep open until gates are mandatory fail-closed (not observe-only). | open |

### P2 — deferred incremental

| Id | Problem (one line) | Assert to prove closed | Status |
|----|--------------------|------------------------|--------|
| **SEAL-CSSOM-P2-PIERCE** | Pierce CSSOM (iframe/shadow sheets) — C7; desync today in lab client. | OPEN-6 + **PP-F-4** / cssom C7 asserts. | open |
| **SEAL-CSSOM-P2-NESTED** | Nested rules as table rows vs grouping `cssText` only (I2). | Nested walk oracle + matrix row when protocol chooses rows. | open |
| **SEAL-CSSOM-P2-C5** | C5 write-path hooks vs poll as primary sensor — not relocked ([cssom-poll-algorithm.md](cssom-poll-algorithm.md)). | Ruling + sensor journey update; foundation still must hold. | open |
| **SEAL-CSSOM-P2-SCALE** | Scale amortizations (generations, skip-serialize, hints) — after honesty; must not hide wrong settle. | Perf/capacity in `perf.yml`; functional settle asserts still fail on incomplete sheet. | open |
| **SEAL-CSSOM-P2-ISO** | Automated Projected CSS isomorphism (second surface × Virtual), beyond table×live O2. | New probe class; CLI `--iso` today does **not** claim this ([observability.md](observability.md)). | open |

---

## Pendência humana (P0 closed — falta olhar na tela)

Os P0 acima ficam **closed**. O CLI / unit já passou. O que falta é **tu** no lab UI (4077), olho no Virtual × Projected. Não reabre o gap se estiver feio: anota o que viu e decide.

| O quê | Onde (Run) | O que tu confirma |
|-------|------------|-------------------|
| Árvore Projected (PROBE) | `apply-attrs` e/ou `soak` | A árvore não vem SKIP; Virtual e Projected batem no olho |
| Sem tinta dupla (DOUBLE) | `cssom-double` | `#author-probe` vermelho, `#adopted-probe` azul, **uma** vez cada — Projected não “engorda” o author no adopted |
| Inject honesty (ATTR / RULESET / EOF) | `apply-honesty-desync-attr` / `-ruleset` / `-eof` | Client desynca de verdade (já era pendência da UI; CLI skip sem iframe) |

Quando passar: risca a linha aqui ou escreve a data. Se falhar no olho, o gap volta a open — não se inventa workaround.

---

## Counts (open only)

| Track | P0 | P1 | P2 | Total open |
|-------|----|----|----|------------|
| **DOM** | 0 (+4 closed FLUSH, ATTR, PHASE1, PROBE) | 5 | 2 | **7** |
| **CSSOM** | 0 (+4 closed RULESET, EOF, DOCS, DOUBLE) | 2 | 5 | **7** open |

---

## How to kill an item

1. Implement the **designed** algorithm fix (no ad-hoc second path — [acceptance.md](acceptance.md) T3).
2. Land the named assert (unit and/or lab gate and/or matrix row) that **fails** if the bug returns.
3. Flip Status to `closed YYYY-MM-DD` here; update [test-matrix.md](test-matrix.md) only when the assert is real — never mark PASS from protocol-only signals.
4. If the gap was an OPEN-*/ruling, append [decision-log.md](decision-log.md) and update [open.md](open.md).

---

## Related (not this list)

- **Destination — Live cutover** (product goal after lab seals; dual-path deletion, full session contract): [roadmap.md](roadmap.md) — **not** a seal-gap row.
- **Pre-cutover product feature (last before Integration):** `<canvas>` **content** projection — [roadmap.md](roadmap.md) gate 6. Interim placeholder: [support-matrix.md](support-matrix.md). **Not** a seal-gap row.
- Other product accept gaps (MSE, …): [support-matrix.md](support-matrix.md).
- Named bugs / OPEN-* copy: [open.md](open.md).
