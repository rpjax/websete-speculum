<!-- reconciled-2026-08-14; roadmap redrawn 2026-08-14 -->
> **RECONCILIATION NOTE.** The normative frame / state / wire / construction / recovery model is
> now [`frame-protocol.md`](frame-protocol.md) — **not** the `contracts/` + `implementation/`
> "buildable pack", which is historical for those layers. A table-based engine implementing
> `frame-protocol.md` now exists under `Refactor/sidecar/browser/mirror/projection/` and passes its
> own lab unit + smoke gates (Stages 1-4). **Production still runs the older
> `mirror/page/liveAttach` path** (`PatchrightBrowserSession.ts`) — the cutover has not started. The
> concrete, ordered path from here to a 100%-complete production launch is
> ["Path to M1 cutover"](#path-to-m1-cutover--ordered-gate-list) in the M1 section below; see
> [`RECONCILIATION.md`](RECONCILIATION.md) for the full findings this gate list is drawn from.

# PageProjection — work order (milestones)

**Status:** process canon — how we finish Live PageProjection.  
**Not** the accept criterion itself. Accept stays sealed in [acceptance.md](acceptance.md) (absolute 1:1 Projected ↔ Virtual).

| | |
|--|--|
| Engine (constraints) | [engine-redesign.md](engine-redesign.md) |
| **Buildable spec pack** | [README.md](README.md) — contracts + impl specs (1:1 with future code) |
| Gaps (product support) | [support-matrix.md](support-matrix.md) |
| Lab / oracles | [Refactor/page-projection-oracles/MATRIX.md](../../../Refactor/page-projection-oracles/MATRIX.md) |

**Hard ban (every milestone):** no ad-hoc, no DomMap bootstrap, no host-`if`, no soft-skip to paint green ([acceptance](acceptance.md), [AGENTS.md](../../../AGENTS.md)). Fix the designed path. **Code must match the spec pack**; any behaviour change updates the MD in the same change set.

---

## Spec-first gate (before M1 code)

| Step | Status |
|------|--------|
| Spec pack contracts + implementation MDs | **DONE** (2026-08-12) — see [REVIEW.md](REVIEW.md) |
| `spec/GAP.md` empty | **DONE** |
| Code from the pack, lab tree | **DONE** (2026-08-13/14, Stages 1-4 — see M1 status below) |
| Code from the pack, production cutover | **NOT STARTED** — see ["Path to M1 cutover"](#path-to-m1-cutover--ordered-gate-list) below |

Do **not** treat historical “M1 DONE” cutover claims as redesign-complete. Future M1 means: **code implements `docs/page-projection/spec/`, on the live path** — the lab-tree code existing and passing its own gates is necessary but not sufficient.

---

## Milestones (strict order)

Three milestones. Finish one before treating the next as the main workstream. The lab-tree implementation of the spec pack is done (Stages 1-4); **M1 overall is now blocked on the production cutover gate list, not on writing the engine.**

```text
Spec pack (done) → M1 lab engine (done) → M1 production cutover → M2 Debug → M3 Optimize / accept
```

| Milestone | One-line meaning | In scope | Out of scope |
|-----------|------------------|----------|--------------|
| **M1** Implementation completeness | Code = spec pack; cut over; no orphan dual paths | Live path per `implementation/**`, deletes, LOC, units/build | Live accept, perf campaigns |
| **M2** Debug | **Make it work** — functional bugs | Empty/unarmed surface, CSSOM missing, asset auth races, establish/resync delivery | Density/SLO tuning, declaring accept |
| **M3** Optimization / performance | **Toward accept** — budgets + oracles with real parity | E/P budgets, WP14 densify, `oracle:live` O1/O2/O5 on baseline sites | Protocol-only PASS while surface is wrong |

**Rules between milestones**

1. Do not run M3 to hide an M2 bug (e.g. “optimize” Beleza while `armed=false`).
2. Do not reopen M1 (big rewrites / dual paths) unless M2 proves a **missing designed piece** — then update **spec pack first**, then implement — never a workaround.
3. M1 **done** does **not** mean accept. M2 **done** on a site means that site is eligible for M3/accept work.

---

## M1 — Implementation completeness

**Meaning:** product code matches `docs/page-projection/spec/` (contracts + implementation MDs), wired on the live path, forbidden dual paths removed, files within §9 size ceilings. Units and builds are green.

**Does not mean:** sites look 1:1. Does not mean `oracle:live` is green.

### Exit criteria

- Live path implements in-page encode → Node rewrite/mirror → opaque API relay → client apply (D-SPEC-2)
- No JSON tree ferry on establish/live frame path
- Input resolve by `uint32` only (no Virtual `speculum-anchor` fallback)
- Defaults match §5.16 / `contracts/15-configuration.md`
- `mirror/page` (+ inpage fragments) ≤600 LOC per module map
- Sidecar + web: `npm run build` and unit tests green
- Spec MDs updated in lockstep with any behaviour change

### Status

| Item | State |
|------|--------|
| Spec pack | **DONE** |
| Code from spec pack — **lab tree** (`Refactor/sidecar/browser/mirror/projection/`) | **DONE** for the single-document core: identity/frame/wire/two-phase-apply (`frame-protocol.md` §1–§6, Stage 1), Stage 2 hardening (corrupted/hostile-frame rejection before DOM touch), Stage 3 (`EPOCH_RESET`/`NODE_DROP` GC/limits), Stage 4 (client-initiated resync recovery + real double-buffer surface). All exercised by `unit.js` + `smoke-projection-lab.js` (10/10 gates green, 2026-08-14). |
| Code wired on the **live/production path** (`PatchrightBrowserSession.ts`) | **NOT STARTED** — production still starts the legacy `LivePageProjection` (`mirror/page/liveAttach`); the lab-tree engine above is not reachable from a real session yet. This is the actual remaining M1 work, not "write the engine" (already done in lab). |
| **M1 overall** | **BLOCKED on the cutover gate list below**, not on a from-scratch code plan |

### Path to M1 cutover — ordered gate list

The lab-tree engine already proves the design works (Stages 1-4, §5/§6/§5.8 of `frame-protocol.md`). What is left before it can become *the* live path — replacing `LivePageProjection`, never running two live paths at once — is this list, roughly in dependency order. Each gate links to where it is tracked; none of them are "write it from zero," all are closing a named, already-diagnosed gap.

1. **Fix `ReplicatedTable.insertBatch`'s missing reverse link** — [`frame-protocol.md` OPEN-7](frame-protocol.md#10-open-decisions), found by the 2026-08-14 reconciliation pass ([`RECONCILIATION.md` §5](RECONCILIATION.md)). A live, silent P0 violation (`preTableHash` cannot catch it by construction) already running under the Stages 1-4 gates without tripping them — small, mechanical fix (mirror what `linkAfter` already does), but must close before this table code becomes production-authoritative.
2. **Add the §6 local oracle** — Virtual `ReplicatedTable` × Virtual's own live DOM, periodic, O(n), in-lab first ([`RECONCILIATION.md` §6](RECONCILIATION.md)). This is the only check that can catch the `insertBatch` class of bug (the wire hash structurally cannot — producer and client run identical buggy code). Confirm whether `lab/frameInvariantMonitor.ts` already has the hooks for this; if not, that is the gap. Doubles as a standing regression guard for any future derived-index bug, not a one-off check for item 1.
3. **Rule on E-03/E-08** — loopback WebSocket data channel + CSP-strip/PNA-bypass ([`RECONCILIATION.md` §4](RECONCILIATION.md), `engine-redesign-extension.md`). The lab's control channel (`PlaneChannel.Control`, used by Stage 4's resync request) only works because the lab controls both ends of a loopback connection; the decision log's own real-site probe already caught this exact approach failing against Wikipedia's `connect-src` CSP. Production needs an explicit accept-with-mitigation or reject-in-favour-of-the-§5.7-binding-channel ruling **before** the resync control path (item 5 below) can be built for real sites, not just the lab's own Chromium instance.
4. **Decide the `contracts/` pack's fate** — archive vs. delete `contracts/03-frame.md` + `contracts/07-recovery.md` (fully dead, absorbed by `frame-protocol.md` §5/§5.8) and the rest of the historical buildable pack ([`RECONCILIATION.md` §4](RECONCILIATION.md)). Process hygiene, not a blocker for code, but should not linger past cutover — a reader hitting the old pack after cutover and building from it would be a real regression risk.
5. **Production Integration** — wire the lab-tree engine as `PatchrightBrowserSession.ts`'s live path, replacing `LivePageProjection`/`mirror/page/liveAttach` outright (never two live paths — delete the loser same-day, do not flag it for later). Concretely: the client double buffer (`client/surface.ts`) needs a home in the real `web/` frontend, not just the lab's static HTML shell; the resync control channel needs the production binding (item 3's ruling) in place of `PlaneChannel.Control`'s lab-only loopback; `Speculum.MotorAssert.Tests` needs PageProjection coverage on the live path (today only the lab's own `unit.js`/smoke suite exercise it). This is the milestone tracked elsewhere in this repo's decision log as "Production Integration" — it is the one item that actually satisfies M1's own exit criteria above, since those describe the *live* path, not the lab's.
6. **Test-matrix re-authoring** — `test-matrix.md`'s `PP-EST-1..7` / `PP-REC-2/3` rows still describe establish/Node-mirror; rewrite against opcodes + the resync `CHECK` (`frame-protocol.md` §5.8 residual follow-up). Should land before or alongside item 5, so cutover has real `PP-*` coverage truth from day one instead of stale rows.
7. **Synchronous-walk budget** — put a number on one-off bulk `resyncVirtual` latency at `MAX_ROWS` scale (`frame-protocol.md` §5.8 "Atomicity", no `E`-number covers it today). Needed before any baseline site with a large enough table could plausibly hit a mid-session `resyncVirtual` in production (`emitResyncFrame`-only recovery, Stage 4's actual choice, does not walk the DOM and is not gated by this — this is specifically about the `resyncVirtual` primitive: bootstrap/cold-start, and any future decision to widen mid-session recovery to it).
8. **OPEN-6 (multi-document/nested-documents)** — deliberately deferred, not a cutover blocker for DOM-only, single-document sites (`frame-protocol.md` OPEN-6 itself says "revisit before pierce/CSSOM/iframe fixtures are added — not before"). Relevant the moment a baseline/target site relies on a pierced cross-origin iframe for its own content, not before.

Items 1-2 are pure correctness (fix a live bug, then make sure nothing like it can hide again); 3-4 are rulings/hygiene; 5-7 are the actual cutover work; 8 stays pinned until a real site needs it.

---

## M2 — Debug (make it work)

**Meaning:** on real sites, Projected becomes a working mirror of Virtual — arms, paints, styles, assets, keeps syncing. This milestone is **bugs only**.

**Does not mean:** pixel/oracle accept, density at 100 sessions, or polish.

### What counts as an M2 bug

- Projected empty / never arms while Virtual is healthy
- CSSOM missing → black or unstyled shell while Virtual is styled
- Systematic broken images from auth/stamp races (not random CDN flake)
- Establish or resync that never delivers a usable document to the client

### What does *not* belong in M2

- Raising MirrorMaxBytes / rate knobs “to get O1 green” while establish is broken
- Declaring PASS from `ResyncServed` / `htmlLen` / `200` alone
- L2/E8 densify, WP14 calibration campaigns
- Reintroducing JSON ferry or other banned paths

### Bug queue

Reset when M1 code lands. Prior lab notes remain historical evidence only.

### M2 exit (per site)

Under the normal lab stack, for that site:

1. Projected **arms** with real document content (not protocol theater).
2. When Virtual has styles, Projected is not left black/unstyled from missing CSSOM apply.
3. No systematic broken imgs from our auth/race path.
4. Live diffs / soft-nav do not leave a permanently empty surface.

---

## M3 — Optimization / performance → accept

**Meaning:** with a working surface (M2), push budgets, density, and live oracles until Projected is honestly 1:1 with Virtual on baseline sites.

### Baseline accept targets

- `www.belezanaweb.com.br`
- Eneba (including soft-nav)
- live-odds (`SPECULUM_LIVE_ODDS_URL`) when set

### M3 exit

- Live O1 + O2 + O5 (+ ASSET where applicable) green on the baseline set **with** usable 1:1 parity — not protocol-only.
- MATRIX updated with measured knobs / density outcome.

### Status

**Blocked** until M1 code + M2 on baseline hosts.

---

## Current position

| Milestone | Status |
|-----------|--------|
| Spec pack (docs) | **DONE** (2026-08-12) |
| **M1** Implementation completeness — lab-tree engine | **DONE** for the single-document core (Stages 1-4, 2026-08-13/14 — see `frame-protocol.md` decision log) |
| **M1** Implementation completeness — production cutover | **NOT STARTED** — see ["Path to M1 cutover" gate list](#path-to-m1-cutover--ordered-gate-list) above (8 items, 1 already a confirmed live bug: `frame-protocol.md` OPEN-7) |
| **M2** Debug | Blocked on M1 cutover |
| **M3** Optimization → accept | Blocked on M2 |

**One-paragraph summary for anyone jumping in:** the frame/replicated-state/wire/recovery redesign in `frame-protocol.md` is implemented and self-consistent — a full lab engine (identity table, binary frames, two-phase apply, `EPOCH_RESET`, `NODE_DROP` GC, client-initiated resync with a real double-buffer surface) exists under `Refactor/sidecar/browser/mirror/projection/` and passes its own unit + smoke gates. **None of it is live yet** — `PatchrightBrowserSession.ts` still runs the old `LivePageProjection` path. The road to "100% production launch" is the 8-item gate list above, then M2 (make it work on real sites) and M3 (push to honest 1:1 parity on the baseline set) exactly as already scoped below.

---

## Links

| Doc | Role |
|-----|------|
| [acceptance.md](acceptance.md) | Absolute accept / anti-protocol-PASS |
| [engine-redesign.md](engine-redesign.md) | Normative engine constraints (§5–§10) |
| [spec pack](README.md) | **Buildable** contracts + impl specs |
| [support-matrix.md](support-matrix.md) | Accepted gaps (K1/K5) |
| [MATRIX.md](../../../Refactor/page-projection-oracles/MATRIX.md) | Lab coverage truth |
