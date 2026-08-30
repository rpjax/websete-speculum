# PageProjection — roadmap and milestones (V4)

**Status:** process canon — how we finish Live PageProjection.  
**Not** the accept criterion. Accept stays [acceptance.md](acceptance.md).  
**Open work:** [open.md](open.md).

```text
V4 lab (DOM table, single document, no production)
  → product-complete in lab (CSSOM + shadow + nested/multidocs + redesigned input)
    → canvas projection (last product feature)
      → M1 production cutover (only then)
        → M2 Debug on real sites
          → M3 Optimize / honest 1:1 accept
```

**Production cutover law (2026-08-14, Rodrigo; canvas 2026-08-16; subtrees 2026-08-18):** Live is **not** switched until the **full product** exists in the V4 engine — including **CSSOM**, **shadow**, **nested / multi-document** (OPEN-6), **OS unified input** ([input.md](input.md); Mode A/B CDP purged), and **`<canvas>` content projection** (last product feature before Integration — not a seal-gap row; see gate below). A DOM-only, single-document, no-input lab is **not** M1. Do not cut over a subset and “finish CSSOM/iframes/input/canvas in M2.”

**`PageProjectionBrowserSession` (contract SEALED + shape cutover 2026-08-21):** normative port is [browser-session.md](browser-session.md). Live PP launches via `createSealedBrowserSessionFactory` → `PageProjectionBrowserSession`; video → `VideoStreamingBrowserSession`. `LivePageProjection` deleted. Session **must** keep covering the sealed surface in V4 terms — not DomMap. Product gaps (canvas, antibot, asset store) remain; they do **not** re-open the legado page-mirror path.

**Hard ban every milestone:** no ad-hoc, no DomMap bootstrap, no second path, no protocol-only PASS.

---

## Current position (2026-08-30)

| Piece | Status |
|-------|--------|
| V4 protocol spec | **In force** — [frame-protocol.md](frame-protocol.md) |
| Session / mirror contracts | **SEALED + shape cutover** — [browser-session.md](browser-session.md); factory + PP class on Live |
| V4 algorithm `packages/page-projection` + sidecar callers | **Lab + Live session path:** DOM table, shadow, CSSOM poll+apply (**same instance loop** in root + nested SO), form `PROP_SET`, nested iframe (OPEN-6), observability, resync, **sparse-cdp input**. **Apply gate** shipped 2026-08-30. **Not** canvas, XO/NIT flavours. **`web/` on `@speculum/page-projection/projected`** (gate 10 surface). |
| Lab host/UI | **Shipped** — [lab-design.md](lab-design.md). UI **http://127.0.0.1:4077/**. CPU profile probe in dossier. |
| Production session path | **PP sealed factory** — `mirrorMode=pageProjection` → `PageProjectionBrowserSession`. Video = `VideoStreamingBrowserSession`. |
| **Motor 0.3.0** | **In progress** — [motor-0.3.0.md](motor-0.3.0.md). PP lab-proven Eneba browse; not M1 accept. |
| M1 overall | **Blocked** on canvas (gate 7) + formal accept oracles |
| M2 / M3 | Blocked on M1 cutover |

### Completeness (honest, 2026-08-30)

**Do not mix these lenses.** Algorithm = same code per context. Contract shape cutover ≠ product-complete M1. Motor 0.3.0 ≠ M1.

| Lens | ~% | What counts |
|------|-----|-------------|
| **V4 core algorithm (lab)** | **~95%** | Shipped ISA complete (§4 lacre). DOM, CSSOM, shadow, PROP_SET, OPEN-6 SO, resync, sparse-cdp input, apply gate. Open: canvas, XO/NIT, SW mint revert (PP-NESTED-GEN-PACK). |
| **Lab QA / asserts** | **~78%** | Eneba `/br/` browse green (protocol + input); wire invariants. Open: redirect path re-proof, widget parity on browse, nested `cssomO2` blueprint. |
| **Session contract / Live path** | **~90% shape** | Sealed factory + `PageProjectionBrowserSession`. Open: antibot kits, asset store, frame-queue backpressure. |
| **Production cutover (M1 exit)** | **~78%** | Session path + web surface. Still needs: canvas (gate 7), MotorAssert Live E2E, accept oracles. |
| **Performance (E6 budget)** | **OK on Eneba browse** | Instrumented algo ~2.5% wall; CPU profile our-code ~1% wall (dossier 2026-08-30). Not adversarial prepend-stress ceiling. |

**Cutover gates (product, not “another CSSOM algorithm”):**

| Gate | Weight | Status |
|------|--------|--------|
| 1–2 Lab DOM + O2 | 15% | **Done** |
| 3 CSSOM on **live path** | 15% | **0%** — lab algorithm done; prod not wired |
| 4 Shadow on live path | 10% | **0%** prod · **Done** lab |
| 5 OPEN-6 SO lab + XO NIT | 15% | **~85%** lab SO · XO NIT |
| 6 Input redesign | 15% | **sparse-cdp only** 2026-08-27 — OS ABS deleted; [input.md](input.md) |
| 6.5 Shared TS package | hygiene | **Done 2026-08-20** — `@speculum/page-projection` (`core`/`virtual`/`projected`); amends E-11; **before** canvas; ≠ gate 10 |
| 7 Canvas content | 10% | **0%** — ships into the shared package after 6.5 |
| 10 Production Integration | 20% | **Done surface 2026-08-22** — web package + Frames; canvas still blocks full M1 |

---

## Path to M1 cutover (ordered)

Lab DOM-table core is **not** a cutover license. Close the **product** before switching Live.

| # | Gate | Kind | Blocker? | Detail |
|---|------|------|----------|--------|
| 1 | OPEN-7 `insertBatch` reverse link | BUG | **DONE** | `unit.ts` `testReplicatedTableInsertBeforeNextSiblingRepair`. |
| 2 | O2 local: Virtual table × Virtual live DOM (+ `takeRecords`, OPEN-8) | O2 | **DONE** for DOM table | CLI `--iso` + Node table×table. Tree×tree = lab UI with DOM client (human OK 2026-08-17 on `apply-attrs` / `soak`). |
| 3 | **CSSOM plane in the V4 engine** | Product | **YES** for accept | Algorithm on PP session path. Gate remaining = **web/** apply + surface accept — not DomMap. |
| 4 | **Shadow DOM** | Product | **DONE** open/named | Feature 1 of [subtrees.md](subtrees.md). Lab `shadow-open`. Closed/manual NIT. Spec: [shadow.md](shadow.md). **Before** OPEN-6. |
| 5 | **OPEN-6 nested browsing contexts** | Product | **PARTIAL** | Lab same-origin iframe + observability + resync shipped. **CSSOM = same algorithm per nested instance** — not a separate build. XO / srcdoc / sandbox / fenced NIT. Optional: nested `cssomO2` lab assert ([seal-gaps.md](seal-gaps.md) `SEAL-CSSOM-P2-NESTED-QA`). |
| 6 | **Input redesign** | Product | **sparse-cdp only 2026-08-27** | Hot path: UnifiedIntent → EventApplier → CDP (id-addressed click) + scrollSet. OS ABS/S6 removed from codebase ([input.md](input.md) historical). Mode A/B CDP **purged**. Live MotorAssert intents = cutover / gate 10. |
| 6.5 | **Shared `@speculum/page-projection` package** | Hygiene | **DONE 2026-08-20** | Extract `core`/`virtual`/`projected` to `packages/page-projection`. Lab/session stay callers. Amends E-11 ([decision-log.md](decision-log.md) §J). **Not** Integration — gate 10 consumes the package. |
| 6.6 | **Sealed BrowserSession path** | Hygiene / path | **DONE 2026-08-21** | `PageProjectionBrowserSession` + sealed factory; `LivePageProjection` deleted; `RequestResync` only. Scratchpad: [../CUTOVER-WORKSPACE.md](../CUTOVER-WORKSPACE.md). |
| 7 | **`<canvas>` projection** | Product | **YES** — **last feature before Integration** | Project canvas **bitmap/content** (not element-only / not placeholder-forever). Design + implement + effect asserts before gate 10. Ships **into** the shared package after 6.5. Until then: box + `CANVAS_PLACEHOLDER` only ([support-matrix.md](support-matrix.md)). **Not** a [seal-gaps.md](seal-gaps.md) row. |
| 8 | Rule E-03 / E-08 | RULING | **REVISED 2026-08-26** | Sole PP data plane = page loopback WS (`projectionDataPlane: 'loopback'` only). CDP exposeBinding plane purged. Surgical CSP Document surgery stays ([csp.md](csp.md)). |
| 9 | Archive pack fate | Hygiene | No | Already under `archive/`. |
| 10 | **Production Integration** | M1 exit / **cutover** | **DONE surface 2026-08-22** | `web/` → `@speculum/page-projection/projected`; legado `live/page` deleted; resync trigger-only; Sessions.Tests `PP-LIVE-*`. Canvas (gate 7) still required for full M1 accept. |
| 11 | Test-matrix / MotorAssert vs opcodes | Tests | With 10 | [test-matrix.md](test-matrix.md) |
| 12 | `resyncVirtual` walk budget at `MAX_ROWS` | Budget | Before huge-table walk rebuild | Mid-session recovery today is `emitResyncFrame` only. |

1–2 lab DOM table; 3–7 **product completeness** (cutover law; canvas = last feature); 8–9 rulings/hygiene; 10–12 switch Live.

---

## M1 — Implementation completeness

**Means:** the **full** V4 product is the **only** live path (DOM + CSSOM + shadow + nested docs + redesigned input + **canvas content projection**); dual paths gone; units/builds green; specs match behaviour.  
**Does not mean:** sites already look 1:1 (that is M3). **Does not mean:** lab DOM-table Stages 1–4.

Exit:

- Live path: in-page encode → opaque relay → client two-phase apply for **DOM and CSSOM**
- Shadow walk (same instance) on that path
- Nested/multi-document protocol (OPEN-6) on that path
- Redesigned input implemented ([input.md](input.md) OS unified; [input-v2.md](input-v2.md) superseded; lab + unit; Live MotorAssert is cutover / gate 10)
- Canvas bitmap/content projection implemented (gate 7) — not placeholder-only forever
- No JSON tree ferry on the frame path
- Sidecar composition: one factory per [browser-session.md](browser-session.md) — `createPageProjection` / `createVideoStreaming` binding sink + permission host; PP class covers the **full** sealed surface (not a projection-only subset)
- Spec MDs updated in lockstep

---

## M2 — Debug (make it work)

**Bugs only** on real sites after cutover. Queue resets at cutover; prior hopdiag notes are historical.

Counts as M2: empty/unarmed surface, systematic broken imgs, resync that does not deliver a usable document, site bugs **after** CSSOM/nested/input/canvas already shipped. Missing CSSOM / missing OPEN-6 / unrevised input / missing canvas projection are **M1 blockers**, not M2 tickets.  
Does not: raising knobs to green O1, protocol-only PASS, densify campaigns, reintroducing banned paths.

Per-site exit: arms with real content; not black/unstyled when Virtual is styled; no systematic auth/asset races; live diffs / soft-nav do not leave an empty surface.

---

## M3 — Optimization → accept

Baseline: `www.belezanaweb.com.br`, Eneba (soft-nav), live-odds when set.  
Exit: live O1+O2+O5 (+ ASSET) **with** usable 1:1 parity — not protocol-only. MATRIX updated with measured knobs.

Do not run M3 to hide an M2 bug.

---

## Lab stages already shipped (do not redo)

| Stage | What |
|-------|------|
| 1 | Identity map, `ReplicatedTable`, binary frame, two-phase apply, producer tick |
| 2 | `preTableHash` / `CHECK` / limits; hostile/corrupted frame aborts before DOM |
| 3 | `EPOCH_RESET`, `NODE_DROP` GC, MAX_* |
| Stage 4 | Client `requestResync` → Control plane `requestResync` → `publishResyncRequest` → producer `emitResyncFrame`; root + nested Projected double-buffer + bounded retry |
| Lab-as-caller | PP session owns Patchright/inject/dataplane/probes ([browser-session.md](browser-session.md)); `LabSession` + `lab:run` compose `report.json` |
| Coherent iso | `flushAndSnapshot` one JS turn; O2 + table digest + tree bound to sequence S; events not used as table asserts |

Code: `sidecar/browser/mirror/projection/`. Observability rules: [observability.md](observability.md).
