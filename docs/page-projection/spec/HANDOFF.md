# PageProjection frame protocol — debate handoff

**Purpose:** resume an in-progress design debate at the exact point it stopped. This is **not** a
spec — it is the state of the argument: what is decided, why; what was rejected, why, and what would
reopen it; what is still open; and the one question that was on the table when the conversation moved
here.

**Read order for whoever picks this up:** this file → `frame-protocol.md` (the spec being written) →
`engine-redesign.md` (budgets, constraints, oracles, test matrix — still in force, not restated here).

**Date of handoff:** 2026-08-13.

---

## 0. How this work runs

| Rule | Detail |
|------|--------|
| **Rodrigo decides** | Every architectural decision returns to him. An agent presents options with trade-offs and evidence and does **not** mark anything `DECIDED` on its own. |
| **No code yet** | This phase is definition only. Do not implement. |
| **No new `.md` files** | Edit the existing spec. A parallel spec pack was created once before and it caused the failure described in §8. |
| **No files named `Live`, `V2`, `New`, `Alt`** | If a design is wrong, fix it in place. |
| **Exit criterion is a passing test** | Not a status table, not a claim of completion. |
| **Language** | Conversation pt-BR; artifacts in `docs/` English. |

He has said explicitly: *"Nós não vamos fugir da complexidade; nós não vamos fazer código adhoc.
Aqui pagamos custo de complexidade onde faz sentido em vez de fugir da complexidade."* Proposals that
simplify by deleting capability will be rejected on those grounds — argue on cost/benefit, not on
aesthetics.

He has also said the current contradictions between docs are **expected** mid-redesign, and that a
consolidation pass into one coherent doc without redundancy or contradiction is planned — but not yet.

---

## 1. Where the documents live

Everything was consolidated into `docs/page-projection/spec/`, **with the `page-projection-` prefix
stripped**. Siblings reference each other by bare name; `naming.md`, `engineering-standards.md`,
`telemetry.md` are at `../../`.

| File | Role |
|------|------|
| `frame-protocol.md` | **The spec being written.** v1, 529 lines. Supersedes §5.4/§5.5 of `engine-redesign.md` once sealed. |
| `engine-redesign.md` | Constraints K1–K5, budgets P1–P7 / E1–E11, oracles O1–O5, test matrix `PP-*`. **Still in force.** |
| `acceptance.md` | Absolute 1:1 parity. Wins over everything, including this debate. |
| `contracts/03-frame.md` | **DEAD — absorbed.** Its valid content (accumulation sets, flush order) is now `frame-protocol.md` §5. Delete the file — do not leave it as a half-truth. |
| `implementation/sidecar/frame.md` | **DEAD — absorbed.** Same; also pointed at the abandoned path `patchright/mirror/page/frame.ts`. Delete. |
| `contracts/07-recovery.md` | **DEAD — superseded.** Node mirror, HTML serialize, `speculum-anchor`, `establishBegin/establishChunk/establishEnd` are all gone. Resync is now `frame-protocol.md` §5.8 (identity-map two-pass, existing opcodes). Delete once `PP-REC-*` tests are re-authored against it (§14). |
| `contracts/08-surface.md` | **Mostly alive — one wording fix needed.** The double-buffer surface mechanism is reused as-is by §5.8; only its swap-trigger condition (currently `establishEnd ∧ cssomInstall ∧ body non-empty`) needs to read "this frame's `CHECK` verifies OK" instead. Not a design change. |
| `engine-redesign-extension.md` | Cursor's unilateral decisions E-01…E-11. See §7 — **not all of these are accepted.** |

The absorption happened in the session recorded at §13: `frame-protocol.md` §5 ("Frame construction —
producer") now carries the buffer → visited set → single-pass DFS → post-order emission → deferred-GC
algorithm. The two files above are dead weight; deleting them is a file-system operation, not a design
one, and has not been done yet (no code/file deletions in this pass — confirm before removing).

---

## 2. The bug that started this

**Symptom (lab, `demo.html`):** projected `h1` rendered as `"Lab fixtureLab fixture"`, `title`
duplicated, 3 `script` placeholders instead of 1. Protocol was fully green: contiguous sequence,
`applyResult ok=true` on 0…6, establish checksum valid.

**Immediate cause:** `isSuffixAppend([], next)` returns true vacuously. The establish seeded
`published` (ids) but **not** `lastChildLists` (child order). With `prev = []` the first live frame
became `APPEND` onto an already-painted tree, re-appending children.

**Fixed in the lab:** guard `prev.length > 0`, plus seeding `lastChildLists` during the establish
walk. Confirmed `appendFromEmptyCount=0`, `dupH1=no`.

**Root cause (the part that matters):** `append` was the **only delta in an otherwise declarative
protocol**.

| Kind | Property |
|------|----------|
| **Declarative** | States the end state of what it addresses. Idempotent. Applying it over a wrong prior state still converges. `full` and `patch` are both this. |
| **Delta** | States a change relative to an *assumed* prior state. Not idempotent. If the assumption is wrong the result is wrong, and the payload carries nothing that could detect it. |

There was exactly one delta, and it is the one that broke. Not a coincidence — it was the only place
that failure was possible. Note also: **`lastChildLists` exists solely to serve the `APPEND`
optimization.** The data structure that caused the bug only exists because of the optimization.

---

## 3. The chain of the argument (in order)

### 3.1 My original `APPEND` justification was wrong

`engine-redesign.md` §5.4.2 justified `APPEND` for "the pathological infinite-scroll case". That
compared `FULL` against nothing instead of against the `fresh` payload you send either way.

| Scenario | `fresh` payload | id list (`FULL`) | `FULL` overhead |
|----------|-----------------|------------------|-----------------|
| Infinite scroll: 2000 cards, +20 cards (~50 nodes each) | ~50 KB | ~8 KB | **~15%** |
| Live odds: 2000 rows, +1 row (~20 nodes) | ~1 KB | ~8 KB | **~800%** |

Conclusion: `APPEND` pays **only when the list is long and the addition is small** — which is exactly
feed / odds / chat / log, i.e. the primary product shape. Deleting it blindly would regress the case
that matters most.

### 3.2 Three options were put on the table

| Option | Content | Outcome |
|--------|---------|---------|
| **A** | Kill `APPEND`, `FULL` only. Kills the bug class *and* `lastChildLists`. | Costs the 800% on live odds. Not chosen. |
| **B** | Keep `APPEND`, add a `prevCount` precondition. | **REJECTED by Rodrigo as ad-hoc.** It verifies a *proxy* (child count) rather than *state identity* — two lists of equal length with different content pass. |
| **C** | Replace the delta with a declarative suffix: `childListTail { parent, after, children }` — "after child `after`, the children are exactly these". Idempotent, self-healing on the tail, no producer-side state, empty case degrades naturally to `FULL`, failure is loud (unresolvable `after` → desync, using the existing id-resolution rule). | Superseded by §3.4 — the table model makes the precondition general. `childListTail` survives only as a possible **byte** optimization, not as a safety mechanism. |

### 3.3 LMS — proposed, then role-changed

Rodrigo proposed a per-node `last-mutation-frame` as the coherence mechanism.

I had deleted LMS in `engine-redesign.md` §5.1.8 as "no consumer". The correction:

- **Right about the attribute.** The old implementation wrote `speculum-last-mutation-sequence` into
  the Virtual DOM — one attribute write per touched node per emit, generating MutationRecords for the
  site's own observers and invalidating style caches. That stays dead.
- **Wrong about the concept.** As a **table column** it costs 4 bytes per row and zero DOM writes.

The principle it unlocked: **deltas are permitted if they carry a coherence token; divergence is
detected and recoverable, never silent.** That is version-vector-per-node — the same mechanism as an
ETag, an optimistic-concurrency version column, or a CRDT causal check. It is the principled form of
what `prevCount` was hacking at.

**Then the table model changed its role.** With frame-level `preTableHash` verifying the *entire*
table before every frame, per-row versioning adds nothing to safety and is a precondition on no
instruction. `lms` is retained for **diagnostics and GC only**. This role change is recorded
explicitly in the spec's decision log so the original justification is not carried forward as cruft.

### 3.4 The turn: the table is the replicated structure (P0)

Rodrigo's proposal, restated:

- The MutationObserver callback must be light — record into a buffer, nothing else.
- Both ends maintain an **identical table**. It serves two purposes: index the entire tree *including
  text nodes*, and guarantee state sync between frames.
- On frame tick, buffered mutations produce a frame. The frame is applied to **both tables** — on the
  Virtual side only the table, because the real tree already mutated.
- The client applies the frame as an atomic series of instructions.
- The frame is also responsible for keeping the index table in sync — id/anchor and checksum.

**What this actually is:** before, the mental model was "Virtual DOM is truth, client DOM is the
replica, the frame is the sync; the table is a helper." Now: **the table is the replicated structure
and the DOM on both sides is a projection of it.**

Consequences, all structural rather than patched:

1. **The producer never holds a belief about client state — it holds a copy.** Both sides apply the
   same frame to the same starting state, so the tables are identical by construction. This dissolves
   `lastChildLists` and the text-node registry asymmetry at the root.
2. Text and comment nodes stop being special — they are rows.
3. Verification becomes comparing a number instead of walking a tree.
4. Divergence localizes to a row.

### 3.5 Two-phase execution (P3)

My synthesis, answering my own objection to instruction streams (that you cannot validate a
cursor-dependent stream before executing it):

| Phase | Work | On failure |
|-------|------|-----------|
| **1 — table** | verify `preTableHash`, apply all row mutations, evaluate `CHECK` | abort **before touching the DOM** |
| **2 — materialize** | reflect changed rows into the DOM | cannot fail — already validated |

Whole-frame validate-then-mutate returns with no undo log and no scratch tree. The Virtual side runs
**phase 1 only**.

**The invariant this creates:** the Virtual table is a projection of *what was sent*, not of *what the
Virtual DOM is*. If frame generation drops or deforms something, the client stays faithfully
synchronized to a falsehood. Covered by two checks: Virtual table × Virtual DOM (local, O(n),
periodic) and Virtual `tableHash` × client `tableHash` (8 bytes, every frame).

### 3.6 Terminology correction

Rodrigo called the instructions "declarative". They are not — `append-child` is imperative. The
correct word is **self-contained**: every operand explicit, no cursor, no hidden machine state.

This matters because `set-attribute` is idempotent, `create-node` with an explicit id is idempotent,
but **`append-child` is not** — applying it twice appends twice. The sketched vocabulary reintroduces
the exact hazard **unless** the frame carries the precondition. It does, via `preTableHash`.

**Therefore `preTableHash` and the imperative instructions are one design, not two features.**
Removing the precondition re-creates the defect class. This is written into the spec as **P2** so a
later reader does not "clean up" what looks like a redundant hash.

---

## 4. Decided (all in `frame-protocol.md`)

### Principles P0–P7

P0 table is the replicated structure · P1 instructions are self-contained · P2 `preTableHash`
licenses non-idempotent instructions · P3 two phases · P4 phase is a fixed property of the opcode ·
P5 fixed-width operands, no varints on the hot path (follows from CPU being the binding budget, not
bytes) · P6 one way to say one thing (no `MOVE`, no `REPLACE`) · P7 strict over tolerant.

### Structure and identity

- Ids are `u32`, allocated **only** by the producer, monotonic, never reused within a `generation`.
- **Topology is `parent` + `prevSibling`, never a positional index.** A positional index would
  renumber and rehash every following sibling on a middle insert — O(n) on exactly the long-list shape
  live odds produces. With `prevSibling` every structural edit touches two rows.
- **Stylesheets and rules are rows in the same table and id space**: a rule's parent is its sheet, a
  sheet's parent is its pierce host. One topology model covers DOM and CSSOM; one hash covers both.

### Hashing

```
rowHash   = H64( id, kind, parent, prevSibling, contentHash )
tableHash = Σ rowHash  (mod 2^64)
update    = tableHash += newRowHash − oldRowHash      // O(1)
```

Addition rather than XOR (XOR cancels on duplicate row hashes). Attribute order is **not** hashed —
it is not semantic for rendering, and commutativity makes `ATTR_SET` order-independent. `lms` is
**not** hashed. An O(n) recompute per frame violates **E5** and is a contract violation, not an
optimization choice.

### Strings

Session-persistent, **append-only** intern table (`STR_DEF`) plus per-frame strings, discriminated by
bit 31 of `StrRef`. Because it is immutable it cannot diverge by mutation; a lost `STR_DEF` surfaces
as `malformed` on first reference, so it needs no separate hash.

### The 27 opcodes

Reserved ranges; `0x00` and `0xFF` permanently invalid (they catch zero-filled and `0xFF`-filled
buffers, the commonest corruption patterns). Opcode in a reserved range reports `version_skew`, not
`malformed` — it is almost always a stale peer.

Full operand tables, preconditions, table effect, DOM effect and failure class per opcode are in
`frame-protocol.md` §4. Points that carry reasoning worth preserving:

- **`ATTR_SET` / `ATTR_DEL` are separate** because the empty string is a legitimate attribute value
  (`<input value="">`), so a sentinel for deletion would be wrong.
- **`PROP_SET` is separate from `ATTR_SET`** because internal node state (D16: value, checked,
  selected, dialog modal, popover, media, custom validity) is *published* as a `speculum-*` attribute
  but *applied* as a property. Collapsing them forces the client to infer which is which.
- **`NODE_SNAPSHOT` is the per-node cure path** — one bad node does not desync the session.
- **`INSERT` prevents cycles**: no id may be `parent` or an ancestor of `parent`.
- **`NODE_DROP` requires the row detached** (`parent = 0`), forcing an explicit `REMOVE` first, and
  drops the whole detached subtree.
- **`REMOVE` carries `parent` redundantly** as a cheap assert — disagreement is `precondition`, which
  catches divergence one frame earlier.

### A deliberate asymmetry (Rodrigo has not yet ruled on it)

`ATTR_DEL` of an absent attribute is a **no-op**; `NODE_DROP` of an absent id is **malformed**. The
reasoning is the memory-management analogy: `ATTR_DEL` declares an *end state* (attribute not present)
so tolerance is correct; `NODE_DROP` is a *resource* operation (free this row) so double-free is an
encoder bug and strictness is correct. **If he accepts this criterion it also decides OPEN-1.**

### Failure classes and limits

Three classes with distinct codes because they mean different bugs: `malformed` (encoder or transport
corruption), `precondition` (state divergence), `version_skew` (stale peer). Every `count` has a
declared maximum checked **before any allocation** — a corrupted length must never cause a large
allocation.

---

## 5. Rejected — with the reasoning and the reopen criteria

**Do not resurrect these without meeting the stated condition.**

### 5.1 `prevCount` as an append precondition

Rejected by Rodrigo as ad-hoc: it verifies a proxy (count) instead of state identity. Superseded by
`preTableHash`, which verifies the whole state.

### 5.2 A full cursor-based ISA / bytecode VM

Rodrigo proposed CPU-like micro-instructions where instructions also mutate the index table.

**What it genuinely buys:** address amortization (mutations cluster in one subtree; relative steps at
1 byte instead of 4-byte absolute addresses), encoding density, uniform extension (new capability =
new opcode instead of a new op type with its own payload schema and decoder branch), registry mutation
as a first-class programmed act, and inline verification at arbitrary granularity.

**What it costs:**

1. **Atomicity gets harder.** Instruction N's validity depends on 1…N−1 having executed, so you cannot
   validate the frame before executing it. Resolvable with a verification prologue, but that
   constrains the encoder (the prologue cannot validate a reference to a node the frame itself will
   create).
2. **Idempotence dies.** A declarative op applied over a wrong state converges; a cursor-relative
   stream diverges arbitrarily.
3. **Telemetry legibility collapses** — and this is the heaviest cost given this project's history.
   `childList { parent: 7, mode: append }` is readable in a dump; that legibility is literally what
   allowed the append defect to be named without inspecting the DOM (`appendFromEmptyCount=7`,
   `lastChildListsEmpty=true`). An instruction stream needs a disassembler, and "instruction 143 of
   800 corrupted the cursor" is far harder to diagnose.
4. **The complexity lands in the two modules that must hold E3/E4** (≤10 µs per operation).

**The decisive number:** ~5 bytes saved per op × ~7000 ops ≈ 35 KB per page load; ~50 bytes per frame.
**The ISA optimizes bytes, and the binding constraint is CPU per operation, not bytes.** The one place
it would pay an order of magnitude — big structural frames, i.e. establish — is the place deliberately
given to the native C++ parser.

**Reopen if any of:** (1) O3 shows bytes/frame as the active constraint rather than CPU; (2) the
vocabulary grows past ~20 ops **with bespoke payloads** (27 uniform instructions in a dispatch table is
a different regime and does not count); (3) a measured dense-burst case where absolute addressing is
the largest slice of the frame.

**Extracted and kept regardless:** registry mutation is *programmed*, not inferred (`NODE_NEW` /
`NODE_DROP` are explicit); checksum as an in-band op (`CHECK`); relative addressing modes remain
available as a cheaper alternative than a full VM.

### 5.3 Filtering mutations by visual relevance

Breaks determinism and the index space. Unnecessary once E3/E4 hold.

---

## 6. Open

| # | Question | Status |
|---|----------|--------|
| **OPEN-1** | `NODE_DROP` of an absent id: `malformed` or tolerated? | Currently `malformed`. The §4 asymmetry criterion would settle it. If tolerated, it MUST be counted in telemetry — never silent. |
| **OPEN-2** | Detached-row lifetime | **Effectively resolved by the Gemini thread (§7).** The rule is: decide at end of tick — a node in `removedNodes` that was not re-inserted anywhere becomes `NODE_DROP`; one that was re-inserted is a move. `lms`-based GC is no longer needed and `lms` stays diagnostics-only. **Needs Rodrigo to confirm before sealing.** |
| **OPEN-3** | `CHECK.scope` granularity | **Leaning id ranges, with a technical reason:** subtree scoping needs per-subtree hashes and a change propagates to the root — expensive. Id ranges are partial sums per bucket, O(1). Awaiting confirmation. |
| **OPEN-4** | Establish shape | **Reformulated — see §7.** No longer "HTML chunks vs table dump". |

---

## 7. The Gemini thread — what it added

Rodrigo ran part of the debate with Gemini and brought the transcript back. Sorted:

### 7.1 The large item: cold start may not need an establish at all

Gemini assumes the MutationObserver is installed at `document-start` via
`Page.addScriptToEvaluateOnNewDocument` and **never mentions a snapshot**. The implication it did not
draw:

**If the observer is installed before the parser emits the first node, the instruction stream *is* the
establish.** The client builds the document from `NODE_NEW`/`INSERT` from instruction one, in the same
order the Virtual parser inserted.

What that eliminates:

- `EST_CHUNK_HTML` and OPEN-4 as originally posed
- The **establish ↔ live handoff race** — an entire specified section (`engine-redesign.md` §5.6.6,
  test `PP-EST-3`) stops existing, because there is no second path a mutation can fall into
- The **text-node registry asymmetry** — no bootstrap HTML means no "elements carry anchors, text does
  not"
- `speculum-anchor` in establish HTML (`engine-redesign.md` §5.1.7) disappears with it

And it gains progressive paint *more faithfully* than the HTML path: the client's DOM grows in exactly
the order the Virtual's did, rather than "snapshot then patch".

**The cost** is the one I argued for HTML establish: you trade the C++ parser for ~20k `createElement`
calls. That is a measurement, not an opinion — and the measurement is now cheaper because it is two
paths instead of three.

**Where a snapshot still survives:** resync (the client desynced mid-session; you cannot replay from
byte zero) and attach-to-an-already-loaded-page. So OPEN-4 becomes **"cold start = instruction stream
from byte zero; resync/attach = `EST_TABLE`"** — two paths with distinct purposes rather than two ways
to do one thing.

### 7.2 A real correction to `frame-protocol.md` §4.3 — emission must be post-order

Our §4.3 says `INSERT` is emitted "ancestor-first in document order — a parent exists before it is
addressed". That rationale came from the **old** nested-descriptor `childList` model. With `NODE_NEW`
separated into phase 1, **every parent already exists detached**, so the dependency argument evaporates
and only cost remains:

```
ancestor-first:  INSERT(body,[div])  → empty div enters the LIVE tree
                 INSERT(div,[span])  → touches the live tree
                 INSERT(span,[text]) → touches the live tree

post-order:      INSERT(span,[text]) → both detached, free
                 INSERT(div,[span])  → both detached, free
                 INSERT(body,[div])  → one attach of a finished subtree
```

**Rule: a node is attached to its parent before its parent is attached to the live tree.** Safe by
construction because phase 1 created every row.

Accuracy note: Gemini claimed "only 1 reflow". Browsers do not reflow synchronously on insertion — they
invalidate and lay out at the next paint or on a forced synchronous read. The real difference is
invalidation scope and style recalc, not literally three reflows. The optimization is still correct,
just less dramatic than stated.

### 7.3 A silent K4 defect this exposed: id 1 and the doctype

Gemini maps `ID 1 = Document` and creates `<html>` as id 2. Our spec §1.2 says "id 1 = document root —
the projected `<html>`". **We are conflating Document with documentElement.**

It matters because of the **doctype**. `<!DOCTYPE html>` is a child of Document, sibling of `<html>`.
If it is not projected, the client document renders in **quirks mode** — different box model,
different layout. That is a silent parity failure, and it appears in **neither** the spec nor the test
matrix.

Correction needed: id 1 = **Document**; `<html>` is an ordinary row; `DOCTYPE` becomes a `kind` or is
configured at surface creation.

### 7.4 Confirmations (no change needed, but independently validated)

- **Deferred GC.** Do not emit destroy on `removedNodes`; decide at end of frame. Matches our
  `REMOVE` / `NODE_DROP` split and supplies the producer-side rule that OPEN-2 was missing.
- **Node reuse via move is extremely common** — keyed reconciliation in React/Vue/Svelte, drag & drop,
  portals/modals, responsive wrappers. Destroy-and-recreate loses input text, video playback position,
  focus, scroll, iframe content. Confirms P6 and `PP-MOVE-1..3`.
- **The `addedNodes` trap.** The MutationObserver does **not** emit records for the descendants of a
  subtree inserted at once — only the root appears in `addedNodes`. The producer must walk it
  recursively or the interior is never sent. This belongs in the frame-construction section.
- **MutationObserver at document-start.** `document.documentElement` is null; the first callback
  typically batches DocumentType, `<html>`, `<head>`, `<body>`, with `target === document`.
  `MutationRecord` fields: `type`, `target`, `addedNodes`, `removedNodes`, `previousSibling`,
  `nextSibling`, `attributeName`, `attributeNamespace`, `oldValue`.
- **Single-pass DFS** with a `visited` set per tick, so overlapping records do not walk the same
  subtree twice (otherwise O(N²)).

### 7.5 What Gemini missed, and we need

- **Pierce.** Its model is a single document. We require shadow roots and iframes:
  `addScriptToEvaluateOnNewDocument` must reach sub-frames, and each pierced document needs its own
  observer pushing into **one** emitter. "Single pass" becomes "single pass per observed root, one
  buffer".
- **The dirty `Set<Node>` needs a bound.** Gemini justifies a strong `Set` (WeakSet is not iterable)
  with "cleared every tick, no leak". The hole: under rate degradation (5 Hz) or a hidden client
  (1 Hz) the set holds nodes for up to a second — **including nodes the site already removed**, pinning
  detached subtrees. At 100 sessions that is a real leak vector. Needs `MAX_DIRTY_NODES` → forced
  flush, in the same family as the §7 limits.
- **Its phase 2 (hydrate before topology) is redundant for us.** That phase exists because its
  `CREATE_ELEMENT` carries only the tag. Our `NODE_NEW` carries the full descriptor, so the node is
  **born hydrated and detached** — we get the benefit without the extra pass.

---

## 8. Repository state — facts the next agent needs

**Three code trees exist. Production still runs the old one.**

| Tree | State |
|------|-------|
| `Refactor/sidecar/browser/patchright/mirror/page/` | The spec'd core (`PageProjection.ts`, `frame.ts`, `clock.ts`, `channel.ts`, `node/mirror.ts`) — **imported only by unit tests**, i.e. dead. Plus the `*Live` path (`liveAttach.ts` 618 LOC, `establishLive`, `emitLive`, `cdpLive`, `assetsLive`, `cssomLive`, `inpageScript*`). |
| `Refactor/sidecar/browser/mirror/projection/` | **Greenfield**, hand-driven, lab-only (`host/` is empty). Structure: `client/`, `host/`, `inject/`, `lab/`, `models/`, `plane/`, `virtual/`. |
| Production entry | `PatchrightBrowserSession.ts:50` still imports `LivePageProjection` from `./mirror/page/liveAttach`. |

Critically: in the old production path, **`frame.ts` (the net-effect coalescing) is not imported by
`liveAttach.ts` or `emitLive.ts`** — `emitLive.ts:325 absorbDirtyFromTick` only unions dirty id sets.
The coalescing was implemented, unit-tested, and never connected. That is why the old engine showed
neither the bug fixes nor the performance gain.

**What exists and works:**

- Oracles: `Refactor/page-projection-oracles/` — `o1-visual.cjs`, `o2-structural.cjs`, `o3-budgets.cjs`,
  `o4-density.cjs`, `o5-interaction.cjs`, `budgets.cjs`, `dual-run-compare.cjs`, `MATRIX.md`.
- Lab: `npm run lab:projection` and `npm run smoke:projection-lab`; fixtures `demo.html`,
  `static-dom.html`, `mutation-churn.html`, `forms-state.html`, `scroll.html`.
- Telemetry, expanded during the append hunt — default-on: `desynced` (with `errorCode`+`phase`+seq),
  `applyOverrun`, `clockStalled`/`rateChanged`, `handoff`. Debug pack: `frameDecision` (parent, mode,
  existing/fresh, `prevCount`, `appendFromEmpty`), `parityFingerprint` (title/h1/tags/anchors +
  `duplicateH1`/`duplicateTitle`), `applyDecision`, `encoder`.

**Known open problems not yet fixed:**

1. **The smoke records fingerprint divergence in DIAG but does not fail on it.** That is
   "protocol green while the surface is wrong" rebuilt with extra steps. It must fail.
2. **`parityFingerprint` is fixture-specific** (`duplicateH1` only works because the fixture has one
   `h1`). The generalizable form is the rolling structural checksum — which the table model now
   provides for free.
3. **Two unaligned clocks.** Virtual `t` and client `t` are `performance.now()` from different
   processes, so lag is a guess — **P3 and P5 are currently unmeasurable**, two of the seven parity
   budgets.
4. **`nodeCount` 11 vs 13** between runs on the same fixture — the establish×mutation race. It is
   `PP-EST-3`, and `mutation-churn.html` is the ready-made testbed. (May become moot if §7.1 lands.)

---

## 9. Pending edits to `frame-protocol.md` — WRITTEN, see §13

Everything in this section was written into `frame-protocol.md` in the session at §13. Kept here for
the record of what was agreed and when it landed; do not re-derive these from scratch.

| Section | Change | Landed as |
|---------|--------|-----------|
| §1.2 | id 1 = **Document**, not `<html>`. `<html>` becomes an ordinary row. Doctype projected. Test-matrix needs a quirks-mode row (still to add to `test-matrix.md`). | `frame-protocol.md` §1.2, `DOCTYPE` kind in §1.3/§4.2 |
| §4.3 | `INSERT` emission becomes **post-order**, replacing the obsolete ancestor-first dependency rationale. | `frame-protocol.md` §5.5 |
| §7 (limits) | Add `MAX_DIRTY_NODES`. | `frame-protocol.md` §8 (renumbered) |
| OPEN-2 | Close: end-of-tick decision, removed × re-inserted. `lms` stays diagnostics-only. | `frame-protocol.md` §5.6, marked **leaning closed** in §10 — still needs explicit sign-off |
| OPEN-4 | Superseded, not reformulated — see §13: establish does not exist at all, not even for cold start. | `frame-protocol.md` §4.7, closed as moot in §10 |
| new section | **Frame construction** (producer side): buffer → visited set → single-pass DFS → post-order emission → deferred GC. Absorbs `contracts/03-frame.md` / `implementation/sidecar/frame.md`, which are now dead files pending deletion (§1). | `frame-protocol.md` §5 |

The **table row serialization format** (`EST_TABLE` descriptor) mentioned here previously is now
irrelevant — there is no `EST_TABLE`, see §13.

---

## 10. The question that was on the table — SUPERSEDED, see §13

The conversation stopped here, unanswered:

> **Should the frame-construction section be written assuming the no-establish model (§7.1), or should
> both variants be written side by side so the choice can be made after measuring?**

The no-establish model is the one that changes the most: it deletes an already-specified section
(establish↔live handoff), changes the shape of OPEN-4, and removes `speculum-anchor` from the wire
entirely. It should not be adopted on argument alone — the measurement is
`table → HTML string → native parser` versus `table → createElement` at ~20k nodes, and the lab can
answer it in an afternoon.

**This question is now moot — not because it was measured, but because Rodrigo went further than
either branch on the table (§13): establish does not exist at all, in any form, for any case.** No
measurement was run; §13 records why the decision did not need one.

---

## 11. Constraints and budgets still in force

From `engine-redesign.md`, **not** superseded by this debate:

**K1** no pixel/video streaming in PageProjection, ever (media is bytes via the virtual-assets plane,
played by the client's own engine) · **K2** session state never shared, with the single exception of
credential-less public byte content deduplicated in a shared L2 asset tier under the §5.12.2
predicate · **K3** ≥100 concurrent sessions without degradation · **K4** absolute 1:1 parity ·
**K5** site JavaScript only in the Virtual Chromium.

**Out of scope, ruled by Rodrigo:** egress identity, per-session IPs, TLS/connection behaviour
between sessions. Do not reopen.

Budgets P1–P7 (parity, measured as a **delta against the Virtual page**) and E1–E11 (engine). The two
that constrain this protocol most: **E3/E4** ≤10 µs producer/client CPU per operation, and **E5**
≤100 µs per-frame pipeline overhead. These are what rejected the ISA and what forbid an O(n) table
hash.

---

## 12. Process lessons that produced the current way of working

1. **Seal invariants, not mechanisms.** The 2026-08-06 seals specified `querySelectorAll(...).length
   === 1`, identity-as-attribute, and one-record-one-envelope. Sealing mechanisms made O(nodes) per
   operation a *contract requirement*.
2. **Cost is a feature.** The earlier contract contained no cost number and said outright
   "correctness ≠ capacity (perf track separate)". The implementation delivered exactly that.
3. **Parity is perceptual, not structural.** A byte-identical tree that arrives 8.7 s late has failed.
4. **What is not asserted will regress.** Every green metric measured the pipe; none measured the
   product.
5. **A complete document is not enough.** A large spec handed over with "implement it" produced ~290 KB
   of further specification and a work order declaring the code "NOT STARTED". The work unit must be
   small and verifiable by a test — one `PP-*` at a time, with the test output as the proof.

---

## 13. This session — establish is deleted, frame construction is written

**Date:** 2026-08-13, same-day continuation. Rodrigo ran a second, independent Gemini thread (not the
one in §7) walking through `MutationObserver` mechanics, opcode categories, and single-pass DFS
construction from first principles, then brought the transcript here with one explicit ruling:

> "Não existe mais isso de 'establish'. Isso morreu. O que existe são frames, apenas. Pra caso de
> resync, é um fluxo separado que vamos definir depois. [...] Os opcodes podem carregar a construção do
> site inteiro, ou local (um patch); mas tudo agora vira opcode."

### 13.1 What this decides — and what it does not

This is **not** the no-establish model of §7.1 (which still kept `EST_TABLE` alive for resync/attach).
It goes further: **no establish opcode range exists at all, for any case, cold start included.**
`0xC0–0xDF` is reserved, undefined. `§10`'s pending measurement (`EST_CHUNK_HTML` vs `EST_TABLE`) is
therefore **moot, not answered** — there was nothing left needing a number once both branches of that
choice were deleted. This was a ruling, not an argument won by evidence; recorded as such, not dressed
up as a measurement result it never was.

**What it explicitly does not decide:** how a client attaches to a page whose parser already ran before
the observer did, or how a desynced client recovers. Both require *something* that is not "replay every
frame since generation 0" — an authoritative snapshot mechanism of some kind, undesigned. This is opened
as **OPEN-5** in `frame-protocol.md` §10, not left implicit. Until it is designed, a session is only
observable from navigation start, and desync is unrecoverable (dead session, not degraded one). This is
a real product gap, not a documentation nit — flagging it is required by this repo's rule against silent
gaps (`docs/page-projection/spec/acceptance.md`), not optional caution.

### 13.2 The Gemini thread — cross-checked against the existing debate, not new territory

Nearly everything in the second thread **independently re-derived material already decided** in this
same document (§3, §7):

| Second thread's claim | Already decided at | Verdict |
|---|---|---|
| 3 opcode categories: memory (create/destroy), state (attrs/props), topology (structural) | `frame-protocol.md` §3 opcode ranges (`0x20–0x3F` table, `0x60–0x7F` node state, `0x40–0x5F` structure) | **Confirms**, does not add. |
| `MutationObserver` at `document-start`: `documentElement` null, first callback batches DocumentType/html/head/body, `target === document` | §7.4 (this doc) | **Confirms.** Used directly in `frame-protocol.md` §5.1. |
| `addedNodes` does not fire for descendants of a subtree inserted whole — must walk recursively | §7.4 "the `addedNodes` trap" | **Confirms.** `frame-protocol.md` §5.4. |
| Node reuse via a single move instruction instead of destroy+recreate | §7.4 "node reuse is extremely common" | **Confirms.** But its `OP_MOVE_NODE` as a *separate opcode* contradicts **P6** ("one way to say one thing" — an `INSERT` of an attached node moves it). **Not adopted as a new opcode**; folded into `INSERT`, §5.5. |
| Deferred deletion, decided at end of frame/tick | §7.4 "deferred GC" | **Confirms.** `frame-protocol.md` §5.6. Leans **OPEN-2** closed by independent double-derivation — still needs explicit sign-off, not sealed on that basis alone. |
| Single-pass DFS, post-order connect ("bottom-up OpCodes") | §7.2 (this doc, from the *first* Gemini thread) | **Confirms**, same conclusion reached a second, independent way. `frame-protocol.md` §5.5. |
| Separate "hydrate" phase (create bare, then `SET_ATTR`) | — | **Not adopted.** `NODE_NEW` already carries the full descriptor (§7.5 "born hydrated" — this was already known to be redundant for us before this session). |
| Buffer drains in observer-delivery order, no re-sort needed for top-down | — | **New, small, correct.** Not previously stated this precisely; written into `frame-protocol.md` §5.5 ("discovery order is naturally top-down"). |

**Net effect:** the second thread served as an independent check on decisions already made, plus the
one explicit ruling in §13.1. It did not open new design surface beyond the establish deletion and the
recovery deferral.

### 13.3 What landed where

All of the above is now in `frame-protocol.md`:

- §1.2 — id `1` = Document (not `<html>`); `<html>` an ordinary row. Was agreed at §7.3, never written
  until now.
- §1.3 / §4.2 — `DOCTYPE` node kind, closing the quirks-mode gap from §7.3.
- §4.7 — establish deleted; the gap called out explicitly, not smoothed over.
- §5 (new) — frame construction: install point, buffer/tick, visited set, `addedNodes` walk, single-pass
  DFS with reuse-as-one-`INSERT`, post-order connect, deferred deletion, identity map.
- §8 — `MAX_DIRTY_NODES` added to mandatory limits (was agreed, unwritten, per old §9).
- §10 — OPEN-2 leaning closed (needs sign-off), OPEN-4 closed as moot, OPEN-5 opened for the deferred
  recovery flow.
- `contracts/03-frame.md` and `implementation/sidecar/frame.md` are now dead — their valid content is
  absorbed into `frame-protocol.md` §5. **Not deleted in this pass** — file deletion needs your
  confirmation, not just design sign-off, since both are still-tracked files outside this doc.

### 13.4 Still needs your ruling

1. Confirm **OPEN-5's scope is acceptable as a deferred, explicit gap** for now (no session
   recovery/resync, no mid-session attach) rather than something to design before continuing elsewhere.
   — **Superseded by §14: OPEN-5 is now designed, not deferred.**
2. Confirm **OPEN-2 closure** (§5.6 end-of-tick rule) so it can be sealed rather than left "leaning".
3. Confirm deletion of `contracts/03-frame.md` and `implementation/sidecar/frame.md` now that their
   content is absorbed, or say if anything in them still needs a second look first.
4. OPEN-1 and OPEN-3 remain open from before this session and are unaffected by it.

---

## 14. Same-day continuation — resync designed, closes OPEN-5

Rodrigo, same day, ran a third independent thread (Gemini) walking through the resync mechanism from
first principles, starting from two invariants he stated explicitly:

1. **The observer is installed before the parser runs (CDP init script).** The Virtual index is never
   catching up to a missed state — this is why cold start needs no establish (§13) and, as it turns out,
   why resync needs no separate "initial state" concept either.
2. **Frames are "dumb and linear" — no branch anywhere keyed on what a node is or when in the
   lifecycle a mutation happened.** The same code produces the first frame of a session, the frame after
   ten thousand mutations, and a resync frame. Written into `frame-protocol.md` as **P8**.

### 14.1 The design, and why it fully closes OPEN-5 (not half of it)

Resync is a **canonical frame** — same `sequence` counter, same opcodes (`NODE_NEW`/`INSERT`/`CHECK`),
distinguished only by a header flag, not a different wire shape. Construction is two linear passes over
the producer's **identity map** (`Map<id, Node>` on the Virtual side) — never a recursive DOM walk:

1. Halt frame emission (not mutation recording — the buffer keeps collecting, §5.2 already handles this
   with zero new machinery).
2. Pass 1: for every indexed node, if `!node.isConnected` drop it (bonus GC, ties into **OPEN-2**);
   otherwise emit `NODE_NEW` read **fresh from the live node**, not from any cached row — self-healing
   against a producer-table bug.
3. Pass 2: for every surviving node, emit `INSERT` from its **native** `childNodes` order. Rodrigo asked
   whether the identity map should also cache child-id lists to avoid this read; the answer, confirmed by
   this thread and consistent with why the Virtual side needs no row-table at all (§5.8), is **no** — that
   would tax every ordinary frame to save time on an event that is rare by construction. The **client's**
   replicated table still needs `parent`/`prevSibling` as data (§1.3), because the client has no live DOM
   to read from during phase 1 (§6); the Virtual producer does, and should use it.
4. Close with a whole-table `CHECK` — reuses the existing opcode, no new "resync-end" instruction.

**Why this closes both triggers with one mechanism, not two:** a newly attaching client's prior state is
the empty table. Sending it a resync frame as its first frame is not a special onboarding path — it is
the same instruction defined for desync recovery, with a trivial starting point. This is **P8** applied
to the open item itself, not just to the algorithm it describes.

**Ids survive resync unchanged** — no `generation` bump, no reallocation, which is exactly why `resync`
had to be a header bit distinct from `EPOCH_RESET` rather than dressed up as one: `EPOCH_RESET` says
"nothing carries forward"; `resync` says "same generation, wholesale replace." An id missing from a
resync frame stops existing without needing a `NODE_DROP` per id — the frame *is* the new table.

### 14.2 What this superseded, and what still needs a look

- **`contracts/07-recovery.md` is now fully dead**, not just stale: its Node mirror, HTML serialize,
  `speculum-anchor`, and the `establishBegin/establishChunk/establishEnd` triad it specified for the
  resync response are all gone. Its desync-trigger list (§PP-REC-1: id unresolved, sequence gap,
  generation mismatch, missing part, decode error, checksum mismatch) is **not** superseded — only the
  *response* mechanism is.
- **`contracts/08-surface.md`'s double buffer is reused as-is** — this thread did not need to touch the
  surface/iframe mechanism at all, only its swap-trigger wording (`establishEnd` → "this frame's `CHECK`
  verifies OK").
- **One real open budget question, not yet answered:** the two-pass walk must run as a single
  synchronous JS turn to avoid tearing against the site's own concurrent mutations (this falls out of
  JS run-to-completion semantics for free, no design needed) — but nobody has budgeted how long that
  walk is allowed to take at `MAX_ROWS` scale, or what happens if it doesn't fit in one turn. None of
  `engine-redesign.md`'s `E3`–`E5` cover a one-off bulk operation; this needs either a new `E`-number or
  an explicit decision that resync is exempt from steady-state budgets. **Flagged, not solved.**
- `test-matrix.md`'s `PP-REC-*` (and the now-dead `PP-EST-3`) need re-authoring against opcodes instead
  of HTML/byte-checksums — not done in this pass.

### 14.3 Still needs your ruling

1. Confirm the resync design in `frame-protocol.md` §5.8 as sealed, or flag anything that reads as
   argument-only rather than settled.
2. Rule on the synchronous-walk budget question (§14.2) — a number, or an explicit "exempt from E3–E5,
   revisit at implementation".
3. Authorize deleting `contracts/07-recovery.md` (superseded) alongside the two files already queued in
   §13.4.3, and confirm the one-line `contracts/08-surface.md` wording fix.
