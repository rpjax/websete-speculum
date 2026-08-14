# PageProjection — roadmap and milestones (V4)

**Status:** process canon — how we finish Live PageProjection.  
**Not** the accept criterion. Accept stays [acceptance.md](acceptance.md).  
**Open work:** [open.md](open.md).

```text
V4 lab (DOM table, single document, no production)
  → product-complete in lab (CSSOM + nested/multidocs + redesigned input)
    → M1 production cutover (only then)
      → M2 Debug on real sites
        → M3 Optimize / honest 1:1 accept
```

**Production cutover law (2026-08-14, Rodrigo):** Live is **not** switched until the **full product** exists in the V4 engine — including **CSSOM**, **nested / multi-document** (OPEN-6), and **input redesigned** (current [input.md](input.md) is the V1 contract; it needs a redesign pass, not T11 rename-only). A DOM-only, single-document, no-input lab is **not** M1. Do not cut over a subset and “finish CSSOM/iframes/input in M2.”

**`V4ProjectionBrowserSession` (2026-08-14):** lab-only **stand-in** for the live `BrowserSession`. At cutover it **replaces** `PatchrightBrowserSession` (that name may go away; one Chromium path). The class is **temporary**; the **contract is not**. It MUST implement every capability `BrowserSession` already exposes for Live (input, cookies, eval, resize, permissions, probes, …) **in V4 terms** — not by keeping `LivePageProjection` / DomMap. Incomplete stubs fail cutover. Not “preserve legado”; **não chegar incompleto**.

**Hard ban every milestone:** no ad-hoc, no DomMap bootstrap, no second path, no protocol-only PASS.

---

## Current position (2026-08-14)

| Piece | Status |
|-------|--------|
| V4 protocol spec | **In force** — [frame-protocol.md](frame-protocol.md) |
| Lab engine `Refactor/sidecar/browser/mirror/projection/` | **DONE** for **DOM table, single document**, Stages 1–4. Caller of `V4ProjectionBrowserSession` (**temporary** until cutover; must become a **complete** `BrowserSession`, not a lab subset). CLI `--iso`: O2 local + Node table×table. Phase 2 DOM apply / tree×tree = lab UI. **Not** CSSOM, **not** OPEN-6, **not** input. |
| Production path `PatchrightBrowserSession.ts` | **Legacy** `LivePageProjection` — **must stay** until the cutover law above is met |
| M1 overall | **Blocked** on product-complete lab (CSSOM + OPEN-6 + input redesign) **then** Production Integration |
| M2 / M3 | Blocked on M1 cutover |

---

## Path to M1 cutover (ordered)

Lab DOM-table core is **not** a cutover license. Close the **product** before switching Live.

| # | Gate | Kind | Blocker? | Detail |
|---|------|------|----------|--------|
| 1 | OPEN-7 `insertBatch` reverse link | BUG | **DONE** | `unit.ts` `testReplicatedTableInsertBeforeNextSiblingRepair`. |
| 2 | O2 local: Virtual table × Virtual live DOM (+ `takeRecords`, OPEN-8) | O2 | **DONE** for DOM table | CLI `--iso` + Node table×table. Tree×tree = lab UI phase 2, still open. |
| 3 | **CSSOM plane in the V4 engine** | Product | **YES** | [cssom.md](cssom.md) is sealed **design**. Cutover requires implemented sheet/rule rows, materialize, anti-flicker — not “DOM-only Live.” |
| 4 | **OPEN-6 nested / multi-document** | Product | **YES** | Per-document streams. **Not** pinned past cutover. Lab may stay single-doc until this gate. |
| 5 | **Input redesign** | Product | **YES** | [input.md](input.md) V1 contract is **not** sufficient to ship. Redesign, then implement. Rename-only (T11) is not the gate. |
| 6 | Rule E-03 / E-08 | RULING | **DECIDED** | **Reject CSP/PNA punch.** Do not rewrite `connect-src`/`script-src` to `*` to unblock loopback WS — that *is* an antibot signal. Page must not `connect()` for frames. Next: CDP/hub data plane (page CSP unchanged). Lab WS = synthetic fixtures only. |
| 7 | Archive pack fate | Hygiene | No | Already under `archive/`. |
| 8 | **Production Integration** | M1 exit | **YES** — **last** | Only after 3–6 **and** a complete `BrowserSession` (see V4 session law). Wire V4 as the **only** live path; **delete** `LivePageProjection` / dual factory the same day. `web/` two-phase apply (DOM+CSSOM); MotorAssert on that path. |
| 9 | Test-matrix / MotorAssert vs opcodes | Tests | With 8 | [test-matrix.md](test-matrix.md) |
| 10 | `resyncVirtual` walk budget at `MAX_ROWS` | Budget | Before huge-table walk rebuild | Mid-session recovery today is `emitResyncFrame` only. |

1–2 lab DOM table; 3–5 **product completeness** (cutover law); 6–7 rulings/hygiene; 8–10 switch Live.

---

## M1 — Implementation completeness

**Means:** the **full** V4 product is the **only** live path (DOM + CSSOM + nested docs + redesigned input); dual paths gone; units/builds green; specs match behaviour.  
**Does not mean:** sites already look 1:1 (that is M3). **Does not mean:** lab DOM-table Stages 1–4.

Exit:

- Live path: in-page encode → opaque relay → client two-phase apply for **DOM and CSSOM**
- Nested/multi-document protocol (OPEN-6) on that path
- Redesigned input implemented (not the unrevised V1 `input.md` as-is)
- No JSON tree ferry on the frame path
- Sidecar composition: one factory — the V4 `BrowserSession` covering the **full** [BrowserSession](../../../Refactor/sidecar/browser/BrowserSession.ts) surface (not a projection-only subset)
- Spec MDs updated in lockstep

---

## M2 — Debug (make it work)

**Bugs only** on real sites after cutover. Queue resets at cutover; prior hopdiag notes are historical.

Counts as M2: empty/unarmed surface, systematic broken imgs, resync that does not deliver a usable document, site bugs **after** CSSOM/nested/input already shipped. Missing CSSOM / missing OPEN-6 / unrevised input are **M1 blockers**, not M2 tickets.  
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
| 4 | Client `requestResync` → producer `emitResyncFrame` halt-in-emitter → standby iframe → swap on CHECK; bounded retry |
| Lab-as-caller | `V4ProjectionBrowserSession` owns Patchright/inject/dataplane/probes; `LabSession` + `lab:run` compose `report.json` |
| Coherent iso | `flushAndSnapshot` one JS turn; O2 + table digest + tree bound to sequence S; events not used as table asserts |

Code: `Refactor/sidecar/browser/mirror/projection/`. Observability rules: [observability.md](observability.md).
