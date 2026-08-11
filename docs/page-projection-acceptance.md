# PageProjection — acceptance (SEALED)

**Status:** constitution — not aspirational guidance.  
**If this conflicts with a green smoke, a recovery protocol, or convenience, this wins.**

## Criterion

**Absolute 1:1 parity** between:

1. using the site through Speculum Live in **`MirrorMode.PageProjection`** (Projected), and  
2. opening the **same** site in a normal browser on the Virtual session’s target.

The design goal of PageProjection is that the user experience of the projected page is **indistinguishable** from the original for browsing, layout, media, interaction, and completeness. **Anything less is unacceptable.**

## What counts as failure

Any of the following is a **product defect**, even if protocol events look healthy:

- Incomplete paint (blank/skeleton sections that are populated on the original).
- Broken, crushed, missing, or wrong-sized images/media vs the original.
- Layout collapse, missing CSSOM application, or “DOM present but unusable”.
- Chronic lag / stalled catch-up that leaves Projected behind Virtual for ordinary browsing.
- Desync, void mid-navigation, wrong SoftNav target, or input that does not match the original.
- Recovery that “serves Resync” but leaves the surface wrong, stale, or unarmed.

## What does **not** prove accept

These are **insufficient** alone (they may be necessary diagnostics, never the bar):

- HTTP `200` / hub `ok: true` / `ResyncServed ≥ 1` / WD > N / `ownedRules` / `htmlLen` thresholds.
- Protocol-only recovery (QD → OOB → Diff reopen) without visual/functional parity.
- Smoke PASS flags scoped to a single bug class while the surface remains unusable.
- **Ad-hoc workarounds** that restore a banned cost (e.g. cold full DomMap “bootstrap” after a stream seed) to make hopdiag look alive while the designed stream path remains broken.

## Hard ban — no ad-hoc

**Ad-hoc / workaround code is strictly forbidden.** If stream establish, mirror, ledger, or Diff apply fails, fix that mechanism. Never reintroduce full DomMap (or equivalent dump) on the cold happy path to paper over catch-up/MO/queue defects. Green via workaround is a **product defect**, not a ship.

## Telemetry & harness duty

Journal, ClientObservation, screenshots, and smoke/diagnose scripts must **fail** when 1:1 parity is broken. Raw signals that imply unusability (e.g. large undelivered backlog after settle, `armed=false`, broken img ratio, crushed layout, unanswered Resync) must not be classified as PASS.

Protocol health is a **means**. Parity is the **end**.

## Scope note

Capacity/SLO ceilings remain in `perf.yml` (functional ≠ Perf). That does **not** excuse an unusable Projected page under ordinary lab load: if the user cannot use the site 1:1, the build has not met accept — fix product or declare the gap explicitly as open defect, never as green.
