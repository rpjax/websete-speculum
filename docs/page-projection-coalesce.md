# Dom Projection — coalesce configuration

**Status:** design (V1).

> **Naming / supersession:** product mode/pipe is **PageProjection**
> (`MirrorMode.PageProjection`), not `DomProjection`. Sealed contracts:
> [page-projection-diff-streams.md](page-projection-diff-streams.md) (Dom plane),
> [page-projection-cssom.md](page-projection-cssom.md) (Cssom plane). This file
> remains the implemented V1 contract until T11/T12 cutover.


**Scope:** buffering strategy between Anchorer’s dirty signals and DiffProducer
flush — **knobs, defaults, and admin/runtime configurability**.

This is **not** F’s mapping algorithm. F assumes a coalesce buffer exists; see
[page-projection-diff-pipeline.md](page-projection-diff-pipeline.md) §8.

**Related:** Sessions admin config · `MirrorMode.DomProjection` (→ `PageProjection` at cutover)

---

## 1. Why coalesce

SPAs can mutate the Virtual DOM hundreds of times per frame. Emitting every
mutation wastes bandwidth and thrash-applies on the consumer. Coalesce batches
dirty work, then runs: DiffProducer → map → rewrite kickoff → emit.

---

## 2. Strategies

| `strategy` | Behavior |
|------------|----------|
| **`idleGap`** | Reset idle timer on each mutation; flush after `coalesceWindowMs` quiet, or on caps / `maxWaitMs`. |
| **`fixedQuantum`** | While dirty, flush every `coalesceWindowMs` (batch the quantum). |
| **`adaptive`** | Widen window under high mutation rate; tighten when idle; still bound by caps / `maxWaitMs`. |

---

## 3. Knobs

| Knob | Role |
|------|------|
| **`strategy`** | Which policy above |
| **`coalesceWindowMs`** | Idle gap or quantum length (ms) |
| **`maxWaitMs`** | Hard deadline from first buffered mutation in a batch |
| **`maxBufferBytes`** | Estimated serialized size → force flush |
| **`maxOpsPerFlush`** | Dirty/root volume proxy → force flush |

### Forced flush (not knobs)

Always flush immediately for: DomDiff `target=document` (start, generation bump,
resync), configured cap hits, session shutdown best-effort.

---

## 4. V1 defaults (starting point)

| Knob | Default |
|------|---------|
| `strategy` | `idleGap` |
| `coalesceWindowMs` | `8` |
| `maxWaitMs` | `50` |
| `maxBufferBytes` | `256000` |
| `maxOpsPerFlush` | `500` |

Defaults may be tuned after soak; changing them must not require redesigning F.

---

## 5. Admin / runtime configuration

Expose under Sessions Dom Projection (admin panel) **only knobs that operators
legitimately tune at runtime**:

| Knob | Runtime configurable | Rationale |
|------|----------------------|-----------|
| `strategy` | **Yes** | Site classes differ (chatty SPA vs static). |
| `coalesceWindowMs` | **Yes** | Latency vs bandwidth tradeoff. |
| `maxWaitMs` | **Yes** | Worst-case freshness cap. |
| `maxBufferBytes` | **Yes** | Protect pipe / client apply cost. |
| `maxOpsPerFlush` | **Yes** | Same as bytes, different unit. |

Do **not** invent admin toggles for internal implementation details (e.g. timer
implementation, fingerprint internals). Validation: reject non-positive
windows; enforce sane max ceilings in config schema so a bad panel value cannot
stall emits forever (`maxWaitMs` required upper bound in schema).

Config applies to the live Dom Projection producer for the session (or global
Sessions default + per-session override — product wiring TBD; both must read the
same knob names).

---

## 6. Relationship to other docs

| Doc | Owns |
|-----|------|
| [page-projection-diff-pipeline.md](page-projection-diff-pipeline.md) | F algorithm; coalesce exists between Anchorer and DiffProducer |
| **This doc** | Strategy meanings, defaults, admin-configurable surface |
| [page-projection-virtual-assets.md](page-projection-virtual-assets.md) | Serving rewritten URLs (independent of coalesce) |
