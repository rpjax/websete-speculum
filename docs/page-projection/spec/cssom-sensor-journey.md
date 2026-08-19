# PageProjection — CSSOM sensor journey (rulings)

**Status:** sealed narrative (2026-08-15); C5 relocked to poll 2026-08-18. Why the CSSOM detector exists in this shape.  
**Law of the walk:** [cssom-poll-algorithm.md](cssom-poll-algorithm.md) (I1–I11).  
**Accept split:** [acceptance.md](acceptance.md). **Plane contract:** [cssom.md](cssom.md) (C5 = this poll).  
This file does not license ad-hoc, skip-serialize-as-truth, or declaring site accept from `cssomPoll`.

The rest of PageProjection (table, pipe, resync strengths, two-phase apply) was already answered
on the **DOM** path. The open question was only: **how do we detect CSSOM mutations?**

---

## Two truths (they are not opinions)

### 1. There is no MutationObserver for CSSOM

DOM detection is objective: the browser delivers `MutationRecord`s. CSSOM has **no** equivalent
public observer, no per-rule generation, no dirty bit we can read without inventing one.

Consequence: there is **no** reliable, platform-honest “tell me what changed” API in-page. Completeness
means **reading live CSSOM** (`cssText` + object identity) and reconciling to the last committed
snapshot. That is a different paradigm from the DOM drain, not a missing `observe({ cssom: true })`.

### 2. The numeric account does not close

Lab load (Instagram-shaped readable programmatic CSSOM: ~10 sheets, ~14k top-level rules, in-place
+ insert/delete + `replaceSync`) showed the expensive signal is `cssText`. Serializing that set at
DOM tick rate (~60 Hz) on the same main thread as the page **does not fit** K/E budgets or “don’t
jank Virtual.” This was measured, not guessed.

Consequence: **lockstep 60 Hz CSSOM deltas are not a product SLO.** Pretending they are forces either
eating the page or a fake sensor. We refuse both.

These two truths are the **reality** the detector must own. Decisions below emanate from them, not
from convenience or green smoke.

---

## What we are not doing (ownership)

We are **not** abandoning the foundation or worst-case-first. We are **not** making amortizations the
proof that the foundation is fast. Empirically the foundation **does not** numerically sustain
adversarial 60 Hz serialize. That fact stays on the table.

We **are** being intelligent about the same reality: preserve invariants, no workarounds, take
coherent product decisions so **perceived** 1:1 can be true in the world while the detector stays
honest on the synthetic stress that exists to **break** the foundation.

---

## Core question → paradigm

**Q:** What replaces MutationObserver for CSS?

**A (sealed):**

1. **Eventual consistency** vs the DOM tick — a coherent CSSOM commit may attach on a later frame
   boundary. Clock contract, not a performance trick. [acceptance.md](acceptance.md): CSSOM **live**
   bar is perceived 1:1 / P7 at settle, not per-frame lockstep.
2. **Idle time-slicing** on the one JS thread (`requestIdleCallback`). Work degrades **with** the
   page: if the site is hungry, the poll starves. We do **not** preempt site JS on the live path to
   keep Projected CSS fresh. Resync / snapshot-`scan` are the rare exceptions that may blocking-scan.
3. **Reconcile** identity then content; topological copy of rule refs before any yield; stale skip;
   mass-abort on `replaceSync` so we never commit a false-empty sheet (C3.1). Full text: I1–I11.

DOM remains **numerical** 1:1 (MO + drain proved it under stress). CSSOM live does not get a second
MO by wishing.

---

## Why not other mechanisms

Anything that “is” a CSSOM MutationObserver without being one either **lies** or **breaks other
engine premises**.

| Mechanism | Why it is not the detector |
|-----------|----------------------------|
| Prototype / write-path **hooks** as detector | Fragile; **antibot-detectable**. **Rejected 2026-08-18.** Not the product sensor. Not a second completeness path. |
| **CDP CSS domain** dirty bit | Not a self-contained page script; couples the walk to the host session; already rejected (“CDP-dirty we will not use”). Inject stays CDP **init script**; data plane is not page WebSocket (E-03/E-08). |
| Length-only / `<style>.textContent` as content | Misses `insertRule` / in-place `rule.style`. May be an amortization **hint**, never the complete signal. |
| Full-sheet rewrite / `SHEET_DROP` of a live sheet | Forbidden by C3.1 when we emit. |
| Steal the page’s budget (timeout-preempt live scan) | Janks Virtual; antibot and 1:1 of the **source** page. Idle degrades us, not them. |
| Granular **resync of rules** to skip cost | Confuses recover (wholesale replace) with live list-diff. Resync always both planes. |

The detector stays **one JS bundle** in the Isolated World. Intelligence (generations, skip
serialize, in-page hints) must stay in that bundle if it ships later.

---

## Foundation vs amortizations (do not confuse the metrics)

| | Foundation (detector) | Amortizations (practice) |
|--|----------------------|---------------------------|
| Job | Answer “what changed?” without MO | Make **perceived** 1:1 viable on real sites |
| Stress | Synthetic worst case **must still be correct** (garbage-free, no false-empty sheet, idle-safe) | Must **not** be the score that says the foundation is good or fast |
| Numeric 60 Hz | **Does not sustain** — proven. Not an SLO | May stack (I3 batches, later hot/cold generations, skip, hints) so ordinary browsing *feels* 1:1 |
| Failure | Torn commit, silent incomplete sheet **at settle**, ad-hoc second path | Using skip/generations as the reason the adversarial “works” |

Worst-case-first **does not change.** We keep stressing the foundation. We count on intelligence
**in the real world** so the user-facing bar (perceived 1:1) holds. That is not “optimizations
became accept.” Settle still requires applied CSS. Establish/resync still complete.

---

## Decisions taken (this journey)

| Decision | Ruling |
|----------|--------|
| Detector | In-page poll: classify sheets, identity, `cssText`, reconcile to last commit |
| Live clock | Eventual vs DOM; attach pending on next `FrameEmitter` boundary |
| Idle policy | Degrade with the page; no live preemption |
| Accept | DOM numerical; CSSOM live perceived; establish/resync complete |
| Resync | Always whole system; blocking CSSOM scan; no per-rule resync frame |
| Snapshot | Tunable CSSOM (`none` / `committed` / `scan`); lab iso default `none` |
| Layers | `resync.ts` / `snapshot.ts` use cases; `CssomPlane`; `frame/` is pipe; `dom/` / `cssom/` planes |
| C5 / CDP | Poll is the sensor (2026-08-18); no CDP CSS in the walk |
| I3 | Topological copy atomic; hash the copy in idle batches; slot skip vs mass abort; live in lab |
| Amortizations | Annotated for later (e.g. GC-like generations). Not the detector. After I3 + numbers |
| Wire | §4.6 `0xA0–0xA5` on the wire; phase 1 table; C6 owned apply not this cut |

---

## Chronology (lab, 2026-08-15)

1. DOM table (single document) treated as done for lab; next gate CSSOM.  
2. Poll specified worst-case-first; no CDP dirty. Paper still said hooks until 2026-08-18.  
3. Idle + next-boundary attach; folder split (CSSOM out of DOM builders).  
4. Yield-per-rule on the **live** list rejected (torn epoch) → copy refs, hash the copy, stale skip,
   mass abort.  
5. Resync vs snapshot split; `rebuildAndResync` = protocol `resyncVirtual`.  
6. Idle starvation: degrade us, not the page.  
7. Accept split: perceived CSSOM live 1:1; synthetic churn is not a 60 Hz CSSOM defect.  
8. Amortizations (including hot/cold generations) recorded as **practice intelligence**, not a second
   sensor.  
9. **2026-08-18:** C5 relocked to this poll. Nested inners stay in grouping `cssText` (own rows = later opt).

Index: [decision-log.md](decision-log.md). Algorithm: [cssom-poll-algorithm.md](cssom-poll-algorithm.md).
