# Reconciliation notes — PageProjection spec

**Date:** 2026-08-14 · **Author:** review pass (Claude), at Vinicius's request.
**Scope of this pass:** clean up and reconcile the spec docs against the sealed
[`frame-protocol.md`](frame-protocol.md). **`frame-protocol.md` was NOT modified. No code was
modified.** This file records what was changed, why, what is deliberately left alone, and what still
needs a human ruling.

---

## 1. Normative hierarchy (the one-paragraph version)

`frame-protocol.md` is the **normative source** for: the replicated state (§1), the frame header +
opcode space + instruction set (§2–§4), producer frame construction (§5), the execution model (§6),
and ordering/failures/versioning (§7–§9). For everything it does **not** restate —
budgets (P1–P7, E1–E11), constraints K1–K5, oracles, surface, input, assets, browser pool, config —
[`engine-redesign.md`](engine-redesign.md) remains normative. Concretely, `engine-redesign.md`
§5.4 (op vocabulary), §5.5 (wire format), §5.6 (establish) and §5.7 (recovery) are **superseded**;
the rest of it stands.

Everything under `contracts/` and `implementation/` — the "buildable pack" — is **historical for the
frame/state/wire/recovery layers**. It was written before the redesign and describes the establish +
Node-mirror + `childList`-diff design that no longer exists.

---

## 2. What this pass changed (safe, reversible, additive only)

No file was deleted and no normative content was invented. Every change is a banner, an appended row,
or the index rewrite — all reversible.

| File | Change | Why |
|------|--------|-----|
| `README.md` | **Rewritten** (front door) | It routed every reader — including Cursor — into the establish/Node-mirror pack and listed "Cold establish" as a required E2E flow. Now it puts `frame-protocol.md` at the top as normative and marks the pack historical. |
| `contracts/03-frame.md` | Supersession banner | Still specified `childList FULL/APPEND`, `patch`, accumulation sets, and **ancestor-first order** — the exact inverse of §5.5 post-order. Anyone building from it builds the pre-redesign engine. |
| `contracts/07-recovery.md` | Supersession banner | Still specified Node mirror / HTML serialize / `speculum-anchor` / `establishBegin-Chunk-End`. §5.8 declares it fully dead. |
| `contracts/08-surface.md` | Partial-supersession banner | Surface/double-buffer is still correct and reused; only the swap-trigger wording (`establishEnd …` → closing `CHECK`) changes. Banner says exactly that. |
| `DECISIONS.md` | Appended `D-SPEC-12..14` | The file is append-only by its own rule ("to reverse a decision, append a new row"). D-SPEC-4 (establish checksum) and D-SPEC-10 (resync watermark) were still recorded as live; the new rows supersede them and add a meta-supersession row. |
| `test-matrix.md` | Reconciliation banner | `PP-EST-1..7` and `PP-REC-2/3` are establish/Node-mirror rows; flagged for re-authoring against opcodes. `PP-REC-1` and the budgets survive. |
| `work-order.md` | Reconciliation banner | Its "M1 code NOT STARTED / BLOCKED" status is stale — the table engine now exists (lab); production cutover is the real open item. |

---

## 3. What was deliberately left untouched

- **`frame-protocol.md`** — per instruction. It is the sealed normative source.
- **All code** — per instruction.
- **`engine-redesign.md` body** — 72 KB, still largely normative (budgets/K1–K5/oracles/surface/
  input/assets/pool). Rather than edit a large normative file, its superseded sections (§5.4–§5.7)
  are recorded here and in the README canon table. If you want a banner on it too, say so.
- **The other ~14 `contracts/` files and the `implementation/` specs** — not bannered individually.
  The README now declares the whole pack historical for these layers in one place; bannering 30+
  files would be churn for little added safety. If any one of them is likely to be opened directly
  and mislead, banner it on request (candidates: `contracts/04-wire.md`, `contracts/05-establish.md`,
  `contracts/17-module-map.md`).

---

## 4. Open items that need YOUR ruling (not done here)

These are design/lifecycle decisions, not mechanical cleanup — recorded, not executed.

1. **Deletions.** `contracts/03-frame.md` and `contracts/07-recovery.md` are fully dead; their content
   is absorbed by `frame-protocol.md` §5/§5.8. HANDOFF §13.3 already flagged that deleting them needs
   your confirmation. They are bannered, not deleted. Same question for archiving the whole
   `contracts/` + `implementation/` pack into `docs/archive/` (the triage's original recommendation).
2. **`engine-redesign-extension.md` (E-01..E-11).** Still listed as canon-adjacent and never ruled on.
   The load-bearing ones are **E-03 (loopback WebSocket data channel)** and **E-08 (CSP strip + PNA
   bypass to make E-03 work)** — the triage recommended rejecting both in favour of the §5.7 binding
   channel. The decision log's own real-site probe already caught **CSP `connect-src` blocking the
   loopback WS on Wikipedia**, which is exactly the E-03 cost. This needs an explicit accept/reject.
3. **Test-matrix re-authoring.** `PP-EST-1..7` and `PP-REC-2/3` must be rewritten against opcodes +
   the resync `CHECK`, not HTML/byte-checksums. This is a §5.8 residual, listed there.
4. **Synchronous-walk budget.** No `E`-number covers one-off bulk resync latency at `MAX_ROWS` scale
   (frame-protocol.md §5.8 "Atomicity"). Needs a number or an explicit "exempt from E3–E5, revisit at
   implementation".

---

## 5. Cross-reference: findings from the code review (same session)

Recorded here so the doc and code observations live in one place. **No code was changed.**

- **Two implementations coexist.** The new table engine lives under
  `Refactor/sidecar/browser/mirror/projection/` and is exercised only by its lab. Production
  (`PatchrightBrowserSession.ts:305`) still starts `LivePageProjection` from the old
  `mirror/page/liveAttach` path. The cutover is the real M1 item; "never two live paths" applies on
  cutover day (delete the loser, do not flag it).
- **One concrete bug in the new engine.** `ReplicatedTable.insertBatch`
  (`models/replicatedTable.ts`) does not set the derived `nextSiblingOf` forward-link from the last
  inserted node to the pre-existing `before` anchor on an insert-before-existing (prepend / middle)
  op. A later `REMOVE` of that last-inserted node then fails to repair `before.prevSibling` (a
  **hashed** field), leaving it pointing at a detached row. Because producer and client run the same
  `ReplicatedTable` code, both corrupt identically → `preTableHash` does **not** catch it → it
  silently violates P0 ("the producer holds a copy, not a belief"). The projected DOM stays visually
  correct (materialization uses the `before` operand, not the table); resync heals it (append-only
  inserts). `prepend-stress.html` misses it because it evicts from the tail, not the just-prepended
  head. Suggested one-line fix: in `insertBatch`, when `before !== NONE`, also record
  `nextSiblingOf[last] = before`. Falsifier: `INSERT(P, before=X, [A,L]); REMOVE(P,[L])` then assert
  `getRow(X).prevSibling === id(A)` (today returns `id(L)`). **2026-08-14 update:** independently
  re-confirmed present by direct code read (not fixed yet) and formally tracked as
  [`frame-protocol.md`](frame-protocol.md) **OPEN-7** (§10) plus its own decision-log row, so it has a
  permanent home outside this reconciliation snapshot; gated as a required item before production
  cutover in [`work-order.md`](work-order.md)'s "Path to M1 cutover" section.
- **Positive notes.** The shared table interpreter (`replicatedTableApply.ts`) and shared hash
  (`rowHash.ts`) are used by both sides — correct and load-bearing. `resync.ts` implements §5.8
  faithfully and self-heals via append-only inserts. `bootstrap.ts` wires `resyncVirtual` per the
  corrected §5.1. The 48 KB-script and O(batch^2) `resolvedBefore` fixes are in the code with their
  rationale documented.

---

## 6. Suggested next step

Have the producer run the §6 local oracle — **Virtual `ReplicatedTable` × Virtual live DOM**,
periodic, O(n) — in the lab. It is the only check that catches the `insertBatch` class (the wire
hash cannot, by construction), and it doubles as a regression guard for any future derived-index bug.
Confirm whether `lab/frameInvariantMonitor.ts` already does this; if not, that is the gap to close.
**2026-08-14:** this is now item 1 of [`work-order.md`](work-order.md)'s "Path to M1 cutover" gate
list — see that doc for the full ordered path from here to production launch.
