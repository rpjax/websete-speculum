# PageProjection — acceptance (SEALED)

**Status:** constitution — not aspirational guidance.  
**If this conflicts with a green smoke, a recovery protocol, or convenience, this wins.**

## Criterion

**Absolute 1:1 parity** between:

1. using the site through Speculum Live in **`MirrorMode.PageProjection`** (Projected), and  
2. opening the **same** site in a normal browser on the Virtual session’s target.

The design goal of PageProjection is that the user experience of the projected page is **indistinguishable** from the original for browsing, layout, media, interaction, and completeness. **Anything less is unacceptable.**

### How 1:1 is measured (DOM vs CSSOM) — ruling 2026-08-15

This is **accepting the budget**, not softening the product into “good enough protocol.”

| Plane | Bar | Why |
|-------|-----|-----|
| **DOM** (structure, text, attrs, topology) | **Numerical / state 1:1** — coherent ticks, high FPS under stress, not eventual. Lab proved this on the table path. | MutationObserver + drain fits the main-thread mutation rate we actually sustain. |
| **CSSOM live** (rule tree after establish) | **Perceived 1:1** — what the user experiences after settle and during ordinary browsing. **Not** lockstep 60 Hz of every adversarial `cssText` mutation. | No CSSOM MutationObserver. Detection is reconcile + idle + eventual ([cssom-poll-algorithm.md](cssom-poll-algorithm.md)). Worst-case readable volume cannot be scanned at DOM tick rate without eating the page (K/E budgets). |
| **CSSOM establish / resync** | Completeness: install/scan so first paint and recover are not unstyled. PP-EST-6 / resync always both planes. | Rare; may pay a blocking scan. |

**Foundation vs practice.** The synthetic worst case exists to **stress the detection algorithm** (garbage-free commit, no false-empty sheet, idle degrades with the page). It does **not** set a 60 FPS CSSOM-delta SLO. On real sites, amortizations (idle batches, later generations/hot-cold, skip serialize, in-page hints) are how **perceived** parity stays 1:1. They must not become the detector, and they must not make a live sheet silently incomplete **at settle**. Narrative: [cssom-sensor-journey.md](cssom-sensor-journey.md).

**Still a defect:** DOM present but unusable, missing stylesheet application after settle, FOUC on establish, chronic catch-up that a user notices on ordinary browsing. **Not a defect:** Projected CSSOM a poll-interval behind Virtual during a synthetic 14k-rule churn hammer.

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

## Hard ban — no ad-hoc (T3, V4 restatement)

**Ad-hoc / workaround code is strictly forbidden.** If seed, catch-up, table apply, or resync fails, **fix that algorithm**. Never reintroduce full DomMap / HTML dump / “bootstrap after stream seed” on the cold happy path. Green via workaround is a **product defect**, not a ship.

V4 happy path is **only** the frame protocol ([frame-protocol.md](frame-protocol.md)):

- Cold start = `resyncVirtual` then ordinary ticks — not a second full-tree dump.
- Mid-session desync = `emitResyncFrame` into the double-buffer; swap after closing `CHECK`.
- **`generation` / `EPOCH_RESET` only when the top-level Document object is replaced.** Soft-nav, SPA wipe, pierced iframe navigation, and resync itself MUST NOT invent a generation bump.
- Resync MUST NOT be used to paper over a producer table bug (OPEN-7): fix the table.

(Historical T3 text lived in `diff-streams.md`; that file is archived. This section is the live rule.)

## Telemetry & harness duty

Journal, ClientObservation, screenshots, and smoke/diagnose scripts must **fail** when 1:1 parity is broken. Raw signals that imply unusability (e.g. large undelivered backlog after settle, `armed=false`, broken img ratio, crushed layout, unanswered Resync) must not be classified as PASS.

Protocol health is a **means**. Parity is the **end**.

**Events vs probes (lab, V4):** capability-toggled **event** telemetry (`frameEmitted`, `applyResult`, desync, percentiles) is for investigation and O3 *inputs*. It MUST NOT be the pass/fail source for table identity, DOM isomorphism, or “producer/client agree.” Those asserts use **probes**: a coherent state snapshot at sequence S (table digest, table×DOM, tree×tree) — [observability.md](observability.md). A wire monitor may fail on malformed bytes; it must not fail because a telemetry field disagreed with a shadow counter.

## Scope note

Capacity/SLO ceilings remain in `perf.yml` (functional ≠ Perf). That does **not** excuse an unusable Projected page under ordinary lab load: if the user cannot use the site 1:1, the build has not met accept — fix product or declare the gap explicitly as open defect, never as green.
