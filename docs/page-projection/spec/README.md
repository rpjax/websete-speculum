# PageProjection spec (V4) — agent start here

**Status:** official spec for `MirrorMode.PageProjection`.  
**Accept bar:** [acceptance.md](acceptance.md) — 1:1 with the original site. **DOM** numerical; **CSSOM live** perceived/eventual (not 60 Hz lockstep).  
**Protocol:** [frame-protocol.md](frame-protocol.md) — the V4 engine (replicated table, binary frames, two-phase apply, resync).  
**Where you are:** V4 **algorithm** = one bootstrap per `window`. Session path + **web Integration (gate 10 surface)** landed: `PageProjectionBrowserSession`, sealed factory, `web/` → `@speculum/page-projection/projected`, Live CDP data plane, lab loopback-only. Remaining before full M1 accept: **canvas** (gate 7), antibot/asset store, compose MirrorMode for MotorAssert deep Live.

---

## Now (2026-08-22) — start a new chat here

**Shipped:** contract hygiene + Integration Live surface (gates 6.6 + 8 path + 10 smoke). Lab aliases out. Launch split + Frames stream. `web/live/page` apply deleted.

**Input design (2026-08-23):** [input-v2.md](input-v2.md) **A/B/C** — A CDP fire-and-forget (pointer/key/viewport); B Control→`domNodes` (scrollElement/focus/blur/input); C CDP handle only for `setFiles`. Id-assertive activate superseded. No generation/sequence gates.

**Next product work (ordered):**
1. **Canvas content projection** — last engine feature ([roadmap.md](roadmap.md) gate 7).
2. MotorAssert compose seed `MirrorMode.PageProjection` for deep Live surface (Sessions.Tests `PP-LIVE-*` already green).
3. OPEN-6 **NIT** flavours when blueprints exist.
4. Antibot / asset store / IDB restore as Live needs them.
5. Optional: noscript/parity DOM on real sites; Patchright `Frame was detached` session stability.

Open named shadow / form PROP / SVG / Input V2 lab blueprints / session shape / **gate 10 surface** — closed. Do **not** reopen apply honesty ([observability.md](observability.md) §7).

If you are an agent with limited context: **read this file (including Now), then `acceptance.md`, then `open.md`, then `seal-gaps.md`, then `roadmap.md`, then only the protocol sections you are changing.** Do not open `../archive/`.

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
| CSSOM poll **algorithm** (worst-case-first; I3 copy-then-hash; this poll **is** C5) | **[cssom-poll-algorithm.md](cssom-poll-algorithm.md)** |
| CSSOM sensor **journey** (two truths, why not hooks/CDP, foundation vs amortizations) | **[cssom-sensor-journey.md](cssom-sensor-journey.md)** |
| Off-`childNodes` subtrees (LOCKED) | **[subtrees.md](subtrees.md)** — two kinds only: shadow vs nested browsing context |
| Shadow (kind 1) | **[shadow.md](shadow.md)** — same instance; walker follows `.shadowRoot` |
| Multi-document (OPEN-6, kind 2) | **[multi-document.md](multi-document.md)** — runtime implements `emitFrame`; algorithm per `window`; header `contextId` = mine; child-scope indexer; bus (postMessage) |
| Input intents | **[input-v2.md](input-v2.md)** (normative V4; **A/B/C** dispatch 2026-08-23) — [input.md](input.md) is V1 provenance only |
| Asset serve plane | **[virtual-assets.md](virtual-assets.md)** |
| Virtual Document **CSP surgery** (cutover session) | **[csp.md](csp.md)** |
| Session / mirror-mode contracts (sidecar port) | **[browser-session.md](browser-session.md)** — SEALED 2026-08-21 |
| Published product gaps | **[support-matrix.md](support-matrix.md)** |
| Lab tracker (QA / gaps / features; DOM and CSSOM independent) | **[seal-gaps.md](seal-gaps.md)** |
| What to build next | **[roadmap.md](roadmap.md)** |
| Open bugs / OPEN-* / pending rulings | **[open.md](open.md)** |
| Why a decision exists | **[decision-log.md](decision-log.md)** (append-only; never rewrite history) |

If two live docs disagree on the **PP frame** (table, opcodes, apply), **frame-protocol.md wins**. Off-tree kinds: **[subtrees.md](subtrees.md)**. Multi-document: **[multi-document.md](multi-document.md)**. Session / mirror port: **[browser-session.md](browser-session.md)**. DataPlane envelope does not carry `contextId`. Do not “choose in code.” Append a decision-log row if you change behaviour.

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
| 8a | [browser-session.md](browser-session.md) | If touching sidecar session / sinks / resync / state snapshot / mirror modes |
| 8b | [lab-design.md](lab-design.md) | If restructuring lab host/UI/CLI/dossier/blueprints (do not invent session APIs — follow browser-session.md) |
| 9 | Adjacent layer file | cssom / **csp** / **cssom-poll-algorithm** / **cssom-sensor-journey** / **subtrees** / **shadow** / **multi-document** / input / virtual-assets / support-matrix / test-matrix |
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
    observability.md        probes vs events; state snapshot; lab as caller
    lab-design.md           lab chassis / browse vs run / blueprints / dossier (shipped)
    cssom.md                CSSOM plane (materialize)
    cssom-poll-algorithm.md poll sensor (I1–I11)
    cssom-sensor-journey.md why this detector; two truths; rulings
    subtrees.md             LOCKED: two off-childNodes kinds (shadow, nested browsing context)
    shadow.md               kind 1 — same instance; open/named shipped
    multi-document.md       OPEN-6: runtime ≠ algorithm; contextId u32; child-scope indexer; RPC pipe
    input.md                Projected → Virtual intents (V1 provenance)
    input-v2.md             Input V4 normative (lab M1 closed)
    csp.md                  Virtual Document CSP surgery (cutover)
    browser-session.md      Session / mirror-mode contracts (SEALED)
    virtual-assets.md       URL serve plane
    support-matrix.md       accepted product gaps
    test-matrix.md          PP-* coverage (some rows pending V4 re-author)
    decision-log.md         append-only log (all eras, labeled)
    roadmap.md              M1/M2/M3 + cutover gates
    open.md                 bugs, OPEN-*, rulings, residuals
    seal-gaps.md            lab tracker: QA / gaps / features (independent DOM vs CSSOM)
  archive/                  DO NOT IMPLEMENT FROM
```

Code that implements V4 algorithm: `@speculum/page-projection` (`Refactor/packages/page-projection` — `core` / `virtual` / `projected`).  
Sidecar callers: `lab/`, `session/`, `inject/`, CDP `input/` — [observability.md](observability.md), [lab-design.md](lab-design.md).  
Lab UI: `npm run lab:projection`. Agent: `npm run lab:run -- --blueprint soak …` → dossier dir / `verdicts.json`.  
Lab smoke: `Refactor/sidecar/scripts/smoke-projection-lab.js`.  
Lab units: `Refactor/sidecar/unit.ts` (includes V4 session + lab scheduler tests).

---

## What V4 is (one paragraph)

The replicated structure is a **node table** (`ReplicatedTable`), not a belief about the DOM (P0). Each tick the producer coalesces `MutationRecord`s into one **frame** of opcodes (`NODE_NEW`, `INSERT`, `REMOVE`, `ATTR_*`, `TEXT_SET`, `CHECK`, `EPOCH_RESET`, `NODE_DROP`, CSSOM ops). The client **two-phase applies**: table first (validate `preTableHash` + ops + closing `CHECK`), then materialize to a sandboxed iframe. There is **no establish phase**: cold start is `resyncVirtual` (walk live DOM, fill identity map, `emitResyncFrame`). Mid-session desync is client-initiated `emitResyncFrame` into a **real double-buffer** iframe; swap after that frame’s closing `CHECK` verifies. `generation` bumps only on top-level Document replacement (`EPOCH_RESET`). Soft-nav does not bump. Resync does not bump.

---

## Anti-sources (do not design from)

- `docs/page-projection/archive/**`
- Deleted legado trees (do not reintroduce): `patchright/mirror/page/**`, `web/.../live/page/**`
- Any doc that still says establish HTML / Node mirror / `speculum-anchor` / DomMap bootstrap as the happy path
- Green protocol hops (`200`, `ResyncServed`, `htmlLen`) as accept

---

## 1:1 rule

Every behaviour change MUST update the matching live spec file in the same change set. Ad-hoc code without a doc update is a process defect. To reverse a decision, **append** a row to [decision-log.md](decision-log.md); do not edit history.
