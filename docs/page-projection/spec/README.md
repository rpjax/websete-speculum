# PageProjection spec (V4) — agent start here

**Status:** official spec for `MirrorMode.PageProjection`.  
**Accept bar:** [acceptance.md](acceptance.md) — 1:1 with the original site. **DOM** numerical; **CSSOM live** perceived/eventual (not 60 Hz lockstep).  
**Protocol:** [frame-protocol.md](frame-protocol.md) — the V4 engine (replicated table, binary frames, two-phase apply, resync).  
**Where you are:** lab engine under `Refactor/sidecar/browser/mirror/projection/` implements V4 **DOM table, single document** (Stages 1–4) plus lab CSSOM for constructed adopted sheets and `CSSStyleRule`. Production (`PatchrightBrowserSession.ts`) still runs the **legacy** `LivePageProjection` path. `V4ProjectionBrowserSession` is the **temporary** lab `BrowserSession`; at cutover it must be **complete** (full contract, V4 implementations — not leftover legado) — [roadmap.md](roadmap.md) CUTOVER-SESSION. **Production cutover waits for the full product** (CSSOM + nested/multidocs + redesigned input + **canvas projection** as last product feature). Next lab work: [seal-gaps.md](seal-gaps.md) §3 (features).

If you are an agent with limited context: **read this file (including Now), then `acceptance.md`, then `open.md`, then `seal-gaps.md`, then `roadmap.md`, then only the protocol sections you are changing.** Do not open `../archive/`.

---

## Now (2026-08-17) — start a new chat here

Lab QA on the current path is **done**. SVG / namespaced `NODE_NEW` **closed 2026-08-17**. Next: features (`PROP_SET`, shadow, remaining ISA, OPEN-6, CSS pierce/nested) — [seal-gaps.md](seal-gaps.md) §3.

Id space and OPEN-1 (`NODE_DROP` absent id = `malformed`) **closed 2026-08-17**.

Do **not** reopen apply honesty. The 2026-08-17 ATTR / RULESET / EOF desync tests failed because of the **lab harness**, not the apply algorithm. Story: [observability.md](observability.md) §7.

Lab UI: `npm run lab:projection` in `Refactor/sidecar` → **http://127.0.0.1:4077/**. Headed: `SPECULUM_LAB_HEADED=1`. Always name the full blueprint id + description + fixture when asking a human to run something.

Talk to Rodrigo in Portuguese, papo reto: simple idea → simple sentence. Technical density only when debating the detail (`.cursor/rules/speculum-comunicacao.mdc`).

---

## Conflict rule (non-negotiable)

| Layer | Wins |
|-------|------|
| Frame / replicated state / wire / opcodes / producer construction / apply / recovery | **[frame-protocol.md](frame-protocol.md)** |
| Accept / anti-protocol-PASS / no ad-hoc | **[acceptance.md](acceptance.md)** |
| K1–K5, P1–P7, E1–E11 | **[budgets.md](budgets.md)** |
| Oracles O1–O5 | **[oracles.md](oracles.md)** |
| Lab / probes / event telemetry vs asserts | **[observability.md](observability.md)** |
| Lab **architecture** (chassis, browse vs run, blueprints, dossier) | **[lab-design.md](lab-design.md)** — shipped 2026-08-16 |
| CSSOM materialization detail | **[cssom.md](cssom.md)** — opcodes live in frame-protocol §4.6 |
| Lab CSSOM **poll algorithm** (worst-case-first; I3 copy-then-hash; does not relock C5) | **[cssom-poll-algorithm.md](cssom-poll-algorithm.md)** |
| CSSOM sensor **journey** (two truths, why not hooks/CDP, foundation vs amortizations) | **[cssom-sensor-journey.md](cssom-sensor-journey.md)** |
| Input intents | **[input.md](input.md)** — address by `uint32` only |
| Asset serve plane | **[virtual-assets.md](virtual-assets.md)** |
| Published product gaps | **[support-matrix.md](support-matrix.md)** |
| Lab tracker (QA / gaps / features; DOM and CSSOM independent) | **[seal-gaps.md](seal-gaps.md)** |
| What to build next | **[roadmap.md](roadmap.md)** |
| Open bugs / OPEN-* / pending rulings | **[open.md](open.md)** |
| Why a decision exists | **[decision-log.md](decision-log.md)** (append-only; never rewrite history) |

If two live docs disagree on the protocol layer, **frame-protocol.md wins**. Do not “choose in code.” Append a decision-log row if you change behaviour.

**V4 prevails.** Pre-V4 designs (establish HTML chunks, Node mirror, `childList FULL/APPEND`, `speculum-anchor`, DomMap bootstrap, resync watermark, `document` opcode as tree dump) are **dead**. They live only under [`../archive/`](../archive/README.md) for provenance.

---

## Reading order

| Step | File | Why |
|------|------|-----|
| 1 | This file | Map + anti-sources |
| 2 | [acceptance.md](acceptance.md) | 1:1 bar; T3 / no-ad-hoc restated in V4 terms |
| 3 | [open.md](open.md) | Named bugs, OPEN-*, rulings — do not ship around them |
| 4 | [seal-gaps.md](seal-gaps.md) | QA and tests, then algorithm gaps, then unimplemented features. Live cutover is [roadmap.md](roadmap.md), not a gap row. |
| 5 | [roadmap.md](roadmap.md) | Ordered gates to production |
| 6 | [frame-protocol.md](frame-protocol.md) | The engine |
| 7 | [budgets.md](budgets.md) + [oracles.md](oracles.md) | If touching cost, CI, or accept |
| 8 | [observability.md](observability.md) | If touching lab, telemetry events, probes, `report.json`, isomorphism |
| 8b | [lab-design.md](lab-design.md) | If restructuring lab host/UI/CLI/dossier/blueprints (do not touch BrowserSession) |
| 9 | Adjacent layer file | cssom / **cssom-poll-algorithm** / **cssom-sensor-journey** / input / virtual-assets / support-matrix / test-matrix |
| 10 | [decision-log.md](decision-log.md) | Index; full CSSOM *why* is [cssom-sensor-journey.md](cssom-sensor-journey.md) |

---

## Tree (live only)

```text
docs/page-projection/
  README.md                 → points here
  spec/
    README.md               this file
    acceptance.md           constitution
    frame-protocol.md       V4 protocol (normative)
    budgets.md              K1–K5, P*, E*
    oracles.md              O1–O5
    observability.md        probes vs events; coherent snapshot; lab as caller
    lab-design.md           lab chassis / browse vs run / blueprints / dossier (shipped)
    cssom.md                CSSOM plane (materialize)
    cssom-poll-algorithm.md lab poll sensor (I1–I11)
    cssom-sensor-journey.md why this detector; two truths; rulings
    input.md                Projected → Virtual intents
    virtual-assets.md       URL serve plane
    support-matrix.md       accepted product gaps
    test-matrix.md          PP-* coverage (some rows pending V4 re-author)
    decision-log.md         append-only log (all eras, labeled)
    roadmap.md              M1/M2/M3 + cutover gates
    open.md                 bugs, OPEN-*, rulings, residuals
    seal-gaps.md            lab tracker: QA / gaps / features (independent DOM vs CSSOM)
  archive/                  DO NOT IMPLEMENT FROM
```

Code that implements V4: `Refactor/sidecar/browser/mirror/projection/`.  
Lab is a **caller** of `V4ProjectionBrowserSession` — [observability.md](observability.md).  
Lab architecture (cutover): [lab-design.md](lab-design.md).  
Lab UI: `npm run lab:projection`. Agent: `npm run lab:run -- --blueprint soak …` → dossier dir / `verdicts.json`.  
Lab smoke: `Refactor/sidecar/scripts/smoke-projection-lab.js`.  
Lab units: `Refactor/sidecar/unit.ts` (includes V4 session + lab scheduler tests).

---

## What V4 is (one paragraph)

The replicated structure is a **node table** (`ReplicatedTable`), not a belief about the DOM (P0). Each tick the producer coalesces `MutationRecord`s into one **frame** of opcodes (`NODE_NEW`, `INSERT`, `REMOVE`, `ATTR_*`, `TEXT_SET`, `CHECK`, `EPOCH_RESET`, `NODE_DROP`, CSSOM ops). The client **two-phase applies**: table first (validate `preTableHash` + ops + closing `CHECK`), then materialize to a sandboxed iframe. There is **no establish phase**: cold start is `resyncVirtual` (walk live DOM, fill identity map, `emitResyncFrame`). Mid-session desync is client-initiated `emitResyncFrame` into a **real double-buffer** iframe; swap after that frame’s closing `CHECK` verifies. `generation` bumps only on top-level Document replacement (`EPOCH_RESET`). Soft-nav does not bump. Resync does not bump.

---

## Anti-sources (do not design from)

- `docs/page-projection/archive/**`
- `Refactor/sidecar/browser/patchright/mirror/page/**`
- `Refactor/web/src/features/sessions/live/page/**`
- Any doc that still says establish HTML / Node mirror / `speculum-anchor` / DomMap bootstrap as the happy path
- Green protocol hops (`200`, `ResyncServed`, `htmlLen`) as accept

---

## 1:1 rule

Every behaviour change MUST update the matching live spec file in the same change set. Ad-hoc code without a doc update is a process defect. To reverse a decision, **append** a row to [decision-log.md](decision-log.md); do not edit history.
