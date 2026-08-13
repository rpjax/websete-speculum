# PageProjection specification

**Status:** documentation canon for `MirrorMode.PageProjection`.  
**Accept bar:** [acceptance.md](acceptance.md) — absolute 1:1 parity with the original site.  
**Engine canon:** [engine-redesign.md](engine-redesign.md).  
**Process:** [work-order.md](work-order.md).

This folder is the home for every PageProjection spec. The buildable pack (`contracts/`, `implementation/`) answers **how to build** the engine to the last comma. It does **not** describe, patch, or migrate any existing live path in the repo.

**Review status:** [REVIEW.md](REVIEW.md) — D3 PASS; `GAP.md` empty. Code = separate plan.

## Product canon (this folder)

| Document | Role |
|----------|------|
| [acceptance.md](acceptance.md) | **Mandatory** — accept = 1:1 parity with the original site |
| [engine-redesign.md](engine-redesign.md) | **Mandatory** — sole engine canon (F, wire, establish, recovery, surface, interaction, assets, pool, config) |
| [engine-redesign-extension.md](engine-redesign-extension.md) | Mechanism amendments (parent wins unless explicitly amended) |
| [work-order.md](work-order.md) | Milestones / process |
| [support-matrix.md](support-matrix.md) | Published §11 accepted gaps — K1/K5 boundaries |
| [test-matrix.md](test-matrix.md) | `PP-*` coverage truth, with WP ownership |
| [diff-streams.md](diff-streams.md) | **Sealed** Dom plane contract |
| [cssom.md](cssom.md) | **Sealed** Cssom plane contract |
| [input.md](input.md) | Projected → Virtual intents and control bindings |
| [virtual-assets.md](virtual-assets.md) | Virtual URL serve plane |
| [frame-protocol.md](frame-protocol.md) | Draft frame protocol (supersedes redesign §5.4–§5.5 once sealed) |
| [diff-pipeline.md](diff-pipeline.md) | **Superseded** — V1 F history |
| [coalesce.md](coalesce.md) | **Superseded** — V1 coalesce history |

## Buildable specification pack

| Layer | Role |
|-------|------|
| Redesign + acceptance + sealed input/cssom/assets | Constraints, budgets, product MUST/MUST NOT |
| [`contracts/`](contracts/) | **Buildable interfaces** end-to-end (what crosses process boundaries) |
| [`implementation/`](implementation/) | **Algorithms 1:1** with future source files |
| Future product code | Must match `implementation/` exactly |

**Conflict rule:** if a contract or impl spec contradicts the redesign, stop → record in [`DECISIONS.md`](DECISIONS.md) or [`GAP.md`](GAP.md). Do not “choose in code.”

**1:1 rule:** every future code change that alters behaviour MUST update the matching MD in the same change set. Every MD change that alters behaviour implies a future code change. Ad-hoc code without a doc update is a process defect.

## Anti-sources

Do **not** use as design reference:

- Any current `Refactor/sidecar/.../mirror/page/**` live wiring
- Any current `Refactor/web/.../live/page/**` “how it works today”
- Superseded docs (`diff-pipeline.md`, `coalesce.md`)

## How to read

1. [`contracts/00-overview.md`](contracts/00-overview.md) — E2E diagram + inventory  
2. Contracts `01`…`17` — interfaces  
3. [`contracts/17-module-map.md`](contracts/17-module-map.md) — future paths + LOC ceilings  
4. [`implementation/`](implementation/) — per-module algorithms  
5. Keep [`GAP.md`](GAP.md) empty before any code plan

## E2E flows that MUST be fully specified

1. Cold establish (session start → armed surface)  
2. Live mutation frame (observe → flush → encode → rewrite → mirror → relay → apply → paint)  
3. Soft navigation (no generation bump)  
4. Hard navigation / Document swap (generation bump + double-buffer)  
5. Desync → OOB resync → re-arm  
6. Input intent by `uint32` (armed only)  
7. Asset fetch (priority, L1/L2)  
8. Browser pool acquire / destroy-on-release  

## Scope of this pack

**In:** contracts + implementation specs conceived from the redesign.  
**Out:** product TypeScript/C# implementation, live oracles PASS, density calibration. Code is a **separate plan** after `GAP.md` is empty.
