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
| Separate plan to implement code from the pack | **NOT STARTED** — required before writing product code |

Do **not** treat historical “M1 DONE” cutover claims as redesign-complete. Future M1 means: **code implements `docs/page-projection/spec/`**.

---

## Milestones (strict order)

Three milestones. Finish one before treating the next as the main workstream. **Blocked until a code-implementation plan executes the spec pack.**

```text
Spec pack (done) → M1 code from specs → M2 Debug → M3 Optimize / accept
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
| Code from spec pack | **NOT STARTED** (separate plan) |
| **M1 overall** | **BLOCKED on code plan** |

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
| **M1** Implementation completeness | **BLOCKED** — needs separate code plan from spec pack |
| **M2** Debug | Blocked on M1 |
| **M3** Optimization → accept | Blocked on M2 |

---

## Links

| Doc | Role |
|-----|------|
| [acceptance.md](acceptance.md) | Absolute accept / anti-protocol-PASS |
| [engine-redesign.md](engine-redesign.md) | Normative engine constraints (§5–§10) |
| [spec pack](README.md) | **Buildable** contracts + impl specs |
| [support-matrix.md](support-matrix.md) | Accepted gaps (K1/K5) |
| [MATRIX.md](../../../Refactor/page-projection-oracles/MATRIX.md) | Lab coverage truth |
