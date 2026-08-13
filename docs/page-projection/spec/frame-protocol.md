# PageProjection — frame protocol

**Status:** **DRAFT — in definition.** Sections marked **DECIDED** are settled; **OPEN** items are in
§9 and MUST NOT be implemented until resolved.
**Scope:** the replicated state (§1), the frame that carries changes to it (§2–§4), and how it is
applied (§5–§8).
**Relationship:** supersedes §5.4 (operation vocabulary) and §5.5 (wire format) of
[engine-redesign.md](engine-redesign.md) once sealed. Budgets (§2),
constraints (K1–K5), oracles (§7) and the test matrix (§8) of that document remain in force and are
**not** restated here.

**Related:** [engine-redesign.md](engine-redesign.md) ·
[acceptance.md](acceptance.md) ·
[cssom.md](cssom.md) ·
[input.md](input.md) · [naming.md](../../naming.md)

---

## 0. Principles

A change that violates one of these is a redesign, not a tweak.

**P0 — The table is the replicated structure; the DOM is a projection of it.**
Virtual: the site mutates the real DOM → the MutationObserver records it → **we update our table** →
we emit the frame describing the table delta. Client: the frame arrives → **it updates its table** →
the DOM is materialized as a consequence. Both sides apply the same frame to the same starting state,
so the tables are identical by construction. The producer never holds a *belief* about client state —
it holds a *copy*.

**P1 — Instructions are self-contained, not declarative.** Every operand is explicit; no cursor, no
register, no implicit machine state. This keeps an instruction dump readable without a disassembler —
the property that allowed the append defect to be named from telemetry alone.

**P2 — The frame-level precondition licenses non-idempotent instructions.** `INSERT`, `REMOVE`,
`NODE_DROP`, `SHEET_DROP` and `RULE_DROP` are not idempotent. They are safe **only** because the frame
header carries `preTableHash` and the client refuses to apply on mismatch. **Removing the precondition
re-creates the defect class.** One design, not two features.

**P3 — Two phases: table, then materialization.** Phase 1 verifies and mutates the table — pure
memory, no DOM. Phase 2 reflects changed rows into the DOM and cannot fail. If phase 1 fails, the DOM
was never touched.

**P4 — Phase is a fixed property of the opcode.** The decoder partitions instructions by phase
without semantic analysis.

**P5 — Fixed-width operands over compact encoding.** Ids are `u32`, counts `u16`, lengths `u32` — no
varints on the hot path. This follows the measured constraint: the binding budget is **CPU per
operation (E3/E4)**, not bytes. Decode must be a table dispatch over aligned reads.

**P6 — One way to say one thing.** No `MOVE` (an `INSERT` of an attached node moves it), no `REPLACE`
(the MutationObserver has no such record type).

**P7 — Strict over tolerant.** Malformed input desyncs. Unknown opcodes desync. Out-of-range values
desync. Silent tolerance hides encoder defects.

---

## 1. The replicated state — DECIDED

Two replicated structures, both maintained identically on Virtual and client.

### 1.1 Structures

| Structure | Contents | Mutability |
|-----------|----------|------------|
| **Node table** | every projected node, stylesheet and CSS rule | mutable |
| **String table** | interned strings referenced by instructions | **append-only** |

There is **one node table** and **one id space**. Stylesheets and rules are rows in it, distinguished
by `kind`. An id therefore never means two different things, and one hash covers the whole state.

Internal storage may be split per kind or otherwise optimized — that is implementation. The contract
is: one id space, one logical table, one hash.

### 1.2 Id space

| Id | Meaning |
|----|---------|
| `0` | **none / absent** — never a valid row |
| `1` | **document root** — the projected `<html>`; exists for the lifetime of a generation |
| `2 …` | allocated monotonically by the producer |

Ids are allocated **only** by the producer and are never reused within a `generation`. On
`EPOCH_RESET` both tables are cleared and allocation restarts at `2`.

### 1.3 Node row

| Column | Type | Meaning |
|--------|------|---------|
| `id` | `u32` | key |
| `kind` | `u8` | `ELEMENT`=1, `TEXT`=2, `COMMENT`=3, `SHEET`=4, `RULE`=5 |
| `parent` | `u32` | `0` when detached; for `RULE` the owning `SHEET`; for `SHEET` the pierce host or `0` |
| `prevSibling` | `u32` | `0` when first child |
| `name` | `StrRef` | `ELEMENT`: tag. `SHEET`/`RULE`: unused (`0`) |
| `value` | `StrRef` | `TEXT`/`COMMENT`: character data. `RULE`: rule text. Otherwise `0` |
| `attrs` | map `StrRef → StrRef` | `ELEMENT` only |
| `props` | map `u8 → scalar` | `ELEMENT` only — §4.4 `PROP_SET` |
| `flags` | `u16` | §4.2 `NODE_META` |
| `lms` | `u32` | frame `sequence` at which this row was last touched |
| `rowHash` | `u64` | derived, §1.5 |

### 1.4 Topology

Order is represented by **`parent` + `prevSibling`** only. Those two columns uniquely determine the
tree: within a parent, `prevSibling = 0` is the first child and the chain from there is determined.

**Why not a positional index.** If sibling position were an integer column, inserting into the middle
of a list would renumber every following sibling and rehash each of them — O(n) per insert on a long
list, which is exactly the live-odds shape. With `prevSibling`, inserting X between A and B changes
**two** rows (X, and B's `prevSibling`). Removing X changes two. Appending changes one plus the new
row. O(1) in all cases.

Implementations MAY keep derived links (`firstChild`, `lastChild`, `nextSibling`, child count) for
O(1) navigation. Derived links are **not** hashed and are not part of the contract.

**CSSOM uses the same model.** A `RULE`'s parent is its `SHEET` and its `prevSibling` is the previous
rule; a `SHEET`'s parent is its pierce host (or `0` for document scope) and its `prevSibling` is the
previous sheet in cascade order. One topology model covers both planes.

### 1.5 Hashing

```
rowHash  = H64( id, kind, parent, prevSibling, contentHash )
tableHash = Σ rowHash   (mod 2^64, over all rows)
```

`contentHash` is a commutative combine over the row's content: `name`, `value`, each `(attrName,
attrValue)` pair, each `(propId, propValue)` pair, and `flags`. Attribute order is not hashed —
attribute order is not semantic for rendering, and commutativity makes `ATTR_SET` order-independent.

**Update is O(1):** `tableHash += newRowHash − oldRowHash` (mod 2^64). A table hash recomputed in
O(n) per frame does not meet **E5** and is a contract violation, not an optimization choice.

Addition is used rather than XOR: XOR cancels on duplicate row hashes. Ids are unique so duplicates
cannot occur, but addition removes the class entirely at no cost.

`lms` is **not** hashed — see §1.6.

### 1.6 `lms` — role

`lms` is **not** the coherence mechanism. `preTableHash` verifies the entire table before every frame,
which is strictly stronger than any per-row check; per-row versioning adds nothing to safety and is
therefore not a precondition on any instruction.

It is retained, at 4 bytes per row, for:

1. **Diagnostics** — "this row last changed at frame N" localizes divergence during debugging.
2. **Garbage collection** — a detached row whose `lms` is older than a threshold is a producer leak
   (see **OPEN-2**).

This is a deliberate change of role. `lms` was originally proposed as the verification mechanism; the
table model made the table hash strictly better at that job. Keeping the mechanism *and* its original
justification would be cruft.

### 1.7 String table

Attribute names and repeated values recur across every frame of a session. Re-sending them per frame
is waste that grows with session length.

| Kind | Lifetime | Defined by |
|------|----------|------------|
| **Persistent** | session, until `EPOCH_RESET` | `STR_DEF` (§4.1) |
| **Frame-local** | one frame | the frame's `strings` array |

`StrRef` is a `u32`:

| Bit 31 | Meaning |
|--------|---------|
| `0` | persistent string id (`0` = none/empty) |
| `1` | index into this frame's `strings` array (low 31 bits) |

The producer interns anything it expects to repeat (tag names, attribute names, class values, URLs)
and uses frame-local for one-shot content (text node values).

**The string table is append-only and immutable**: once defined, a string id never changes meaning.
It therefore cannot diverge by mutation. A lost `STR_DEF` is caught the first time an instruction
references an undefined id — `malformed`, per **P7**. No separate hash is required.

### 1.8 Memory budget

~20k rows × ~64 B ≈ **1.3 MB** per side, against the **E7** mirror budget of 4 MB. The persistent
string table for a typical page is a few thousand entries.

---

## 2. Frame header — DECIDED

```
magic         u16   'PP'
version       u8    unknown ⇒ desync, never best-effort parse
flags         u8    bit0 establish · bit1 resync
generation    u32
sequence      u32
partIndex     u16   0-based
partCount     u16   1 when not split
preTableHash  u64   expected tableHash before applying; unchecked when establish|resync
strCount      u32
strings       [ byteLen u32, bytes UTF-8 ] * strCount      // frame-local, per part
opCount       u32
ops           [ opcode u8, operands ] * opCount
```

Little-endian throughout.

**Precondition placement.** `preTableHash` is a header field, not an instruction, so there is no
"what if the precondition instruction is missing" failure mode.

**Part splitting.** All parts share `generation` and `sequence` and differ by `partIndex`. The client
buffers parts and applies the assembled frame as **one** transaction when `partIndex == partCount − 1`
arrives. A missing part ⇒ desync. Atomicity is never split. Frame-local strings are per part;
`StrRef` frame-local indices are resolved against the part that carries the instruction.

---

## 3. Opcode space — DECIDED

| Range | Domain |
|-------|--------|
| `0x00` | **permanently invalid** — catches zero-filled buffers |
| `0x01–0x1F` | frame control |
| `0x20–0x3F` | table |
| `0x40–0x5F` | structure |
| `0x60–0x7F` | node state |
| `0x80–0x9F` | document / viewport |
| `0xA0–0xBF` | CSSOM |
| `0xC0–0xDF` | establish / recovery |
| `0xE0–0xFE` | reserved |
| `0xFF` | **permanently invalid** — catches `0xFF`-filled buffers |

Both sentinels are deliberate: memory filled with `0x00` or `0xFF` is the commonest corruption pattern
and must fail immediately rather than decode as valid. An opcode in a **reserved** range reports
`version_skew`, not `malformed` — it is almost always a stale peer.

---

## 4. Instruction set — DECIDED

Notation: `Pre` = preconditions (violation ⇒ `precondition` failure unless stated).
`Table` = phase-1 effect. `DOM` = phase-2 effect. Every instruction that touches a row sets that
row's `lms = sequence` and updates `rowHash`/`tableHash`; this is not repeated per instruction.

### 4.1 Frame control

**`0x01 CHECK`** — `scope: u8, lo: u32, hi: u32, hash: u64` · phase 1 · idempotent
`scope`: `0` = whole table (`lo`/`hi` ignored), `1` = id range `[lo, hi]`.
`Pre`: the computed hash over the scope equals `hash`, else `precondition`.
`Table`: none. `DOM`: none.
A frame containing only a `CHECK` is a reconciliation heartbeat.

**`0x02 EPOCH_RESET`** — `generation: u32` · phase 1 · idempotent
`Pre`: MUST be the first instruction of the frame.
`Table`: clears the node table and the persistent string table; id allocation restarts at `2`; row `1`
is recreated empty. `DOM`: the surface is discarded (a new document buffer is prepared — §5).

**`0x03 STR_DEF`** — `strId: u32, byteLen: u32, bytes: u8[]` · phase 1 · idempotent
`Pre`: `strId` has bit 31 clear; `strId` is undefined, **or** defined with identical bytes
(re-definition with different bytes is `malformed`). `byteLen ≤ MAX_STR_BYTES`.
`Table`: interns the string. `DOM`: none.

**`0x04 NOP`** — no operands · no phase · idempotent

### 4.2 Table

**`0x20 NODE_NEW`** — `id: u32, kind: u8, descriptor` · phase 1 · idempotent¹
`descriptor` by `kind`:
- `ELEMENT`: `name: StrRef`, `attrCount: u16`, `[(nameRef: StrRef, valRef: StrRef)] * attrCount`
- `TEXT` | `COMMENT`: `value: StrRef`
- `SHEET`: `flags: u16`
- `RULE`: `value: StrRef`

`Pre`: `id ≥ 2`; `kind` is a defined value; every `StrRef` resolves; `attrCount ≤ MAX_ATTRS`.
¹ `id` already existing with an **identical** descriptor is a no-op; with a different descriptor it is
`malformed`.
`Table`: inserts a row with `parent = 0`, `prevSibling = 0` — **detached**.
`DOM`: none. Materialization happens on `INSERT`.

**`0x21 NODE_DROP`** — `count: u16, ids: u32[]` · phase 1 · **not idempotent**
`Pre`: every id exists; every id has `parent = 0` (detached). Dropping an attached row is
`precondition` — the producer must `REMOVE` first, which keeps detachment explicit and auditable.
`Table`: drops each row **and all its descendants** (a detached row may still have children).
`DOM`: none — the subtree is already detached.
See **OPEN-1** for the absent-id case.

**`0x22 NODE_META`** — `id: u32, flags: u16` · phase 1 · idempotent
`Pre`: `id` exists.
`flags`: `PLACEHOLDER`=0x01, `SHADOW_HOST`=0x02, `SHADOW_CLOSED`=0x04, `IFRAME_HOST`=0x08,
`PIERCE_ROOT`=0x10, `CANVAS_PLACEHOLDER`=0x20.
`Table`: replaces `flags` wholesale (not a bitwise merge — replacement is idempotent).
`DOM`: reflects the corresponding `speculum-*` marker attributes.

### 4.3 Structure

**`0x40 INSERT`** — `parent: u32, before: u32, count: u16, ids: u32[]` · phase 1+2 · **not idempotent**
`Pre`:
- `parent` exists and `kind` is `ELEMENT` (or row `1`);
- `before` is `0` (insert at end) **or** an existing row whose `parent` equals `parent`;
- every id exists and is distinct within the instruction;
- **no id is `parent` or an ancestor of `parent`** — cycle prevention;
- `count ≤ MAX_CHILDREN_PER_OP`.

`Table`: for each id in order, unlinks it from its current parent if attached, then links it before
`before` (or at the end). Updates `prevSibling` of the moved node and of the node that followed it —
two row hashes per link, not O(children).
`DOM`: `parent.insertBefore(node, beforeNode)`. An already-attached node is **moved**, preserving
media playback, focus and scroll inside its subtree.

**`0x41 REMOVE`** — `parent: u32, count: u16, ids: u32[]` · phase 1+2 · **not idempotent**
`Pre`: `parent` exists; every id exists and its `parent` equals `parent`.
The `parent` operand is redundant with the table and is kept as a cheap assert — disagreement is
`precondition`, which catches divergence one frame earlier than it would otherwise surface.
`Table`: unlinks each row (`parent = 0`, `prevSibling = 0`) and repairs the `prevSibling` of the
following sibling. Rows survive detached until `NODE_DROP`.
`DOM`: removes the node from its parent. Descendants remain attached to the removed row.

### 4.4 Node state

**`0x60 ATTR_SET`** — `node: u32, count: u16, [(nameRef: StrRef, valRef: StrRef)] * count` · 1+2 · idempotent
`Pre`: `node` exists, `kind = ELEMENT`; all refs resolve; `count ≤ MAX_ATTRS`.
`Table`: sets each pair in `attrs`. `DOM`: `setAttribute`.

**`0x61 ATTR_DEL`** — `node: u32, count: u16, nameRef: StrRef[]` · 1+2 · idempotent
`Pre`: `node` exists, `kind = ELEMENT`; refs resolve. Deleting an absent attribute is a **no-op**, not
a failure — absence is the requested end state.
`Table`: removes the keys. `DOM`: `removeAttribute`.

Separate from `ATTR_SET` because **the empty string is a legitimate attribute value**
(`<input value="">`); a sentinel value for deletion would be wrong.

**`0x62 TEXT_SET`** — `node: u32, value: StrRef` · 1+2 · idempotent
`Pre`: `node` exists, `kind ∈ {TEXT, COMMENT}`; ref resolves.
`Table`: sets `value`. `DOM`: sets `data`.

**`0x63 PROP_SET`** — `node: u32, propId: u8, value` · 1+2 · idempotent
`Pre`: `node` exists, `kind = ELEMENT`; `propId` defined; `value` matches the type for `propId`, else
`malformed`.

| `propId` | Name | Value type |
|----------|------|-----------|
| `0x01` | `VALUE` | `StrRef` |
| `0x02` | `CHECKED` | `u8` bool |
| `0x03` | `SELECTED` | `u8` bool |
| `0x04` | `DIALOG_MODAL` | `u8` bool |
| `0x05` | `POPOVER_OPEN` | `u8` bool |
| `0x06` | `MEDIA_PAUSED` | `u8` bool |
| `0x07` | `MEDIA_TIME` | `f32` |
| `0x08` | `MEDIA_MUTED` | `u8` bool |
| `0x09` | `MEDIA_VOLUME` | `f32` |
| `0x0A` | `CUSTOM_VALIDITY` | `StrRef` |

`Table`: sets `props[propId]`. `DOM`: applies as a **property**, not an attribute — `DIALOG_MODAL`
calls `showModal()`/`close()`, `POPOVER_OPEN` calls `showPopover()`/`hidePopover()`,
`CUSTOM_VALIDITY` calls `setCustomValidity()`.

Separate from `ATTR_SET` because this state is *published* as a `speculum-*` attribute but *applied*
as a property; collapsing them would force the client to infer which is which. Tag/property
compatibility is the producer's responsibility and is not verified.

**`0x64 NODE_SNAPSHOT`** — `node: u32, descriptor` · 1+2 · idempotent
`Pre`: `node` exists; `descriptor` matches the row's `kind`.
`Table`: replaces the row's entire local state (`name`, `value`, `attrs`, `props`) — topology, `flags`
and `id` untouched.
`DOM`: reconciles the node's attributes and value to match.
This is the **per-node cure path**: emitted when a partial update would be unsafe, so one bad node does
not desync the session.

### 4.5 Document / viewport

**`0x80 DOC_STATE`** — `title: StrRef, lang: StrRef, dir: StrRef, viewport: StrRef` · 1+2 · idempotent
`0` in any field means unchanged.
`Table`: stored on row `1`. `DOM`: sets `document.title` and the root element's `lang`/`dir`.

**`0x81 SCROLL_VIEWPORT`** — `x: f32, y: f32` · phase 2 · idempotent — absolute position.

**`0x82 SCROLL_ELEMENT`** — `node: u32, top: f32, left: f32` · phase 2 · idempotent
`Pre`: `node` exists. Absolute position.

Scroll is phase 2 only: it is viewport state, not replicated table state, and is therefore excluded
from `tableHash`.

### 4.6 CSSOM

Sheets and rules are rows (§1.3), so their topology instructions are the structural ones. These
opcodes exist because their **materialization** differs — owned CSSOM objects rather than DOM nodes.

**`0xA0 SHEET_NEW`** — `id: u32, scope: u8, hostNode: u32, before: u32` · phase 1+2 · idempotent
`scope`: `MAIN`=0, `PIERCE_HOST`=1 (with `hostNode`).
`Pre`: `id` unused or identical; when `scope = PIERCE_HOST`, `hostNode` exists.
`Table`: creates a `SHEET` row with `parent = hostNode` (or `0`) and links it before `before`.
`DOM`: constructs an owned stylesheet and adopts it under the correct scope (CSSOM C7).

**`0xA1 SHEET_DROP`** — `count: u16, ids: u32[]` · phase 1+2 · **not idempotent**
`Pre`: every id exists and `kind = SHEET`.
`Table`: drops the sheet rows and their rule rows. `DOM`: un-adopts and releases the sheets.

**`0xA2 SHEET_ORDER`** — `count: u16, ids: u32[]` · phase 1+2 · idempotent
`Pre`: every id exists, `kind = SHEET`, same scope.
`Table`: rewrites the `prevSibling` chain for that scope to the given order.
`DOM`: reorders the adopted list. Declarative — the full order for that scope.

**`0xA3 RULE_NEW`** — `sheet: u32, id: u32, before: u32, text: StrRef` · phase 1+2 · idempotent
`Pre`: `sheet` exists and `kind = SHEET`; `before` is `0` or a rule of that sheet.
`Table`: creates a `RULE` row parented to `sheet`. `DOM`: `insertRule` at the resolved index.

**`0xA4 RULE_DROP`** — `sheet: u32, count: u16, ids: u32[]` · phase 1+2 · **not idempotent**
`Pre`: every id exists, `kind = RULE`, `parent = sheet`.
`Table`: drops the rows. `DOM`: `deleteRule`.

**`0xA5 RULE_SET`** — `id: u32, text: StrRef` · phase 1+2 · idempotent
`Pre`: `id` exists, `kind = RULE`.
`Table`: sets `value`. `DOM`: updates the rule **in place** — C3.1 forbids delete-and-reinsert for the
same locus, which would widen the repaint.

### 4.7 Establish / recovery

**`0xC0 EST_BEGIN`** — `generation: u32, viewportW: u32, viewportH: u32, scrollX: f32, scrollY: f32` · phase 1 · idempotent

**`0xC1 EST_CHUNK_HTML`** — `byteLen: u32, bytes: u8[]` · phase 2 · not idempotent — see **OPEN-4**.

**`0xC2 EST_TABLE`** — `rowCount: u32, rows[]` · phase 1 · idempotent — see **OPEN-4**.

**`0xC3 EST_END`** — `nodeCount: u32, tableHash: u64` · phase 1 · idempotent
`Pre`: the built table's row count and hash match, else `precondition` ⇒ desync.

A frame **MUST NOT** contain both `0xC1` and `0xC2`. The choice is a build/configuration decision,
never per-frame; the loser is deleted after measurement.

---

## 5. Execution model — DECIDED

| Phase | Work | On failure |
|-------|------|-----------|
| **1 — table** | verify `preTableHash`; apply all row mutations; evaluate `CHECK` | abort before touching the surface |
| **2 — materialize** | reflect changed rows into the DOM | cannot fail — already validated |

The client MUST complete phase 1 for the **entire assembled frame** before beginning phase 2.

**Virtual side.** The producer applies the same frame to its own table but performs **phase 1 only** —
the real DOM already mutated, which is what the MutationObserver reported.

**Invariant this creates.** The Virtual table is a projection of *what was sent*, not of *what the
Virtual DOM is*. If frame generation drops or deforms something, the client stays faithfully
synchronized to a falsehood. Two independent checks cover it:

| Check | Where | Cost |
|-------|-------|------|
| Virtual table × Virtual DOM | local to the sidecar | O(n), periodic |
| Virtual `tableHash` × client `tableHash` | on the wire (`preTableHash`) | **8 bytes**, every frame |

The second runs every frame. The first is what catches the producer lying.

---

## 6. Ordering within a frame — DECIDED

1. `EPOCH_RESET` first, if present.
2. `STR_DEF` before any instruction referencing that string id.
3. `NODE_NEW` before any instruction referencing that id.
4. `NODE_DROP` after every `REMOVE` of that node.
5. Establish opcodes only in a frame flagged `establish` or `resync` — **never** mixed with live
   instructions.
6. `CHECK` verifies the state at the point it appears.

`sequence` belongs to the **frame**. Within a frame, instructions have an **index**, not a sequence.
Per-instruction sequence would make the instruction the wire unit and discard the frame model.

---

## 7. Failure classes and limits — DECIDED

| Class | Cause | `errorCode` |
|-------|-------|-------------|
| **Malformed** | does not decode: truncated, opcode out of range, `count` overrunning the buffer, unresolvable `StrRef`, wrong operand type, conflicting redefinition | `malformed` |
| **Precondition** | decodes but violates state: unknown id, parent mismatch, cycle, hash mismatch | `precondition` |
| **Version skew** | opcode in a reserved range | `version_skew` |

Separate classes because they mean different bugs: malformed is the encoder or transport corruption;
precondition is state divergence; version skew is a stale peer.

**Mandatory limits**, checked **before any allocation**:

| Limit | Purpose |
|-------|---------|
| `MAX_STR_BYTES` | a corrupted length must never trigger a large allocation |
| `MAX_ATTRS` | per node and per instruction |
| `MAX_CHILDREN_PER_OP` | bounds `INSERT`/`REMOVE` |
| `MAX_OPS_PER_FRAME` | bounds decode work |
| `MAX_ROWS` | bounds table growth per session |

Every catalogued failure carries `errorCode` + `phase` + `sequence`
(`docs/engineering-standards.md`).

---

## 8. Versioning — DECIDED

- Opcode semantics never change within a major version.
- New capability = new opcode in a reserved range.
- Changing an existing opcode's operands = version bump ⇒ old clients desync, which is correct.
- No aliases, no compatibility shims (V1 rule).

---

## 9. Open decisions

| # | Question | Notes |
|---|----------|-------|
| **OPEN-1** | `NODE_DROP` of an absent id: `malformed` or tolerated? | Currently `malformed`. Total rigour, but obliges the encoder to be exact under races (node removed by the site between the record and the flush). If tolerated it MUST be counted in telemetry — never silent. |
| **OPEN-2** | Detached-row lifetime | Rows survive `REMOVE` so a node can move across frames. Costs table garbage if the producer forgets to drop. Alternative: deterministic GC — a detached row whose `lms` is older than N frames is dropped on both sides without an instruction. Deterministic because both sides run the same rule on the same data. |
| **OPEN-3** | `CHECK.scope` granularity | **Resolved in favour of id ranges** (§4.1). Subtree scoping needs per-subtree hashes, and a change propagates to the root — expensive. Id ranges are maintained as partial sums per bucket, O(1). Confirm before sealing. |
| **OPEN-4** | Establish: `EST_CHUNK_HTML` or `EST_TABLE`? | Settle by measurement: `table → HTML string → native parser` versus `table → createElement` at 20k nodes. The C++ parser is where **P1** comes from; an authoritative table from byte zero is where the id-assignment asymmetry dies. A synthesis exists — send the table, have the client build the HTML string from it. Needs numbers, not opinion. |

---

## Decision log (append-only)

| Date | Topic | Decision |
|------|-------|----------|
| 2026-08-13 | Foundation | The node table becomes the replicated structure; the DOM on both sides is a projection of it (**P0**). Eliminates the producer-belief failure class structurally rather than by guard. |
| 2026-08-13 | Execution | Two-phase frame: table then materialization (**P3**). Restores whole-frame validate-then-mutate with no undo log or scratch tree. |
| 2026-08-13 | Safety | Frame-level `preTableHash` licenses non-idempotent instructions (**P2**). Supersedes the earlier `prevCount` proposal, which verified a proxy (child count) rather than state identity. |
| 2026-08-13 | Instruction set | 27 opcodes in reserved ranges. No `MOVE`, no `REPLACE` (**P6**). `ATTR_SET`/`ATTR_DEL` split because the empty string is a valid value. `PROP_SET` split from `ATTR_SET` because internal state is published as an attribute but applied as a property. |
| 2026-08-13 | ISA | A cursor-based instruction machine was considered and **rejected for now**: it optimizes bytes, and the binding constraint is CPU per operation (**E3/E4**). It would also cost frame atomicity, idempotence and telemetry legibility. Reopen only if O3 shows bytes as the active constraint. |
| 2026-08-13 | Topology | Order is `parent` + `prevSibling`, **not** a positional index. A positional index would renumber and rehash every following sibling on a middle insert — O(n) on exactly the long-list shape live odds produces. `prevSibling` makes every structural edit touch two rows. |
| 2026-08-13 | Hashing | `rowHash = H64(id, kind, parent, prevSibling, contentHash)`; `tableHash = Σ rowHash mod 2^64`, updated by subtract-old/add-new in O(1). Addition rather than XOR to remove the duplicate-cancellation class. Attribute order is not hashed. |
| 2026-08-13 | `lms` | **Role changed.** With `preTableHash` verifying the whole table every frame, per-row versioning adds nothing to safety and is a precondition on no instruction. Retained for diagnostics and GC only. Recorded explicitly so the original justification is not carried as cruft. |
| 2026-08-13 | Unification | Stylesheets and rules are rows in the same table and id space: a rule's parent is its sheet, a sheet's parent is its pierce host. One topology model covers DOM and CSSOM; one hash covers both planes. |
| 2026-08-13 | Strings | Session-persistent, append-only intern table plus per-frame strings, discriminated by bit 31 of `StrRef`. Immutability means it cannot diverge by mutation; a lost `STR_DEF` surfaces as `malformed` on first reference, so no separate hash is needed. |
| 2026-08-13 | Operand width | Fixed-width operands, no varints on the hot path (**P5**) — consistent with the ISA decision that CPU per operation, not bytes, is the binding budget. |
