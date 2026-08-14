# PageProjection — roadmap and milestones (V4)

**Status:** process canon — how we finish Live PageProjection.  
**Not** the accept criterion. Accept stays [acceptance.md](acceptance.md).  
**Open work:** [open.md](open.md).

```text
V4 spec + lab engine (DONE)
  → M1 production cutover (NOT STARTED — gates below)
    → M2 Debug on real sites
      → M3 Optimize / honest 1:1 accept
```

**Hard ban every milestone:** no ad-hoc, no DomMap bootstrap, no second path, no protocol-only PASS.

---

## Current position (2026-08-14)

| Piece | Status |
|-------|--------|
| V4 protocol spec | **In force** — [frame-protocol.md](frame-protocol.md) |
| Lab engine `Refactor/sidecar/browser/mirror/projection/` | **DONE** single-document core Stages 1–4. Lab **caller** of `V4ProjectionBrowserSession` (no second Chromium). Coherent snapshot probe + CLI `lab:run` / `report.json` — [observability.md](observability.md). Units include `v4ProjectionSession.unit.ts`. Smoke still in `smoke-projection-lab.js` |
| Production path `PatchrightBrowserSession.ts` | **Legacy** `LivePageProjection` / `mirror/page/liveAttach` — **not** V4 |
| M1 overall | **Blocked on cutover gates**, not on writing the engine |
| M2 / M3 | Blocked on M1 cutover |

---

## Path to M1 cutover (ordered)

None of these is “write the engine from zero.” Close named gaps.

| # | Gate | Kind | Blocker? | Detail |
|---|------|------|----------|--------|
| 1 | Fix OPEN-7 `insertBatch` reverse link | BUG | **DONE** | `insertBatch` sets `nextSiblingOf[last] = before`; `testReplicatedTableInsertBeforeNextSiblingRepair` in `unit.ts`. |
| 2 | Local oracle: Virtual `ReplicatedTable` × Virtual live DOM | O2 gap | **DONE** | `compareTableToLiveDom` + `requestTableLiveOracle` + unit + smoke on `insert-before-remove.html`. `FrameInvariantMonitor` not extended (wire-only; a second shadow would not catch OPEN-7-class derived-index bugs). |
| 3 | Rule E-03 / E-08 | RULING | **YES** for real-site control channel | Loopback WS dies on CSP `connect-src`. Do not copy lab `PlaneChannel.Control` into production without a ruling. |
| 4 | Archive pack fate | Hygiene | No | Historical contracts already under `archive/`. |
| 5 | **Production Integration** | M1 exit | **YES** | Wire V4 as the live path; **delete** `LivePageProjection` the same day (never two live paths). Client double buffer in real `web/`; resync control = whatever gate 3 decided; MotorAssert coverage on live path. |
| 6 | Test-matrix / MotorAssert rows vs opcodes | Tests | Prefer with 5 | [test-matrix.md](test-matrix.md) |
| 7 | `resyncVirtual` walk budget at `MAX_ROWS` | Budget | Before huge-table walk rebuild | Mid-session recovery today is `emitResyncFrame` only (no walk). |
| 8 | OPEN-6 multi-document | PINNED | No for single-doc sites | Before iframe-heavy baseline sites. |

1–2 correctness; 3–4 rulings/hygiene; 5–7 cutover; 8 pinned.

---

## M1 — Implementation completeness

**Means:** V4 is the **only** live path; dual paths gone; units/builds green; specs match behaviour.  
**Does not mean:** sites look 1:1.

Exit (adapted to V4):

- Live path: in-page encode → opaque relay → client two-phase apply
- No JSON tree ferry on the frame path
- Input resolve by `uint32` only (no Virtual `speculum-anchor`)
- Sidecar + web build + units green
- Spec MDs updated in lockstep

---

## M2 — Debug (make it work)

**Bugs only** on real sites after cutover. Queue resets at cutover; prior hopdiag notes are historical.

Counts as M2: empty/unarmed surface, missing CSSOM, systematic broken imgs, resync that does not deliver a usable document.  
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
