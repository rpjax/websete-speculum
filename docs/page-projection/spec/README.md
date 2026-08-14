# PageProjection specification

**Status:** documentation canon for `MirrorMode.PageProjection`.
**Accept bar:** [acceptance.md](acceptance.md) — absolute 1:1 parity with the original site.

> **Normative hierarchy (read this first).** The engine went through a redesign (V4). The **frame /
> replicated-state / wire / producer-construction / recovery** layer is now defined normatively by
> [`frame-protocol.md`](frame-protocol.md). The older `contracts/` + `implementation/` "buildable
> pack" and the establish/Node-mirror flows are **historical for those layers** — kept for provenance,
> not implemented from. See [`RECONCILIATION.md`](RECONCILIATION.md) for the full mapping of what
> supersedes what and what still needs work. `frame-protocol.md` is sealed against edits during
> reconciliation; everything else here is being brought into line with it.

## Normative canon (in force)

| Document | Role |
|----------|------|
| [frame-protocol.md](frame-protocol.md) | **Normative** — replicated state (§1), frame header + opcode space + instruction set (§2–§4), producer frame construction (§5), execution model (§6), ordering/failures/versioning (§7–§9). Supersedes `engine-redesign.md` §5.4 (op vocabulary), §5.5 (wire format), §5.6 (establish — deleted, §4.7) and §5.7 (recovery — see §5.8). |
| [engine-redesign.md](engine-redesign.md) | **Normative for the layers frame-protocol does not restate** — budgets (P1–P7, E1–E11), constraints K1–K5, oracles, surface, input, assets, browser pool, config. Its §5.4–§5.7 are superseded (above). |
| [acceptance.md](acceptance.md) | **Mandatory** — accept = 1:1 parity; anti-protocol-PASS rule. |
| [cssom.md](cssom.md) | Sealed CSSOM plane contract (materialization detail behind §4.6 opcodes). |
| [input.md](input.md) | Projected → Virtual intents and control bindings. |
| [virtual-assets.md](virtual-assets.md) | Virtual URL serve plane. |
| [support-matrix.md](support-matrix.md) | Published accepted gaps — K1/K5 boundaries. |
| [test-matrix.md](test-matrix.md) | `PP-*` coverage truth. **Partial reconciliation pending** — establish/Node-mirror rows need re-authoring against opcodes (see banner). |

## Process

| Document | Role |
|----------|------|
| [RECONCILIATION.md](RECONCILIATION.md) | **What supersedes what**, the change log for this cleanup, and the open items that need sign-off (deletions, `engine-redesign-extension.md` E-01..E-11, test-row re-authoring, cutover). |
| [work-order.md](work-order.md) | Milestones / process. **Status banner corrected** — the table engine now exists (lab); production cutover pending. |
| [HANDOFF.md](HANDOFF.md) | Debate handoff that produced the redesign (§13 establish deletion, §14 resync). Historical narrative. |

## Historical / superseded (do not implement from)

These are retained for provenance only. Each dead file below carries its own supersession banner.

| Document | Superseded by |
|----------|---------------|
| `contracts/` + `implementation/` pack (frame/state/wire/recovery parts) | [frame-protocol.md](frame-protocol.md) §1–§6 |
| [contracts/03-frame.md](contracts/03-frame.md) | frame-protocol.md §4, §5 (post-order; no `childList FULL/APPEND`) |
| [contracts/07-recovery.md](contracts/07-recovery.md) | frame-protocol.md §5.8 (identity-map resync; no Node mirror) |
| [contracts/08-surface.md](contracts/08-surface.md) | **partial** — surface reused; swap-trigger wording only (frame-protocol.md §5.8) |
| [contracts/05-establish.md](contracts/05-establish.md) | frame-protocol.md §4.7 (establish deleted) |
| [diff-pipeline.md](diff-pipeline.md), [coalesce.md](coalesce.md) | V1 history — already marked superseded |
| [engine-redesign-extension.md](engine-redesign-extension.md) | **Undecided** — E-01..E-11 (incl. the loopback-WS + CSP-strip E-03/E-08) need an explicit accept/reject ruling; see RECONCILIATION.md |

## Anti-sources

Do **not** use as design reference: any current live wiring under `Refactor/sidecar/.../mirror/page/**`
or `Refactor/web/.../live/page/**`, and the superseded docs listed above.

## Conflict rule

If any doc contradicts [frame-protocol.md](frame-protocol.md) on the frame/state/wire/construction/
recovery layer, **frame-protocol.md wins** and the other doc is stale — record it in
[RECONCILIATION.md](RECONCILIATION.md), do not "choose in code". For layers frame-protocol does not
cover (budgets, surface, input, assets, pool), [engine-redesign.md](engine-redesign.md) is normative.

## 1:1 rule

Every future code change that alters behaviour MUST update the matching normative MD in the same
change set. Ad-hoc code without a doc update is a process defect.
