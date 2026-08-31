# PageProjection spec (V4) — agent start here

**Status:** official spec for `MirrorMode.PageProjection`.  
**Accept bar:** [acceptance.md](acceptance.md) — 1:1 with the original site. **DOM** numerical; **CSSOM live** perceived/eventual (not 60 Hz lockstep).  
**Protocol:** [frame-protocol.md](frame-protocol.md) — the V4 engine (replicated table, binary frames, two-phase apply, resync).  
**Where you are:** V4 **algorithm** = one bootstrap per `window`. Session path + **web Integration (gate 10 surface)** landed: `PageProjectionBrowserSession`, sealed factory, `web/` → `@speculum/page-projection/projected`, **sole data plane = loopback WS**. Remaining before full M1 accept: **canvas** (gate 7), antibot/asset store, compose MirrorMode for MotorAssert deep Live.

---

## Now (2026-08-30) — start a new chat here

**Motor 0.3.0:** in progress — **[motor milestone only](motor-0.3.0.md)** (not production RBI). Opus/Rodrigo 2026-08-30: PP **core** lab-proven; tag gates = gen-pack revert, Eneba redirect proof, B3 if red, full Windows gates. **B1 done** · **B2 withdrawn** · dirty tree **committed**.  
**Ordered TODOs (tag → Live preview → M1):** [../LIVE-PP-0.3.0-IMPLEMENTATION.md](../LIVE-PP-0.3.0-IMPLEMENTATION.md).

**Shipped (2026-08-29…30):**
- **K5 / iOS touch** — `iframe.sandbox` removed (WebKit blocks touch); K5 via CSP in `PROJECTED_STANDARDS_SRCDOC` + `ensureProjectedK5Csp` on apply. Units: `projectedK5.unit.ts`, `projectedNativeGuard.unit.ts`. Decision: [decision-log.md](decision-log.md) 2026-08-30.
- **Loopback `document.install`** — same-socket hello: higher gen adopts; idempotent re-hello; lower gen rejected. Session chains `waitEstablished({ afterGeneration })` after install. Units: `nodeDataPlane.unit.ts`.
- **Projected apply gate** — `ProjectedApplyGate` queues frames during async recreate/cold resync (`flightDepth`, `draining`, cap **64** sized for ~59 ms cold apply class, overflow streak **3** → `apply_gate_overflow_loop`). `discardPending()` on generation bump only; full `clear()` on reset/dispose only. Units: `projectedApplyGate.unit.ts`.
- **Cold resync on armed surface** — `everArmed && resync && sequence === 1` → `recreateForGenerationAsync` (not standby async racing increments).

**Eneba lab proof (2026-08-30):** dossier `sidecar/lab-runs/2026-08-30T06-10-17-942Z-www.eneba.com` — `/br/` browse ~28 s: **0 desync**, 96 apply ok, input 44/44, wire invariants green. **Not yet proven:** `/` → `/br/` redirect gen-bump path (pre-fix storm class).

**Still open before tag (gates — see [motor-0.3.0.md](motor-0.3.0.md)):**
1. **PP-NESTED-GEN-PACK revert** — wire encoding; **before tag**, not after.
2. Eneba **`/` → `/br/`** dossier (redirect gen bump).
3. B3 dotnet test if red on `main`.
4. Full Windows gates.

**Not 0.3.0 gates:** B1 (done 2026-08-29) · B2/`managedTabId` (withdrawn) · antibot stealth · multi-session density · accept 1:1 sealed.

**Runtime inject:** unified `speculum-pp` extension + C2 + ContextBus + `initContext` ([runtime-redesign.md](runtime-redesign.md)). Stealth spike on real antibot still required before calling accept sealed.

**Input:** sparse-cdp only — `nodeId` + local % (`localX`/`localY`). Journal `intent ok:true` ≠ Virtual apply succeeded.

**Lab UI:** `cd sidecar && npm run lab:restart` (headed default via `SPECULUM_LAB_HEADED=1`) → **http://127.0.0.1:4077/**. Agent: `npm run lab:run -- …`. Do **not** use 4103 unless an old process is still bound there.

**Next ordered work (post-0.3.0 tag / M1):**
1. Canvas content projection (gate 7).
2. MotorAssert Live deep path.
3. PP-HARDNAV-PLANE-ACK · stealth spike V3 · accept oracles.

Open named shadow / form PROP / SVG / session shape / gate 10 surface / nested iframe click / extension plane / virtual assets — closed. Do **not** reopen apply honesty ([observability.md](observability.md) §7) or ad-hoc establish/sync paths ([acceptance.md](acceptance.md) T3).



If you are an agent with limited context: **read this file (including Now), then `acceptance.md`, then `open.md`, then `seal-gaps.md`, then `roadmap.md`, then only the protocol sections you are changing.** Do not open `../archive/`.

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
| Multi-document (OPEN-6, kind 2) | **[multi-document.md](multi-document.md)** — runtime implements `emitFrame`; algorithm per `window`; header `contextId` = mine; child-scope indexer; bus transport → **[context-bus.md](context-bus.md)** |
| **ContextBus** (inter-context JS transport) | **[context-bus.md](context-bus.md)** — emit/invoke; domain protocols sit on top |
| Input intents | **sparse-cdp V1 SEALED** ([input.md](input.md) 2026-08-27) — OS unified seal is historical record only; [input-v2.md](input-v2.md) superseded / purged |
| Asset serve plane | **[virtual-assets.md](virtual-assets.md)** |
| Virtual Document **CSP surgery** (cutover session) | **[csp.md](csp.md)** |
| **Loopback WS** establishment + health + mux (LB-08…19) | **[loopback.md](loopback.md)** — extends input §10.1c LB-01…07 |
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
| 8a2 | [loopback.md](loopback.md) | If touching data plane establish, handshake, reconnect, invoke gate |
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
    loopback.md             Loopback WS establish + health + mux (LB-08…19)
    browser-session.md      Session / mirror-mode contracts (SEALED)
    runtime-redesign.md     Runtime carrier redesign (SEALED 2026-08-29; cutover in tree)
    virtual-assets.md       URL serve plane
    support-matrix.md       accepted product gaps
    test-matrix.md          PP-* coverage (some rows pending V4 re-author)
    decision-log.md         append-only log (all eras, labeled)
    roadmap.md              M1/M2/M3 + cutover gates
    open.md                 bugs, OPEN-*, rulings, residuals
    motor-0.3.0.md          Motor 0.3.0 release scope + exit checklist
    seal-gaps.md            lab tracker: QA / gaps / features (independent DOM vs CSSOM)
  archive/                  DO NOT IMPLEMENT FROM
```

Code that implements V4 algorithm: `@speculum/page-projection` (`packages/page-projection` — `core` / `virtual` / `projected`).  
Sidecar callers: `lab/`, `session/`, `inject/`, CDP `input/` — [observability.md](observability.md), [lab-design.md](lab-design.md).  
Lab UI: `npm run lab:projection`. Agent: `npm run lab:run -- --blueprint soak …` → dossier dir / `verdicts.json`.  
Lab smoke: `sidecar/scripts/smoke-projection-lab.js`.  
Lab units: `sidecar/unit.ts` (includes V4 session + lab scheduler tests).

---

## What V4 is (one paragraph)

The replicated structure is a **node table** (`ReplicatedTable`), not a belief about the DOM (P0). Each tick the producer coalesces `MutationRecord`s into one **frame** of opcodes (`NODE_NEW`, `INSERT`, `REMOVE`, `ATTR_*`, `TEXT_SET`, `CHECK`, `EPOCH_RESET`, `NODE_DROP`, CSSOM ops). The client **two-phase applies**: table first (validate `preTableHash` + ops + closing `CHECK`), then materialize to the **projected iframe** (K5: CSP-hardened document — not `iframe.sandbox`; see [decision-log.md](decision-log.md) 2026-08-30). There is **no establish phase**: cold start is `resyncVirtual` (walk live DOM, fill identity map, `emitResyncFrame`). Mid-session desync is client-initiated `emitResyncFrame` into a **real double-buffer** iframe; swap after that frame’s closing `CHECK` verifies. `generation` bumps only on top-level Document replacement (`EPOCH_RESET`). Soft-nav does not bump. Resync does not bump.

---

## Anti-sources (do not design from)

- `docs/page-projection/archive/**`
- Deleted legado trees (do not reintroduce): `patchright/mirror/page/**`, `web/.../live/page/**`
- Any doc that still says establish HTML / Node mirror / `speculum-anchor` / DomMap bootstrap as the happy path
- Green protocol hops (`200`, `ResyncServed`, `htmlLen`) as accept

---

## 1:1 rule

Every behaviour change MUST update the matching live spec file in the same change set. Ad-hoc code without a doc update is a process defect. To reverse a decision, **append** a row to [decision-log.md](decision-log.md); do not edit history.
