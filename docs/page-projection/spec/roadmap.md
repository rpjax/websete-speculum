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

**Production cutover law (2026-08-14, Rodrigo; canvas 2026-08-16; subtrees 2026-08-18):** Live is **not** switched until the **full product** exists in the V4 engine — including **CSSOM**, **shadow**, **nested / multi-document** (OPEN-6), **input redesigned** (current [input.md](input.md) is the V1 contract; it needs a redesign pass, not T11 rename-only), and **`<canvas>` content projection** (last product feature before Integration — not a seal-gap row; see gate below). A DOM-only, single-document, no-input lab is **not** M1. Do not cut over a subset and “finish CSSOM/iframes/input/canvas in M2.”

**`PageProjectionBrowserSession` (contract SEALED 2026-08-21):** normative port is [browser-session.md](browser-session.md) — `IBrowserSession` + `IPageProjectionBrowserSession` (+ video sibling). Lab still runs `V4ProjectionBrowserSession` until the rename/impl wave. At cutover that class **is** the Live PP session (replaces `PatchrightBrowserSession` + `LivePageProjection` the same day). It MUST cover the sealed surface (input, cookies, eval, resize, permissions, sinks, `requestResync`, lab probes, …) **in V4 terms** — not by keeping DomMap. Incomplete stubs fail cutover. Not “preserve legado”; **não chegar incompleto**.

**Hard ban every milestone:** no ad-hoc, no DomMap bootstrap, no second path, no protocol-only PASS.

---

## Current position (2026-08-21)

| Piece | Status |
|-------|--------|
| V4 protocol spec | **In force** — [frame-protocol.md](frame-protocol.md) |
| Session / mirror contracts | **SEALED** — [browser-session.md](browser-session.md) |
| V4 algorithm `Refactor/packages/page-projection` + sidecar callers | **Lab:** DOM table, shadow, CSSOM poll+apply (**same instance loop** in root + nested SO), form `PROP_SET`, nested iframe (OPEN-6), observability, resync, **Input V2** ([input-v2.md](input-v2.md)). **Not** canvas, XO/NIT flavours. **Not** production. |
| Lab host/UI | **Shipped** 2026-08-16 — [lab-design.md](lab-design.md). UI **http://127.0.0.1:4077/**. Stream tab: per-`contextId` metrics. |
| Production path `PatchrightBrowserSession.ts` | **Legacy** `LivePageProjection` — **must stay** until cutover law met |
| M1 overall | **Blocked** on canvas + Integration (input lab gate closed; session **shape** sealed — impl incomplete) |
| M2 / M3 | Blocked on M1 cutover |

### Completeness (honest, 2026-08-20)

**Do not mix these lenses.** Algorithm = same code per context. Cutover = ship Live + delete legado.

| Lens | ~% | What counts |
|------|-----|-------------|
| **V4 core algorithm (lab)** | **~95%** | Shipped ISA complete (§4 lacre). One bootstrap × N contexts: DOM, CSSOM, shadow, PROP_SET, OPEN-6 SO, resync, **Input V2 lab**. Open: canvas, scale (perf), CSS paint iso probe, XO/NIT context types. |
| **Lab QA / asserts** | **~75%** | DOM/cssom foundation + nested DOM iso + input blueprints shipped. Open: explicit nested `cssomO2` in blueprint, remaining matrix rows. |
| **Production cutover** | **~55%** | Live path still `LivePageProjection`. Needs: wire V4 as only path, canvas content, full sealed session ([browser-session.md](browser-session.md)). MotorAssert on Live is **cutover work** (gate 10), not a lab/dev gate. Input **lab** done — prod wire already carries `contextId`. Session **shape** sealed 2026-08-21; impl incomplete. |

**Cutover gates (product, not “another CSSOM algorithm”):**

| Gate | Weight | Status |
|------|--------|--------|
| 1–2 Lab DOM + O2 | 15% | **Done** |
| 3 CSSOM on **live path** | 15% | **0%** — lab algorithm done; prod not wired |
| 4 Shadow on live path | 10% | **0%** prod · **Done** lab |
| 5 OPEN-6 SO lab + XO NIT | 15% | **~85%** lab SO · XO NIT |
| 6 Input redesign | 15% | **Done lab** — [input-v2.md](input-v2.md); touch/OS pointer **out of scope** (Projected is local/native) |
| 6.5 Shared TS package | hygiene | **Done 2026-08-20** — `@speculum/page-projection` (`core`/`virtual`/`projected`); amends E-11; **before** canvas; ≠ gate 10 |
| 7 Canvas content | 10% | **0%** — ships into the shared package after 6.5 |
| 10 Production Integration | 20% | **0%** — `web/` consumes `/projected`+`/core`; delete legado same day |

---

## Path to M1 cutover (ordered)

Lab DOM-table core is **not** a cutover license. Close the **product** before switching Live.

| # | Gate | Kind | Blocker? | Detail |
|---|------|------|----------|--------|
| 1 | OPEN-7 `insertBatch` reverse link | BUG | **DONE** | `unit.ts` `testReplicatedTableInsertBeforeNextSiblingRepair`. |
| 2 | O2 local: Virtual table × Virtual live DOM (+ `takeRecords`, OPEN-8) | O2 | **DONE** for DOM table | CLI `--iso` + Node table×table. Tree×tree = lab UI with DOM client (human OK 2026-08-17 on `apply-attrs` / `soak`). |
| 3 | **CSSOM plane in the V4 engine** | Product | **YES** for Live | Lab: constructed adopted + `CSSStyleRule` shipped. Cutover still needs the **full** plane on the live path ([cssom.md](cssom.md)) — not “DOM-only Live.” |
| 4 | **Shadow DOM** | Product | **DONE** open/named | Feature 1 of [subtrees.md](subtrees.md). Lab `shadow-open`. Closed/manual NIT. Spec: [shadow.md](shadow.md). **Before** OPEN-6. |
| 5 | **OPEN-6 nested browsing contexts** | Product | **PARTIAL** | Lab same-origin iframe + observability + resync shipped. **CSSOM = same algorithm per nested instance** — not a separate build. XO / srcdoc / sandbox / fenced NIT. Optional: nested `cssomO2` lab assert ([seal-gaps.md](seal-gaps.md) `SEAL-CSSOM-P2-NESTED-QA`). |
| 6 | **Input redesign** | Product | **DONE lab 2026-08-20** | [input-v2.md](input-v2.md) normative. Lab blueprints M1a–M1d + scroll matrix. Prod hub/gRPC/`web` carry `contextId`. **Touch / OS pointer intents not required** — Projected runs local on the device; native touch UX. MotorAssert on Live is **cutover** (gate 10), not remaining input development. |
| 6.5 | **Shared `@speculum/page-projection` package** | Hygiene | **DONE 2026-08-20** | Extract `core`/`virtual`/`projected` to `Refactor/packages/page-projection`. Lab/session stay callers. Amends E-11 ([decision-log.md](decision-log.md) §J). **Not** Integration — gate 10 consumes the package. |
| 7 | **`<canvas>` projection** | Product | **YES** — **last feature before Integration** | Project canvas **bitmap/content** (not element-only / not placeholder-forever). Design + implement + effect asserts before gate 10. Ships **into** the shared package after 6.5. Until then: box + `CANVAS_PLACEHOLDER` only ([support-matrix.md](support-matrix.md)). **Not** a [seal-gaps.md](seal-gaps.md) row. |
| 8 | Rule E-03 / E-08 | RULING | **DECIDED** | **Reject CSP/PNA punch.** Do not rewrite `connect-src`/`script-src` to `*` to unblock loopback WS — that *is* an antibot signal. Page must not `connect()` for frames. Next: CDP/hub data plane (page CSP unchanged). Lab WS = synthetic fixtures only. |
| 9 | Archive pack fate | Hygiene | No | Already under `archive/`. |
| 10 | **Production Integration** | M1 exit / **cutover** | **YES** — **last** | Only after 3–8 **and** a complete PP session per [browser-session.md](browser-session.md). Wire V4 as the **only** live path; **delete** `LivePageProjection` / dual factory the same day. `web/` two-phase apply (DOM+CSSOM). **MotorAssert on Live belongs here** — cutover proof, not feature development. |
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
- Redesigned input implemented ([input-v2.md](input-v2.md) — lab closed; Live MotorAssert is cutover / gate 10)
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

Code: `Refactor/sidecar/browser/mirror/projection/`. Observability rules: [observability.md](observability.md).
