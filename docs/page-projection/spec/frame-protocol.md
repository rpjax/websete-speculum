# PageProjection — frame protocol (V4)

**Status:** **V4 CANON.** Implemented in the V4 engine (DOM table, open named shadow, lab same-origin nested contexts). OPEN items in §10 and [open.md](open.md) MUST
NOT be guessed in code. Production cutover is [roadmap.md](roadmap.md).
**Scope:** the replicated state (§1), the frame that carries changes to it (§2–§4), how the producer
constructs one (§5), and how it is applied (§6–§9).
**Index:** [README.md](README.md). **Budgets/K/oracles:** [budgets.md](budgets.md), [oracles.md](oracles.md)
(extracted from archived engine-redesign). **Decisions:** append here (protocol) and index in
[decision-log.md](decision-log.md).

**Related:** [acceptance.md](acceptance.md) · [cssom.md](cssom.md) · [input.md](input.md) ·
[shadow.md](shadow.md) · [naming.md](../../naming.md)

---

## 0. Principles

A change that violates one of these is a redesign, not a tweak.

**P0 — The table is the replicated structure; the DOM is a projection of it.**
Virtual: the site mutates the real DOM → the MutationObserver records it → **we update our table** →
we emit the frame describing the table delta. Client: the frame arrives → **it updates its table** →
the DOM is materialized as a consequence. Both sides apply the same frame to the same starting state,
so the tables are identical by construction. The producer never holds a *belief* about client state —
it holds a *copy*. Form control live properties (`value` / `checked` / `selected`) have no
MutationObserver: the producer samples a membership index every tick and emits `PROP_SET` (§5.9). That
still writes **this table**. It is not a second replicated structure.

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

**P8 — No lifecycle branches.** The producer has no `if (isFirstFrame)`, no branch keyed on tag name,
document-readiness or session age. The same code processes a node whether it is the first mutation of a
fresh generation, the ten-thousandth mutation of a long session, or a row being re-emitted for resync
(§5.8). Cold start (§4.7) and resync (§5.8) are not exceptions to the *mutation-processing* algorithm;
they are what it produces when it starts from an empty table or is told to replace the table,
respectively — same instructions, same code, different starting point. **Correction (2026-08-13):** the
original justification here — "installation precedes the parser (§5.1), so the index is never catching
up to a state it missed" — is empirically false; see §5.1. The fix is not a lifecycle branch inside the
mutation algorithm itself: it is one bootstrap call to `resyncVirtual` (§5.8) before the tick loop starts,
which reuses the same table-population primitive resync already needed for its harder case (an
untrustworthy identity map). P8 still holds where it matters — there is no per-mutation conditional
logic — but the "nothing to catch up from" framing was wrong and is retracted.

---

## 1. The replicated state — DECIDED

Two replicated structures, both maintained identically on Virtual and client.

OPEN-6 does **not** add a session document table and does **not** put nested identity on the
element row. Parent context keeps `hosts: Map<nodeId, contextId>` (not hashed into `CHECK`).
The PP header carries `contextId`. Runtime is once at the root tab; the algorithm installs in
every `window`. Nested does not open its own sidecar socket — [multi-document.md](multi-document.md).
Not on the wire yet.

### 1.1 Structures

| Structure | Contents | Mutability |
|-----------|----------|------------|
| **Node table** | every projected node, stylesheet and CSS rule **of one document** | mutable |
| **String table** | interned strings referenced by instructions | **append-only** |

There is **one node table and one node-id space per document**. Stylesheets and rules are rows in
that document’s table, distinguished by `kind`. An id therefore never means two different things
**inside that table**, and one hash covers that document’s node state. Session `contextId` (OPEN-6)
is a different space: which projection context emitted the frame, not a row in this table.

Internal storage may be split per kind or otherwise optimized — that is implementation. The contract
is: one node-id space per document, one logical node table per document, one hash per document.

### 1.2 Id space

| Id | Meaning |
|----|---------|
| `0` | **none / absent** — never a valid row |
| `1` | **Document** — not `<html>`. Exists for the lifetime of a generation. `<html>` is an ordinary `ELEMENT` row, allocated like any other, parented to `1`. |
| `2 …` | allocated monotonically by the producer |

Ids are allocated **only** by the producer and are never reused within a `generation`. On
`EPOCH_RESET` both tables are cleared and allocation restarts at `2`.

**OPEN-6:** session `contextId` `1` is the **root algorithm instance**, not this Document row.
Every nested instance still has Document row `1` **inside its own table**. Different spaces —
[multi-document.md](multi-document.md).

**Doctype.** `<!DOCTYPE html>` is a child of `Document`, sibling of `<html>`. If it is not projected,
the client document renders in **quirks mode** — different box model, different layout: a silent K4
parity failure. It is projected as a `DOCTYPE` row (§1.3), child of `1`. Test matrix needs a
quirks-mode row.

### 1.3 Node row

| Column | Type | Meaning |
|--------|------|---------|
| `id` | `u32` | key |
| `kind` | `u8` | `ELEMENT`=1, `TEXT`=2, `COMMENT`=3, `SHEET`=4, `RULE`=5, `DOCTYPE`=6, `SHADOW_ROOT`=7 |
| `ns` | `u8` | `ELEMENT` only — `0` html, `1` svg, `2` mathml, `3` none (`namespaceURI === null`), `4` custom. Known values hash the `u8`. Custom URI is **not** a stored column; it rides `NODE_NEW` as `StrRef` when `ns=4` and is hashed into `contentHash`. **Wire** `NODE_NEW` packs this in the low nibble of the `ns` byte; bit 7 is nested-host presence (not stored on the row, not hashed). |
| `parent` | `u32` | `0` when detached; for `RULE` the owning `SHEET`; for `SHEET` the pierce host or `0` |
| `prevSibling` | `u32` | `0` when first child |
| `name` | `StrRef` | `ELEMENT`: tag. `DOCTYPE`: root element name (`"html"`). `SHEET`/`RULE`: unused (`0`) |
| `value` | `StrRef` | `TEXT`/`COMMENT`: character data. `RULE`: rule text. Otherwise `0` |
| `attrs` | map `StrRef → StrRef` | `ELEMENT` only |
| `props` | map `u8 → scalar` | `ELEMENT` only — §4.4 `PROP_SET` |
| `flags` | `u16` | §4.2 `NODE_META` |
| `lms` | `u32` | frame `sequence` at which this row was last touched |
| `rowHash` | `u64` | derived, §1.5 |

### 1.4 Topology

Order is represented by **`parent` + `prevSibling`** only for a **single child list**. Those two columns uniquely determine that list: within a parent, `prevSibling = 0` is the first child of **that** list and the chain from there is determined.

**Shadow ([shadow.md](shadow.md), shipped open/named).** An `ELEMENT` has a second collection: at most one `SHADOW_ROOT` row with `parent = host`. That row is **not** in the light `prevSibling` chain. `SHADOW_ROOT.prevSibling` is always `0` and unused. Light `prevSibling = 0` still means the first **light** child (`kind ≠ SHADOW_ROOT`). `dropSubtree` of a host MUST walk the light chain **and** the owned `SHADOW_ROOT`. Walking only `prevSibling` leaks the shadow. Children of the root use `parent = shadowRootId` and their own light-style chain (live `shadowRoot.childNodes`).

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

`contentHash` is a commutative combine over the row's content: `ns` (ELEMENT: known `u8`, or hash of
the custom URI), `name`, `value`, each `(attrName, attrValue)` pair, each `(propId, propValue)` pair,
and `flags`. `SHADOW_ROOT`: `mode` and `initFlags` are content (`parent` already names the host). Attribute order is not hashed — attribute order is not semantic for rendering, and
commutativity makes `ATTR_SET` order-independent. HTML `<a>` and SVG `<a>` MUST NOT collide. Nested
`childContextId` on host `NODE_NEW` is child-scope-indexer state, not element content
([multi-document.md](multi-document.md)). Not hashed.

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
version       u8    current **2**. unknown ⇒ desync, never best-effort parse
flags         u8    bit0 unused (0) · bit1 resync — same generation; replaces the table wholesale
                     rather than extending it (§5.8)
contextId     u32   this instance’s mine. Root `1`; nested never `1`; `0` malformed
generation    u32
sequence      u32
partIndex     u16   0-based
partCount     u16   1 when not split
preTableHash  u64   expected tableHash before applying; unchecked for `resync` frames — there is no
                     prior state to check against a wholesale replace
strCount      u32
strings       [ byteLen u32, bytes UTF-8 ] * strCount      // frame-local, per part
opCount       u32
ops           [ opcode u8, operands ] * opCount
```

Little-endian throughout.

**OPEN-6:** `contextId: u32` after `flags` — **this instance’s mine**, not a parent field. The producing context writes it. The DataPlane does not. Root is `1`; nested never `1`. Space stays `u32` (not GUID). Do **not** bump `version` for lab header growth. Full: [multi-document.md](multi-document.md).

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
| `0xC0–0xDF` | reserved — resync needs no new opcodes (§5.8 reuses `NODE_NEW`/`INSERT`/`CHECK`/CSSOM ops) |
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
is recreated empty. `DOM`: the surface is discarded (a new document buffer is prepared — §6).

**`0x03 STR_DEF`** — `strId: u32, byteLen: u32, bytes: u8[]` · phase 1 · idempotent
`Pre`: `strId` has bit 31 clear; `strId` is undefined, **or** defined with identical bytes
(re-definition with different bytes is `malformed`). `byteLen ≤ MAX_STR_BYTES`.
`Table`: interns the string. `DOM`: none.

**`0x04 NOP`** — no operands · no phase · idempotent

### 4.2 Table

**`0x20 NODE_NEW`** — `id: u32, kind: u8, descriptor` · phase 1 · idempotent¹
`descriptor` by `kind`:
- `ELEMENT`: `ns: u8` (low nibble `ElementNs`; bit 7 `ELEMENT_NS_NESTED_HOST_BIT` ⇒ nested-context host; bits 4–6 reserved 0), if `ns === 4` then `uri: StrRef`, then `name: StrRef`, `attrCount: u16`, `[(nameRef: StrRef, valRef: StrRef)] * attrCount`, then if bit 7 set `childScopeId: u32` (`≥ 2`). Ordinary elements omit the u32 (decode: `nestedHost=false`, `childScopeId=null`). Same omit pattern as custom `uri`. Not hashed. Lab same-origin host: producer sets the bit; Projected creates a blank iframe and skips `src`/`srcdoc`.
- `TEXT` | `COMMENT`: `value: StrRef`
- `SHEET`: `flags: u16`
- `RULE`: `value: StrRef`
- `DOCTYPE`: `name: StrRef` (root element name)
- `SHADOW_ROOT`: `host: u32`, `mode: u8` (`0` open, `1` closed), `initFlags: u8` — shipped open/named; [shadow.md](shadow.md)

`ns`: `0` html, `1` svg, `2` mathml, `3` none, `4` custom. A `u8` outside `0..4` is **`malformed`**.
`ns === 4` with an empty URI is **`malformed`**. When `ns !== 4` the URI field is **not written**.
`Pre`: `id ≥ 2`; `kind` is a defined value; every `StrRef` resolves; `attrCount ≤ MAX_ATTRS`.
`SHADOW_ROOT` additional `Pre`: `host` exists and `kind = ELEMENT`; `host` does not already own a `SHADOW_ROOT`; `mode = 0` (`1` closed is **NIT** — `malformed`); `initFlags` bits: `0x01` delegatesFocus, `0x02` clonable, `0x04` serializable; any other bit **`malformed`**. Slot assignment is always named this version (`slotAssignment: 'manual'` is **NIT** — producer must not emit a root for that host; same as closed: explicit unsupported).
¹ `id` already existing with an **identical** descriptor (including `ns` / custom URI) is a no-op; with a different descriptor it is
`malformed`.
`Table`: inserts a row with `parent = 0`, `prevSibling = 0` — **detached**. **`SHADOW_ROOT` exception:** `parent = host` immediately; not linked into the host’s light chain.
`DOM`: `createElementNS` from `ns` (canonical xhtml / svg / MathML URIs, `null` for none, custom URI for `4`). Never HTML `createElement` for Element. Materialization of the tree happens on `INSERT`. **`SHADOW_ROOT`:** phase 2 `host.attachShadow({ mode: 'open', delegatesFocus, clonable, serializable })` from `initFlags` — not `insertBefore`. Omit `slotAssignment` (named default). The root is never `INSERT`ed under the host.

**`0x21 NODE_DROP`** — `count: u16, ids: u32[]` · phase 1 · **not idempotent**
`Pre`: every id exists; every id has `parent = 0` (detached). An absent id is **`malformed`** (OPEN-1 **CLOSED 2026-08-17** — producer DROP is table GC after this tick’s ops; there is no valid happy-path race). Dropping an attached row is
`precondition` — the producer must `REMOVE` first, which keeps detachment explicit and auditable.
`Table`: drops each row **and all its descendants** (a detached row may still have children). For an `ELEMENT`, descendants include the light `prevSibling` chain **and** the owned `SHADOW_ROOT` (if any).
`DOM`: none — the subtree is already detached.

**`0x22 NODE_META`** — `id: u32, flags: u16` · phase 1 · idempotent
`Pre`: `id` exists.
`flags`: `PLACEHOLDER`=0x01, `SHADOW_HOST`=0x02, `SHADOW_CLOSED`=0x04, `IFRAME_HOST`=0x08,
`PIERCE_ROOT`=0x10, `CANVAS_PLACEHOLDER`=0x20.
**Shadow:** `SHADOW_HOST` / `SHADOW_CLOSED` / `PIERCE_ROOT` are **superseded** ([shadow.md](shadow.md)). Do not emit them to mean a shadow; the root is a `SHADOW_ROOT` row. **`IFRAME_HOST` is not the OPEN-6 machine** — nested identity is the parent `hosts` map filled from host `NODE_NEW`, not a META flag on the element row ([multi-document.md](multi-document.md)). Do not emit `IFRAME_HOST`.
`Table`: replaces `flags` wholesale (not a bitwise merge — replacement is idempotent).
`DOM`: reflects the corresponding `speculum-*` marker attributes.

### 4.3 Structure

**`0x40 INSERT`** — `parent: u32, before: u32, count: u16, ids: u32[]` · phase 1+2 · **not idempotent**
`Pre`:
- `parent` exists and `kind` is `ELEMENT`, **`SHADOW_ROOT`**, or row `1`;
- `before` is `0` (insert at end) **or** an existing row whose `parent` equals `parent`;
- every id exists and is distinct within the instruction;
- **no id is `parent` or an ancestor of `parent`** — cycle prevention;
- `count ≤ MAX_CHILDREN_PER_OP`;
- **no id has `kind = SHADOW_ROOT`** — the root is never `INSERT`ed; it rides `NODE_NEW` only.

`Table`: for each id in order, unlinks it from its current parent if attached, then links it before
`before` (or at the end). Updates `prevSibling` of the moved node and of the node that followed it —
two row hashes per link, not O(children).
`DOM`: `parent.insertBefore(node, beforeNode)`. When `parent` is `SHADOW_ROOT`, insert into that `ShadowRoot` (not the host). An already-attached node is **moved**, preserving
media playback, focus and scroll inside its subtree.

**`0x41 REMOVE`** — `parent: u32, count: u16, ids: u32[]` · phase 1+2 · **not idempotent**
`Pre`: `parent` exists; every id exists and its `parent` equals `parent`; **no id has `kind = SHADOW_ROOT`** (the root is not `REMOVE`d; it dies with the host).
`parent` may be `SHADOW_ROOT` (interior of the shadow).
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

`Table`: sets `props[propId]` (phase 1 — always). `DOM` (phase 2): applies as a **property**, not an
attribute — `VALUE` sets `.value`, `CHECKED` sets `.checked`, `SELECTED` sets `.selected` on
`<option>` — **only if the control is not locally dirty** ([input.md](input.md) §7.2). Dirty: stash
the latest sample; do not rewind the live field. `CHECK` / `preTableHash` never read the live
`.value`. `DIALOG_MODAL` calls `showModal()`/`close()`, `POPOVER_OPEN` calls
`showPopover()`/`hidePopover()`, `CUSTOM_VALIDITY` calls `setCustomValidity()`. Bool operands are
`u8` `0` or `1`; any other value is `malformed`. `propId` outside this table is `malformed`.

Separate from `ATTR_SET` because the live property is the truth (JS `el.value = …` does not update the
HTML attribute). Do **not** publish this state as `speculum-*` attributes — apply the property
([input.md](input.md) §7). Tag/property compatibility is the producer's responsibility and is not
verified.

**Lab happy path (2026-08-18):** producer emits and client materializes `VALUE` / `CHECKED` /
`SELECTED` only (§5.9). `0x04`–`0x0A` stay on the ISA ([seal-gaps.md](seal-gaps.md) `PP-D16-*`); this
cut does not emit them. Decoder still accepts every defined `propId`.

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

**`0x83 DOC_ATTACH`** — `hostId: u32, childDocumentId: u32` · **do not implement for OPEN-6.** Earlier join/router draft. Nested id is the parent `hosts` map, filled from host `NODE_NEW`. [multi-document.md](multi-document.md).

**`0x84 DOC_DETACH`** — `hostId: u32` · **same — do not implement for OPEN-6.** Teardown is host `REMOVE` / inner realm gone.

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
`Table`: sets `value`. `DOM`: updates the rule **in place** — C3.1 forbids delete-and-reinsert for a
**`CSSStyleRule`** (would widen the repaint). Content change on a grouping rule (patch cannot work)
is **not** `RULE_SET`: the producer emits `RULE_DROP` + `RULE_NEW` (new id). The client must not
implement hidden replace inside `RULE_SET`; a `RULE_SET` targeting a non-style rule is a producer
bug and desyncs.

### 4.7 Establish — does not exist

There is no establish phase, no establish opcode, and no establish↔live handoff. **Every frame the
producer emits — including the first — uses the ordinary instructions of §4.2–§4.3.** Cold start is
what happens when `NODE_NEW`/`INSERT` run against an empty table at `generation 0, sequence 0`; it is
not a distinct mechanism and needs no distinct opcode range. `0xC0–0xDF` is reserved, not establish.

This deletes, in one move: the establish↔live handoff race (`engine-redesign.md` §5.6.6, `PP-EST-3`),
the text-node registry asymmetry (no bootstrap HTML means no "elements carry anchors, text does not"),
and `speculum-anchor` in establish HTML (`engine-redesign.md` §5.1.7) — none of it exists to race or to
carry an anchor. It also produces more faithful progressive paint: the client's document grows in
exactly the order the Virtual's did, not "blank, then snapshot, then patch".

**What this does not solve on its own.** Three cases need a bootstrap that is not "replay from generation
0, sequence 0": attaching to a page whose parser already ran before the observer attached (mid-session
join), recovering a client that desynced mid-session, **and — corrected 2026-08-13 — cold start itself**,
because §5.1's "installation precedes the parser" premise turned out to be empirically false. All three
are the **resync** mechanism, §5.8 — specifically its `resyncVirtual` primitive, not a fourth mechanism.
A newly attaching client's prior state is simply the empty table; sending it a `resync`-flagged frame as
its first frame is not a special case of resync, it *is* resync (P8) — but "sending a resync frame"
means running `resyncVirtual` (walk + rebuild), not `emitResyncFrame` alone (§5.8), because there is no
existing identity map yet for the latter to iterate.

---

## 5. Frame construction — producer (Virtual side) — DECIDED

How the sidecar turns `MutationRecord`s into the instructions of §4, plus the form-property sample
that MutationObserver cannot see (§5.9). This absorbs the still-valid content of `contracts/03-frame.md`
and `implementation/sidecar/frame.md` (accumulation sets, flush order); those two files are superseded
by this section and are to be deleted, not left as half-truths.

### 5.1 Installation and entry point — **corrected 2026-08-13, empirically false as originally written**

The observer is installed via Patchright's `addInitScript` (wraps CDP
`Page.addScriptToEvaluateOnNewDocument`), which the original draft assumed ran *before* the HTML parser,
seeing its output "from byte zero." **Measured, it does not.** By the time the injected script's
`MutationObserver.observe(document, …)` call actually attaches, Chromium's parser has already inserted
`<html>` and `<head>` (and possibly early `<head>` children) — confirmed by instrumenting the injected
script itself (`globalThis.__speculumDebug`, since Patchright does not forward `addInitScript` console
output to `page.on('console')`) and observing `document.head` already non-null and populated at observer
`start()` time. Whether this is an inherent property of `Page.addScriptToEvaluateOnNewDocument` or an
artifact of Patchright's own injection pipeline (its stealth-patch scripts run in the same slot ahead of
ours) was not isolated — it does not matter for the design: we do not control what runs ahead of our
script in that pipeline, so the observer's "byte zero" premise cannot be relied upon regardless of cause.

**Consequence.** The table cannot be assumed empty-and-about-to-grow purely from observed mutations at
attach time; it starts empty while the live DOM does not. The fix is not a special case inside this
section's mutation processing (P8 still holds there) — it is that `bootstrap` runs `resyncVirtual`
(§5.8) exactly once, synchronously, immediately after `observe()` returns and before the tick loop
(§5.2) starts. `resyncVirtual` walks whatever the parser has already produced (however much or little
that is) and populates the table from it; the mutation buffer's backlog up to that same synchronous
point is then drained and discarded, not fed to the tick builder, because `resyncVirtual`'s walk already
captured everything it describes. Every mutation the observer records *after* that point flows through
the ordinary tick path (§5.2 onward) exactly as this section originally described, unchanged.

The first ordinary tick, once it starts, sees whatever the site does *after* the bootstrap walk's
snapshot point — which may itself still include `<body>` construction if the parser is still running.
That remains an ordinary `childList` record against a non-empty table, processed by the same path as
every later one; only the very first, one-time population of the table changed.

### 5.2 Buffer and tick

`MutationRecord`s accumulate into a plain buffer — no processing in the callback itself, per **E3**.
**Before every drain** (clock tick and `flushNow`), the producer MUST call `observer.takeRecords()` and
push the result into that buffer. MutationObserver delivery is a **microtask**: records for mutations
that already happened on the live DOM may still sit in the observer's internal queue until the
callback runs *or* `takeRecords()` pulls them. Draining only the callback-fed buffer leaves the table
one (or more) mutations behind the live DOM — O2 then reports `child_order_mismatch` that is snapshot
lag, not (necessarily) a table bug.

On each tick of the frame clock (`engine-redesign.md` clock, not `rAF`), the buffer is frozen and
drained; a fresh buffer starts collecting for the next tick immediately, so delivery is never blocked
on drain.

### 5.3 Visited set (per tick)

A plain `Set<Node>` (not `WeakSet` — it must be iterable), cleared at the start of every tick's drain.
Before walking a node's subtree, check membership; multiple overlapping `MutationRecord`s in the same
tick must not cause the same subtree to be walked twice (`O(n²)` otherwise). Under rate degradation (5
Hz) or a hidden client (1 Hz) this set can hold nodes — including ones the site already removed — for
up to a second; `MAX_DIRTY_NODES` bounds it with a forced flush, in the same family as the §7 limits.

### 5.4 The `addedNodes` trap

The observer does **not** emit records for the descendants of a subtree inserted as a unit — only the
inserted root appears in `addedNodes`. The producer MUST walk it recursively (`node.childNodes`) or the
interior is never indexed and never sent. There is no way to detect this from the record alone; it is a
structural property of the API and the walk is mandatory, not an optimization.

**Second trap (PP-FR-1, 2026-08-14).** `addedNodes` is a **snapshot at mutation time**. A later mutation
in the **same tick** can destroy that node. At drain it is still in the list and `isConnected === false`.
The producer MUST NOT `identity.allocate` / `NODE_NEW` / `INSERT` it. Attr/text patches already skipped
`!isConnected`; the structural walk must do the same. Treating observer history as the live tree sends
nodes the Virtual document no longer has — Projected draws them; halt O2/tree stay green because they
sample the **end** of a complete frame. Incident: [observability.md](observability.md) §8.

### 5.5 Single-pass DFS: reuse-or-create, emit on the way down and on the way up

For each node in `addedNodes`, walked depth-first:

```
walk(node, parentId):
  if !node.isConnected: return          // PP-FR-1 — snapshot listed it; live tree does not
  if visited.has(node): return
  visited.add(node)

  existingId = identity.get(node)          // WeakMap<Node, u32>, the producer's own map
  if existingId:
    // Reused node: already indexed, its subtree is already indexed too. No recursion, no NODE_NEW.
    emit INSERT(parent: parentId, before: resolvedBefore, ids: [existingId])
    return

  id = identity.allocate(node)
  emit NODE_NEW(id, kind, descriptor)      // already hydrated: tag + attrs in one instruction (§4.2)

  for child in node.childNodes:
    walk(child, id)                        // descend first — children fully assembled, still detached

  emit INSERT(parent: parentId, before: resolvedBefore, ids: [id])   // post-order: attach last
```

Two things fall out of this without extra machinery:

- **Reuse is one `INSERT`, not a walk.** If `identity.get(node)` hits, the node and everything under it
  is already indexed on both sides (§5.7). Re-emitting `NODE_NEW` for it would be `malformed` (existing
  id, different descriptor — §4.2 footnote 1); walking its children again would be wasted work and,
  worse, would re-discover children that themselves might have moved elsewhere in the same tick. This
  is P6 in the producer's own algorithm, not just in the wire format: **one way to say one thing** means
  there is only one code path for "this id needs to be somewhere", whether it is brand new or reused.
- **`INSERT` emission is post-order.** A node's own `INSERT` is emitted only after the walk has returned
  from all of its children. By the time `INSERT(parent, ..., [id])` is written, `id`'s entire subtree is
  already linked to it in the table (§4.3 `Table` effect is pure memory, no DOM). Phase 2 on the client
  therefore attaches a **finished** subtree in one `insertBefore`/`appendChild`, not a growing one —
  exactly one attach touches the live surface per top-level insertion, regardless of subtree size. The
  historical ancestor-first order existed to satisfy a dependency ("the parent must exist before it is
  addressed") that no longer applies once `NODE_NEW` is phase-1/detached; only cost remains, and cost
  favors post-order (`HANDOFF.md` §7.2).

**Discovery order is naturally top-down and needs no separate pass.** The observer delivers a subtree's
root before its children's own records (the parser, and every framework, builds outward from a
mutation's root), so draining the buffer in arrival order allocates ids top-down "for free" — `walk`
above never needs a second pass to fix ordering.

**No separate hydration phase.** A generic instruction set would `CREATE_ELEMENT` bare and then
`SET_ATTR` in a second phase, because its create carries only the tag. Ours does not need this: `NODE_NEW`'s
descriptor already carries the full attribute set (§4.2), so a newly created row is born hydrated in one
instruction. A "memory / state / topology" three-phase grouping is unnecessary as a formal ordering
rule for **new** nodes — it already exists, folded into `NODE_NEW` itself. It still applies as producer
discipline for **patches on reused/moved nodes**: when a node being moved this tick also has attribute,
text or prop changes this tick, emit its `ATTR_SET`/`TEXT_SET`/`PROP_SET` before its `INSERT`, so the
patch lands on a still-detached node rather than one already reattached to the live surface. This is a
materialization-cost discipline, not a correctness requirement — phase 1/2 (§6) does not depend on it.

### 5.6 Deferred deletion (end of tick, not on sight)

Do not emit `REMOVE` or `NODE_DROP` the instant a node appears in `removedNodes`. A node removed from
one parent and inserted into another **within the same tick** is a move, not a deletion — this is the
common case (keyed list reconciliation, drag-and-drop, portals/modals, responsive wrappers; see
`HANDOFF.md` §7.4), and it must cost exactly the one `INSERT` from §5.5, nothing more.

Rule, evaluated once the tick's buffer is fully drained, against the **live** tree (`isConnected`),
not against `visited`:

- **Still `isConnected`** — a move. Its §5.5 `INSERT` already unlinked it (§4.3). No `REMOVE`.
- **`!isConnected` and never had an id** — ephemeral (created and destroyed this tick). PP-FR-1: never
  sent. No `NODE_NEW`, no `INSERT`, no `REMOVE`.
- **`!isConnected` and already had an id** — true detach: emit `REMOVE(oldParent, [id])`. The row
  survives detached until OPEN-2 `NODE_DROP` by `lms` age.

**`visited` is not a move proof.** A same-tick create+destroy is also visited if the walk allocated it.
Skipping `REMOVE` because `visited.has(node)` was the V4 walk defect that put dead nodes on the wire
(`tableFrameBuilder.ts` `emitDeferredRemoves` uses `isConnected`).

### 5.7 Identity map

`WeakMap<Node, u32>` on the producer, mirroring the client's `Map<u32, Node>` (§1). Forward and reverse
of the same relationship; neither side writes an identity attribute into a DOM node (`contracts/01-identity.md`).
This is the map `identity.get`/`identity.allocate` in §5.5 refer to.

### 5.8 Resync — producer construction — DECIDED, closes OPEN-5

Supersedes `contracts/07-recovery.md` entirely: no Node mirror, no HTML serialize, no
`speculum-anchor`, no `establishBegin`/`establishChunk`/`establishEnd`. That file is dead, same
disposition as `contracts/03-frame.md` (§1).

**One mechanism, three triggers, two strengths.** A client requests resync after detecting one of the
desync conditions of `contracts/07-recovery.md` §PP-REC-1 (id unresolved, `sequence` gap, `generation`
mismatch, missing part, decode error, `CHECK` mismatch) — those triggers are unaffected by this section,
only the *response* changes. A newly attaching client is not a different case: its prior state is the
empty table, and sending it a resync frame as its first frame is the same instruction with a trivial
starting point (**P8**). Cold start needs the same mechanism too — corrected 2026-08-13, see §5.1 — for
the same reason: at the moment the table is populated, it cannot be assumed to already correctly reflect
the live DOM. There is no separate "initial attach" or "cold start" code path; there are two *strengths*
of the one mechanism, below, and each trigger picks whichever strength its situation calls for.

**`emitResyncFrame` vs `resyncVirtual`.** The identity map is either trustworthy (mid-session desync,
where the producer's bookkeeping might be stale or wrong but the *shape* of the map — which ids exist —
still corresponds to real prior state) or it is not yet populated at all (cold start; a newly attaching
client; a hypothetically corrupted map). These need different primitives:

- **`emitResyncFrame`** — the **construction** below. Two linear passes over the *existing* identity
  map, no DOM walk, ids never reallocated. It can only re-describe and prune what the map already knows
  about; it cannot discover a node the map has never seen.
- **`resyncVirtual`** — clears the identity map (no `generation` bump — this is not `EPOCH_RESET`;
  same generation, ids simply thrown away and reassigned), walks the live DOM once, synchronously, to
  repopulate the map with fresh ids for whatever is currently connected, then calls `emitResyncFrame` on
  the freshly rebuilt map. This is the only place resync ids are *not* preserved — the opposite guarantee
  from `emitResyncFrame` below — because a walk-based rebuild has no prior ids to preserve in the first
  place. Bootstrap (§5.1) always uses this primitive: there is nothing yet in the map for
  `emitResyncFrame` to iterate.

**Trigger is out-of-band.** The resync *request* is not in the PP body. OPEN-6: it is a **loose bus event** stamped with the desynced instance’s `contextId`; the matching Virtual runs `emitResyncFrame` ([multi-document.md](multi-document.md) §4). DataPlane does not route. (Bootstrap has no "request" at all — it is not a response to anything, it is the one unconditional call every session makes before its first tick.)

**`emitResyncFrame` construction — two linear passes over the identity map, not a DOM walk:**

1. **Halt.** The frame-tick (§5.2) stops draining the mutation buffer into new ordinary frames. This is
   the *only* thing that pauses. The `MutationObserver` keeps recording into the buffer exactly as
   always (§5.2) — nothing is lost, it simply waits to be coalesced into the next ordinary frame once
   the halt lifts. The producer's table is not touched by anything during the halt (§5.2: only frame
   construction mutates it), so there is nothing to protect by pausing more than this.
2. **Pass 1 — create.** Iterate the identity map (`Map<u32, Node>` on the producer, reverse of §5.7).
   For each id whose node is **not** `node.isConnected` (and is not `document` itself): drop it from the
   identity map and do not emit anything for it — it is exactly the detached garbage `NODE_DROP` would
   eventually collect (§5.6, OPEN-2's deferred GC); resync is a convenient moment to sweep it
   immediately rather than wait for the age threshold, but it is not a substitute for that GC rule in
   the general case, only a bonus during a resync we are already paying for. For each id whose node
   **is** connected: emit `NODE_NEW(id, kind, descriptor)`, reading tag/attrs/text **fresh from the live
   node**, not from the producer's own row-table. This makes resync self-healing against a producer-side
   table bug — it resends what the Virtual DOM actually *is*, using the identity map only to know which
   ids map to which live nodes. CSSOM ids (sheets/rules, same map, same id space, §1.1) are included the
   same way, using "still adopted" in place of `isConnected`.
3. **Pass 2 — topology.** Iterate the identity map again. For each surviving id, read the node's
   **native** `childNodes` (or, for CSSOM, the sheet's native rule list / the adoption order) and emit
   `INSERT(parent: thisId, before: 0, ids: [childId, ...])` in that native order. **Shadow (designed):**
   for each `ELEMENT` with `.shadowRoot`, pass 1 has `NODE_NEW` the `SHADOW_ROOT`; pass 2 `INSERT`s
   `shadowRoot.childNodes` under that root id — never `INSERT`s the root under the host.
   **Do not** maintain a
   parallel child-list structure on the producer for this — the Virtual DOM's own topology is already
   correct and free to read; duplicating it in JS would cost every ordinary frame (`splice`/`indexOf` on
   every structural mutation) to save time on an event that is rare by construction. This is a
   Virtual-side implementation choice only — it does not change what the **replicated table** (§1.3)
   is, which still carries `parent`/`prevSibling` per row because the *client* has no live DOM to read
   from during phase 1 (§6) and needs that data as plain memory to validate before touching the surface.
   Both are true at once: the client's table needs `parent`/`prevSibling` as data; the Virtual producer,
   sitting on a live DOM, is free to derive the same fact from `node.childNodes` instead of also keeping
   a copy.
4. **Close.** Last instruction of the frame: `CHECK(scope: 0, hash: <freshly computed tableHash over
   everything just emitted>)`. Reuses the existing opcode (§4.1) — no new "resync-end" instruction is
   needed. This gives the client (and telemetry) a hard verification that reconstruction is complete and
   correct, the same guarantee `EST_END` used to give, without a dedicated opcode for it.
5. **Flush and resume.** The frame is sent with `sequence` incremented normally (a resync frame is a
   frame like any other in the stream, per Rodrigo's framing — not a side channel) and `resync` set in
   `flags`. The halt lifts; the next ordinary tick drains whatever accumulated in the buffer during
   construction, including any site mutation that happened concurrently — nothing is special-cased on
   the way back in either (**P8**).

**`resyncVirtual` construction — wraps the above, does not replace it.** `resyncVirtual` is: (a) clear
the identity map — `byNode`/`byKey` reset to empty, **`generation` is not touched**; (b) re-bind
`document → id 1` (§1.2's one implicit row is never rediscovered by a walk, it is always the fixed
anchor); (c) one synchronous recursive walk of `document`'s live tree (`node.childNodes`, depth-first —
this is the one place in the whole design that *is* a DOM walk, precisely because there is not yet a map
to iterate instead), calling `identity.allocate(node)` for every connected `ELEMENT`/`TEXT`/`COMMENT`/
`DOCTYPE` node so each gets a fresh id, and for each host with `.shadowRoot` allocate the `SHADOW_ROOT`
then walk that root the same way ([shadow.md](shadow.md)); (d) call `emitResyncFrame` — steps 2–5 above, unchanged — against
the now-populated map. Step (c)'s walk order does not need to match final sibling order; `emitResyncFrame`
pass 2 reads live `childNodes` directly and is order-independent over how pass (c) happened to discover
ids. **Bootstrap-specific step (not part of `resyncVirtual` itself):** the mutation buffer accumulated
whatever the observer recorded up to and including step (c)'s synchronous walk; since the walk already
captured that same end state wholesale, this backlog is drained and discarded (not fed to the §5.2 tick
builder) immediately after `resyncVirtual` returns, in the same synchronous stretch — no `await` between
them, so no new mutation can be lost or double-counted at the boundary.

**Ids are never reallocated — applies to `emitResyncFrame`, not to `resyncVirtual`.** Unlike
`EPOCH_RESET`, `emitResyncFrame` does not bump `generation` and does not restart id allocation at `2`. A
node that survives it keeps the id it already had; the producer's identity map needs no remapping. This
is why `resync` is a distinct header bit from `EPOCH_RESET` rather than a variant of it: `EPOCH_RESET`
means "this generation is over, nothing carries forward"; `resync` means "same generation, but the
client's copy is being replaced wholesale because it cannot be trusted to apply the next delta
correctly." An id absent from an `emitResyncFrame` output no longer exists after it — no per-id
`NODE_DROP` is needed to say so, because the frame *is* the new table, not a patch to the old one.
`resyncVirtual` is the one deliberate exception to "ids are never reallocated": its whole point is that
the existing ids (if any) cannot be trusted, so it throws all of them away and starts over. Both still
report the same `generation` — only `EPOCH_RESET` bumps `generation`.

**Atomicity — must run as one synchronous pass.** Whether `emitResyncFrame`'s two passes over the
identity map, or `resyncVirtual`'s walk followed by those same two passes, the whole construction must
run in a single JS turn with no `await` between any step — reading the live DOM more than once
non-atomically would tear if the site's own script could interleave. Because JS is single-threaded, a
fully synchronous stretch cannot be interleaved with the site's own mutating code — the site cannot run
while our call stack owns the thread — so a synchronous walk is torn-read-free by construction, **within
one document/process.** It does **not** extend across a pierced cross-origin iframe boundary (out-of-
process iframe, its own thread) — see the reframed **OPEN-6** below; iframes stay pinned, this is a
known, named gap in the guarantee, not a silent one. If table size ever makes a fully synchronous walk
too slow to be acceptable (a real question at `MAX_ROWS` scale, not yet budgeted — no `E`-number covers
"one-off bulk resync latency", the existing `E3`–`E5` budgets are all per-operation/per-frame steady
state), that is a budget question for whoever picks this up next, not a correctness one: chunking the
walk across turns would reintroduce tearing and would need its own precondition, which does not exist
yet.

**Client side — reuses the existing double-buffer surface, no new client mechanism.**
`contracts/08-surface.md` already specifies building into a second iframe and swapping at
first-meaningful-paint for "Document swap or resync" — that mechanism is correct and is reused as-is.
What changes is only the **swap condition's trigger**, since it currently reads `establishEnd` (dead,
§4.7): the new condition is **this frame's closing `CHECK` (step 4) verifies OK**, in place of
`establishEnd ∧ cssomInstall ∧ body non-empty`. `contracts/08-surface.md` needs that one wording update;
it is not a design change. The client applies `NODE_NEW`/`INSERT` for a `resync` frame into the inactive
buffer exactly as it would for any frame (§6), building a complete, still-detached document; the double
buffer's swap is the single reflow, not a new "reconnect the root" instruction.

**A resync frame whose closing `CHECK` fails is a defect, not a recoverable state.** Resync is the
system's ground truth re-assertion — it reads live, re-derives ids from the identity map, and closes
with a hash the client must match. There is no legitimate reason for that hash to mismatch; if it does,
something upstream is already wrong (a producer bug, a decode bug, a hash-collision-class bug). This is
the same posture as any other MotorAssert-class invariant in this repo (`docs/assert-failure-policy.md`):
the response to a failing assertion is to fix the defect it caught, not to treat the failure as an
alternate valid outcome. A bounded retry with backoff still belongs at the transport/session layer —
not because resync is expected to fail, but as ordinary defensive engineering against a retry storm
hammering the Virtual instance if a defect *does* slip through. Exceeding the bound MUST surface as a
hard, catalogued session failure with `errorCode` + `phase` (`docs/diagnostics.md`) — never a silent,
indefinite retry loop that hides a bug behind an apparently-still-running session.

**Closes OPEN-5.** Both halves — desync recovery and mid-session attach — are the same mechanism.
Residual follow-ups, not blockers to the design itself: (1) rewrite `contracts/07-recovery.md` to match
this section instead of Node mirror/HTML; (2) update `contracts/08-surface.md`'s swap-trigger wording;
(3) budget the synchronous-walk cost at scale (above); (4) `test-matrix.md`'s `PP-REC-*`/`PP-EST-*` rows
need re-authoring against opcodes instead of HTML/checksum-of-bytes; (5) bounded resync-retry/backoff
policy at the session layer, tied to a catalogued hard-failure `errorCode` on exhaustion.

### 5.9 Form control properties (`PROP_SET`) — DECIDED 2026-08-18

MutationObserver does **not** see `input.value` / `checked` / `option.selected`. Event listeners miss
JS assignment that does not dispatch `input`/`change`. This is DOM **state 1:1**, not CSSOM eventual
([acceptance.md](acceptance.md)).

**Index (producer-local, not a second replicated table).** Membership only: which live nodes to
sample. Updated at the same chokepoints that already see the tree — `resyncVirtual` walk and the
ordinary MO drain (`NODE_NEW` / `REMOVE` / `NODE_DROP`). Not hashed. The contract remains row `props`
on the one node table (§1.3).

Index these (not `type=file`):

| Node | Sample |
|------|--------|
| `<input>` except checkbox/radio/file/button/submit/reset/image | `VALUE` ← `.value` |
| `<textarea>` | `VALUE` ← `.value` |
| `<input type="checkbox\|radio">` | `CHECKED` ← `.checked` |
| `<option>` | `SELECTED` ← `.selected` |

Hidden inputs are indexed (`VALUE`). `type` change (attribute) reclassifies membership. There is no
`PROP_DEL`: leftover `props` keys stay (rare). Detached / dropped nodes leave the index. Button-like
types (`button` / `submit` / `reset` / `image`) are not indexed — `.value` there is the button label,
not field state.

**Every frame.** After structural/attr/text ops for the tick, read the index. Emit `PROP_SET` only when
the live value differs from `props[propId]` already in the table (delta, not a flood of identical
ops). Same tick as `ATTR_SET`, not idle, not a reduced CSSOM-style rate. Measured 2026-08-18: Amazon
home ~274 indexed reads ≈ 0.02 ms/pass; Wikipedia 17k elements / 18 controls ≈ 0.002 ms. Cost tracks
indexed nodes, not table size.

**Create / resync.** `NODE_NEW` still carries attributes only (§4.2). After create (and on resync
describe), emit live `PROP_SET` for indexed nodes so property ≠ attribute is not lost. Order: patches
on a node being moved this tick still precede that node's `INSERT` (§5.5).

**Client.** Phase 1 always writes `props` (otherwise the next `preTableHash` fails). Phase 2 sets the
live property **only if the control is not dirty** ([input.md](input.md) §7.2): a user typing "oi" on
Projected can be ahead of a frame that still carries `"o"` — that is not a desync. Lab never marks
dirty, so phase 2 overwrites (Virtual wins). Caret when applying (`PP-IN-2`) is input redesign, not
this cut.

**Not this cut:** dialog, popover, media, `setCustomValidity`; wrapping prototypes; CDP as sensor.

---

## 6. Execution model — DECIDED

| Phase | Work | On failure |
|-------|------|-----------|
| **1 — table** | verify `preTableHash`; apply all row mutations; evaluate `CHECK` | abort before touching the surface |
| **2 — materialize** | reflect changed rows into the DOM | specified not to fail — phase 1 already validated addresses. If the live node is **not** where the table just swore (e.g. `REMOVE` whose `parentNode !== op.parent`), that is a **desync**, not a skip |

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

## 7. Ordering within a frame — DECIDED

1. `EPOCH_RESET` first, if present.
2. `STR_DEF` before any instruction referencing that string id.
3. `NODE_NEW` before any instruction referencing that id.
4. `NODE_DROP` after every `REMOVE` of that node.
5. `CHECK` verifies the state at the point it appears.

`sequence` belongs to the **frame**. Within a frame, instructions have an **index**, not a sequence.
Per-instruction sequence would make the instruction the wire unit and discard the frame model.

---

## 8. Failure classes and limits — DECIDED

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
| `MAX_DIRTY_NODES` | bounds the producer's per-tick visited/dirty set (§5.3) — forces a flush rather than unbounded growth under degradation |

Every catalogued failure carries `errorCode` + `phase` + `sequence`
(`docs/engineering-standards.md`).

---

## 9. Versioning — DECIDED

- Opcode semantics never change within a major version.
- New capability = new opcode in a reserved range.
- Changing an existing opcode's operands = version bump ⇒ old clients desync, which is correct.
- No aliases, no compatibility shims (V1 rule).

**Current `version`:** `2`. Lab may grow the header (e.g. `contextId` after `flags`) **without** bumping
this byte — there is no released peer to desync. Bump only when a frozen client must reject old
frames. `NODE_NEW` Element `ns: u8` landed in version 2. Adding `0x63 PROP_SET` (reserved range, new
opcode) did **not** bump the version. Adding `SHADOW_ROOT` kind `7` did **not** bump the version.
Unknown kind remains `malformed`.

---

## 10. Open decisions

| # | Question | Notes |
|---|----------|-------|
| **OPEN-1** | ~~`NODE_DROP` of an absent id: `malformed` or tolerated?~~ | **CLOSED 2026-08-17 — `malformed`.** DROP is producer table GC after this tick’s ops are folded; site delete is `REMOVE`. No valid happy-path absent id. Unit: `testApplyFrameToTableCheckedRejectsNodeDropAbsentId`. |
| **OPEN-2** | Detached-row lifetime | **CLOSED 2026-08-17** — end-of-tick move/detach (§5.6), deferred `lms`-age GC, no per-row versioning. |
| **OPEN-3** | `CHECK.scope` granularity | **CLOSED 2026-08-17** — id ranges (§4.1). Subtree hashes rejected (change would propagate to the root). |
| **OPEN-4** | ~~Establish: `EST_CHUNK_HTML` or `EST_TABLE`?~~ | **CLOSED — moot.** Establish does not exist (§4.7). There is nothing left to choose between. |
| **OPEN-5** | ~~Recovery flow: mid-session attach + desync resync~~ | **CLOSED — see §5.8.** One mechanism (identity-map two-pass reconstruction, existing opcodes, existing double-buffer surface) covers both triggers. Residual non-blocking follow-ups listed at the end of §5.8 (old contract rewrites, a synchronous-walk budget number, test-matrix rows). |
| **OPEN-6** | Multi-document | **Lab same-origin iframe 2026-08-19** — [multi-document.md](multi-document.md). `contextId` on the header, child-scope indexer, blank Projected host, bus/`emitFrame`/resync-request. Effect: lab `iframe-open` `iso.nested` + `iso.nested.blank` (DOM client). |
| **OPEN-7** | ~~`ReplicatedTable.insertBatch` reverse `nextSiblingOf` on insert-before-existing~~ | **CLOSED 2026-08-14.** `insertBatch` now sets `nextSiblingOf.set(prev, before)` when `before !== NONE` (same reverse write `linkAfter` already did). Falsifier: `INSERT(P, before=X, [A,L]); REMOVE(P,[L])` ⇒ `getRow(X).prevSibling === id(A)` — `testReplicatedTableInsertBeforeNextSiblingRepair` in `Refactor/sidecar/unit.ts`. Historical defect write-up remains in the 2026-08-14 “not fixed this pass” decision-log row below. **Does not cover prepend+tail-evict** — that is OPEN-8. |
| **OPEN-8** | ~~`unlink` of the last child leaves `nextSiblingOf[prev]` → id~~ | **CLOSED 2026-08-14.** Derived `nextSiblingOf[prevLast]` still pointed at the removed last child. The next tail `REMOVE` took the “has next” branch (the next row still exists, now detached) and skipped `lastChildOf`. `orderedChildIds` then started at a detached id with `prevSibling=0` → walk length 1 vs hundreds hashed/live. O2 on `prepend-stress.html` (2026-08-14T19-30, seq 695, `#19 child_order_mismatch`). Wire `preTableHash` green (derived links not hashed — P0). Falsifier: `testReplicatedTablePrependEvictDerivedLinks` in `unit.ts`. Fix: `nextSiblingOf.delete(prev)` when unlinking the last child. Sibling of OPEN-7, not a reopen. |

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
| 2026-08-13 | Establish | **Deleted.** No establish phase, no establish opcode range, no establish flag. Cold start is ordinary frames against an empty table at `generation 0, sequence 0` (§4.7). Closes **OPEN-4** as moot. Recovery (mid-session attach, desync resync) is deferred to a separate, not-yet-designed flow — **OPEN-5**, opened explicitly rather than left implicit. |
| 2026-08-13 | Id space | id `1` is **Document**, not `<html>`. `<html>` is an ordinary `ELEMENT` row. `DOCTYPE` becomes a node `kind`, projected as a child of `1` — omitting it silently renders the client in quirks mode, a K4 defect that was in neither the spec nor the test matrix (§1.2). |
| 2026-08-13 | Frame construction | New §5: producer buffers `MutationRecord`s per tick behind a per-tick `visited: Set<Node>`, drains in a single-pass DFS. A reused node (already in the producer's identity map) emits exactly one `INSERT`, no `NODE_NEW`, no re-walk of its children — reuse costs one instruction regardless of subtree size. A new node's `NODE_NEW` (already hydrated, §4.2) is emitted on the way down; its `INSERT` is emitted on the way up, after every child has returned (post-order) — the client attaches one finished subtree, never a growing one. Deletion is deferred to end-of-tick: removed-and-reinserted this tick needs nothing beyond that `INSERT`; removed-and-not-reinserted becomes `REMOVE` (detached, not dropped). Absorbs and supersedes `contracts/03-frame.md` / `implementation/sidecar/frame.md`. Leans **OPEN-2** closed. |
| 2026-08-13 | Principles | **P8 added:** no lifecycle branches. Cold start and resync are what the one algorithm produces from an empty or replaced table, not special cases of it. |
| 2026-08-13 | Resync severity | A resync frame failing its own closing `CHECK` is a **defect signal**, not an expected outcome — same posture as any MotorAssert invariant. Retry/backoff at the session layer is defensive engineering against a retry storm, not a handling path for "normal" resync failure; exhausting the bound MUST surface as a catalogued hard failure (`errorCode`+`phase`), never an indefinite silent retry. |
| 2026-08-13 | Pierce (pinned) | **OPEN-6 opened, deliberately deferred.** `isConnected` is per-document; a pierced node can read connected while its iframe host is detached from the top document. Fix (walk the pierce-host chain) is known but not written — pinned until after the DOM-only core (§5) is implemented and measured, per Rodrigo's call to validate the algorithm before its edges. |
| 2026-08-13 | Resync | **Designed, closes OPEN-5.** No new opcodes: two linear passes over the producer's identity map (not a DOM walk) — pass 1 emits `NODE_NEW` for connected ids read fresh from the live node (self-healing against a producer table bug), dropping disconnected ids as a bonus GC sweep; pass 2 emits `INSERT` from each node's native `childNodes` order, no parallel child-list kept in JS; closes with a whole-table `CHECK`. Same `generation`, ids never reallocated — this is why `resync` is a header bit distinct from `EPOCH_RESET`, not a variant of it: replace-in-place, not restart. Mid-session attach and desync recovery are the same mechanism (**P8**). Must run as one synchronous pass (JS run-to-completion) to avoid a torn read of the live DOM across the two passes; a bulk-resync-latency budget at `MAX_ROWS` scale is not yet defined. Supersedes `contracts/07-recovery.md`'s Node-mirror/HTML design entirely; reuses `contracts/08-surface.md`'s double buffer unchanged except for the swap-trigger condition (`CHECK` verified, not dead `establishEnd`). |
| 2026-08-13 | §5.1 empirically falsified | **Measured, not theorized: Patchright's `addInitScript` does not run before the parser.** `document.head` was already non-null and populated at `MutationObserver.observe()` time in the lab harness — confirmed via `globalThis.__speculumDebug` (Patchright does not forward `addInitScript` console output to `page.on('console')`, a separate debugging gotcha worth recording). Root cause (inherent to `Page.addScriptToEvaluateOnNewDocument`, vs. an artifact of Patchright's own stealth-injection pipeline running ahead of ours) was not isolated and does not change the fix: we do not control what runs ahead of our script either way. §5.1 and P8 corrected in place rather than left stating a false premise. |
| 2026-08-13 | Resync split: `resyncVirtual` vs `emitResyncFrame` | **Designed**, closing the gap the falsified §5.1 premise opened. `emitResyncFrame` is exactly the §5.8 two-pass construction already designed above — it needs an existing identity map to iterate and cannot discover a node the map has never seen. `resyncVirtual` is new: clear the map (no `generation` bump — not `EPOCH_RESET`), one synchronous DOM walk to (re)allocate fresh ids for whatever is currently connected, then call `emitResyncFrame`. Cold start now always runs `resyncVirtual` once, synchronously, immediately after `observe()` and before the tick loop starts, discarding the mutation backlog that accumulated up to that same point (already captured wholesale by the walk) rather than feeding it to the tick builder. Mid-session desync recovery may use either strength depending on how much the producer trusts its own map — `emitResyncFrame` alone if the map's shape is trusted, `resyncVirtual` if it is not. This is two strengths of one mechanism, not a fourth mechanism (**P8**, corrected framing). |
| 2026-08-13 | OPEN-6 reframed: multi-document / nested-documents | **Widened from a narrow `isConnected` fix to the real shape of the problem**, following from the §5.8 atomicity discussion: a pierced cross-origin iframe runs on its own thread/process, so there is no synchronous-JS atomicity to lean on across that boundary the way there is within one document. Folding a pierced document into the same flat id space or the same single atomic Frame would be exactly the kind of ad-hoc condensation this repo's standards forbid — and would misrepresent something a real browser doesn't guarantee either, so it would also be a K4/1:1-parity defect, not a shortcut that merely looks ugly. Agreed direction (Rodrigo): the protocol must reflect the multi-document reality — independent per-document `generation`/`sequence`/identity space, an explicit host↔child-document attachment relationship, a per-document-scoped client registry — rather than trying to force one composite snapshot. Still pinned; not designed yet, only the shape of the eventual design is now recorded so the DOM-only core (§5, this session) isn't built in a way that forecloses it. |
| 2026-08-13 | **Defect found + fixed: tooling injects a live, connected `<script>` into the observed document** | First-frame size for a ~30-node fixture measured 48KB (~1.4KB/node — a real anomaly, not explained by CPU-side profiling alone, per an external second-opinion review that correctly pushed on "why so many bytes" instead of accepting the CPU story as the whole picture). Root cause, found by dumping the frame-local string table's actual contents (not guessed): Patchright's `addInitScript` does **not** inject invisibly the way a raw CDP `Page.addScriptToEvaluateOnNewDocument` context normally would — it leaves its own `<script>` tag **attached to the live document**, one per `addInitScript` call (this repo makes two: `buildConfigPreScript`'s config assignment, and `virtual.js` itself). §5.1's `resyncVirtual` walk — and every ordinary tick's `MutationObserver` after it — cannot distinguish this from real page content and mirrors it faithfully, including, in the worst case, **this producer's own ~46KB bundle source as a Text node's value**. This is not a bytes curiosity: it is a K4/1:1-parity defect (the projected page would contain DOM nodes, and in the worst case leak source text, that do not exist in the real page) that would have shipped in every session, not just this lab run. **Fix:** both injected scripts now call `document.currentScript?.remove()` as their very first synchronous statement — before anything else, including before any `await` — so neither ever exists in the document by the time anything (including `resyncVirtual`) can observe it. Confirmed: first frame for the same fixture dropped 48061→1952 bytes (≈24.6×) with node/op counts unchanged; stress-fixture steady-state `buildMs` max dropped 12.7ms→1.8ms in the same run (consistent with the earlier "GC pause coincides with `build()`'s measurement window" hypothesis — the retained 46KB string was inflating heap size for the rest of the session under **OPEN-2**'s no-GC table, not just the first frame). Confirms the discipline this repo asks for: CPU-time profiling alone was not sufficient evidence to declare the algorithm sound — the byte-size question had a real, structural answer, and finding it required looking at the *actual bytes*, not reasoning about them from a plausible-sounding hypothesis (this session's own first guess, "STR_DEF would fix it," was also wrong — see below). |
| 2026-08-13 | String interning (`STR_DEF`) reconsidered, left open | With the 48KB defect (above) closed, re-checked whether persistent string interning is still worth pulling forward from "deferred" (frame-protocol.md decision log, "ISA"). `BinaryWriter.str()` already dedupes *within* one frame — a repeated tag name inside the same frame is encoded once, not once per occurrence, contrary to this session's initial (external) hypothesis. What interning would still save is re-encoding the *same small static vocabulary* (tag names, common attribute names) *across* frames, since the frame-local string table resets every frame. Measured cost of all string encoding on the stress fixture was ~22% of producer CPU, but that fixture's dynamic content (counters, generated text) is inherently non-repeating and would not benefit from interning regardless — so 22% is an upper bound on this fixture, not a like-for-like estimate of what a real page's static-tag/attribute share would save. Left open, not decided either way: needs a fixture with realistic repeated markup vocabulary (classes, tags, common attributes) to measure the real ceiling before committing to the design and wire work `STR_DEF` requires (a persistent intern table plus a rule for which strings qualify — not a one-line change). |
| 2026-08-13 | Micro-opts applied to `TableFrameBuilder` (per-tick allocation + attribute reads + `opCounts`) | **Implemented**, authorized after the profiling round above identified these as the three low-risk items. (1) `visited`/`createdThisTick`/`removedThisTick`/`attrDirty`/`textDirty` moved from five `new Set()`/`new Map()` allocations per `build()` call to five instance fields reused via `.clear()` — removes per-tick heap churn at the sustained tick rate. (2) `readAttrs` (`domNodeDescribe.ts`, used by both `tableFrameBuilder.ts` and `resync.ts`) switched from `getAttributeNames()` + one `getAttribute()` round-trip per name (two native V8↔Blink calls per attribute) to a single `element.attributes` (`NamedNodeMap`) iteration — the profiled ~16.5%-of-build-time cost of the two-call pattern. (3) `opCounts` (the per-opcode breakdown in `FrameBuildStats`) is now computed only when `TableFrameBuilder` is constructed with `collectOpCounts: true` (default `false`); confirmed by code inspection that `frameEmitter.ts`'s `recordFrameEmitted` only ever reads `stats.buildMs`, never `stats.opCounts` — it was dead computation on every tick with telemetry on. **Verified, not just applied:** re-ran the CDP CPU profile (`profile-virtual.js`, stress-churn, 15s) post-fix — `(garbage collector)` self-time is now 0.8% (~121ms/15s), down from being the dominant explanation for the pre-fix 12.7ms `buildMs` p95 spikes; `readAttrs` and `walkChildList` each show as small, flat, expected line items (<0.9% each), not GC-adjacent hotspots. Smoke test (`smoke-projection-lab.js`) re-run clean, same 1952-byte first frame, confirming no behavioral regression. Wall-clock `buildMs` from the WS-transport perf harness (`perf-projection-lab.js`) still shows occasional multi-ms spikes on this machine even post-fix; the CPU profile (isolated from network/transport, `discard` sink) shows these are not GC — most likely OS/Node event-loop scheduling jitter on this dev box, not a producer-algorithm cost. Not chased further as a `lab_first` measurement run: real budget validation belongs on target hardware, not this laptop. |
| 2026-08-13 | First real-site (non-synthetic) producer CPU probe — Rodrigo's request for a comparison baseline, not just adversarial fixtures | Every measurement up to this point (this whole session) was against synthetic fixtures explicitly built to find a ceiling, not to represent typical page behavior — a fair criticism if left unaddressed. Ran `profile-virtual.js` (CPU-only, `transport: 'discard'` — see below for why this specific transport choice was load-bearing) against real sites of varying dynamism: a static Wikipedia article (near-zero background churn after initial load — `sequence` never advanced past the bootstrap resync in 15s idle), a real news homepage (BBC News — 9 ticks/15s, +37 rows, driven by its own ad-tech stack: `pubads_impl.js`, `ozwrap_pbjs.js`, `tinypass.min.js`), and a Cloudflare-fronted live-clock page (dominated by the site's own bot-check script). **In all three, no `TableFrameBuilder` function (`build`/`walk`/`walkSiblingRun`/`resolvedBefore`) appeared in the top-25 CPU self-time list at all** — the producer's own cost was below the noise floor of what the real page's own ad/tracking/security JS already costs to run. This is the comparison baseline this session's synthetic-fixture numbers were missing: real, typical page churn is far below the adversarial ceiling this session spent most of its effort finding and fixing — consistent with, not contradicting, the "3% of a core per session under realistic load" estimate reasoned from the synthetic numbers. **Separately surfaced, not yet acted on:** the *first* attempt used `perf-projection-lab.js` (the WS-telemetry harness, `transport: 'loopback'`) against Wikipedia and got zero frames despite a successful `page.goto` — almost certainly the real site's CSP `connect-src` blocking the loopback WebSocket a page-injected script tries to open to `ws://127.0.0.1:…`, since switching to `transport: 'discard'` (no WebSocket at all) immediately worked. **Not investigated further this session** (CPU-only was sufficient to answer the question asked), but flagged as a real production-deployment constraint for the `loopback`/`LoopbackFrameTransport` design on arbitrary real sites, independent of anything else in this log — worth its own line item before out-of-lab rollout, not filed under any existing OPEN item. |
| 2026-08-13 | Second real-site probe (Rodrigo's request: `www.eneba.com`, `www.belezanaweb.com.br`) — one usable result, one infra block, not an algorithm result | `www.eneba.com` (real e-commerce SPA, `tableSize: 3237` — an order of magnitude bigger than the news/wiki probes above): 5 ticks in 15s idle-after-load, `tableSize` 3237→3238 (+1 row total). `TableFrameBuilder` again does not appear in the top-25 CPU self-time list; the page's own `monitoring.*.bundle.js` and `script.js` dominate what little non-idle CPU there is (idle ≥97.6% of the window). Confirms the prior BBC/Wikipedia finding at a materially larger table size: table size scaling to thousands of rows does not, by itself, create ongoing per-tick cost — cost tracks *mutation volume*, not table size, consistent with the algorithm never doing a full-table pass on an ordinary tick. `www.belezanaweb.com.br` returned Akamai's static `"Access Denied"` page both attempts (`tableSize: 19`, `sequence` never advancing past the bootstrap resync) — tried with a 12s and then 15s post-`domcontentloaded` settle delay (Rodrigo's warning that the real site needs "a few good seconds" past an Akamai interstitial) on the theory this was a *challenge* page that clears with time; identical result both times rules that out — this is a hard IP-reputation block (this dev environment's egress IP flagged by Akamai Bot Manager), not a timing race, and not something `settleMs`, `waitUntil`, or any producer-side change can fix. **Not filed as an algorithm finding either way** — no real DOM from that site was ever profiled. Filed here only as an operational fact for later: Bot Manager / CDN-tier bot defenses blocking on IP reputation is a real deployment constraint for whatever origin the sidecar's outbound Chromium traffic egresses from (VPS datacenter IP ranges are exactly what Bot Manager scores hardest against), independent of anything the mirroring algorithm does — worth its own line item before rollout planning, not a defect in this session's work. `profile-virtual.js` hardened alongside this probe: `page.goto` timeout raised 30s→60s, explicit `settleMs` 5th CLI arg (was a fixed 500ms `wait`, too short for any interstitial), page `url`/`title` logged before profiling starts (so a blocked/wrong page is visible in the output instead of silently profiling garbage — this is what caught the Akamai block immediately rather than after analysis), and browser teardown moved into `try/finally` + a `process.exit` safety net (closing a real gap: the earlier Yahoo Finance `page.goto` timeout in this session left a headless Chromium process running because `browser.close()` was never reached). |
| 2026-08-13 | **Found + fixed: `resolvedBefore` was O(batch²) for a large single-block sibling insert** | Every fixture measured so far (`mutation-churn.html`, `stress-churn.html`) only ever `appendChild`s at the end of a list — never exercises the "insert a whole block of new siblings at once" shape (`DocumentFragment` prepend/insert, a common real pattern: "load older messages", reverse-infinite-scroll, virtualized-list reorder, table sort). Built an adversarial fixture for exactly that shape (`lab/static/fixtures/prepend-stress.html` — prepends a `DocumentFragment` of `batch` new `<div>`s every `requestAnimationFrame`, evicts oldest-first once a cap is exceeded) and measured `TableFrameBuilder` at `batch` 100/400/1600 via `perf-projection-lab.js` and `profile-virtual.js`. Per-op cost (`buildMs`/`opCount`) **should be flat if the algorithm is O(n)**; instead it rose 1.35µs → 1.79µs → 3.07µs per op as `batch` scaled 16×, and the CDP profile at `batch=1600` showed `resolvedBefore` alone at **34.4% of total producer CPU** (3526ms of a 10s window) — the dominant single cost, versus 0–2.7% at smaller batches. `buildMs` avg hit 30.4ms (max 76.7ms) and the tick loop could no longer sustain its 30Hz cap, falling to ~9.6fps actual. **Root cause:** the old `walk()` called `resolvedBefore()` — an O(k) walk of `.nextSibling` looking for the nearest already-indexed node — once *per node*, independently, even when N new siblings arrive together in one `addedNodes` array; for a block of N, that is `N + (N-1) + … + 1` = O(N²) total, because each of the first N-1 new nodes' own `resolvedBefore` walk has to cross every other not-yet-indexed sibling still ahead of it before reaching the real anchor. **Not a foundation/paradigm defect** — the wire format already carries `InsertOp.ids: DomNodeKey[]` (plural) precisely for batched inserts, and `resync.ts`'s `emitResyncFrame` already batches one `INSERT` per parent; only the ordinary incremental builder's per-node loop wasn't using it. **Fix:** `walk()` replaced by `walkSiblingRun()` (`tableFrameBuilder.ts`) — walks a sibling run once, computes `before` once per *contiguous* stretch (verified live via `.nextSibling` immediately before extending a batch, never assumed from `addedNodes`' snapshot order — a broken assumption only costs a missed batching opportunity, never a wrong frame), and emits one `INSERT` for the whole stretch; `prepareChild()` factors out the reuse-or-create-and-recurse step so both `addedNodes` and a freshly-created node's own `childNodes` (never separately observed — §5.1) go through the same batching path. **Verified fixed, same three `batch` values, same harness:** `resolvedBefore` self-time at `batch=1600` dropped 34.4%→0.2% (3526ms→18.6ms, ~190×); `buildMs` avg dropped 30.4ms→9.7ms (max 76.7ms→39.6ms) at `batch=1600`, and per-op cost is now *flat-to-improving* with batch size (1.47µs → 0.97µs → 1.12µs across the same 100/400/1600 sweep) instead of rising — the batching also cuts total op count (fewer, larger `INSERT`s), a byte-size win on top of the CPU one. Smoke test re-run clean, unchanged first-frame bytes — no behavioral regression. Remaining dominant cost at `batch=1600` post-fix is `allocate()` (`DomNodeTable`, ~10%, `FinalizationRegistry.register()` per new node) — already tracked, not new, under **OPEN-2**/pinned Item 2 (deferred-age GC), not reopened by this fix. |
| 2026-08-13 | Lab consolidated into an official Benchmark tool (CPU profile + invariants + structural diff + report export) | Every measurement in the six log entries above (`resolvedBefore` O(N²), real-site probes, the 48KB defect, the micro-opts) was produced by a fresh, throwaway CDP/percentile script each time (`profile-virtual.js`, `profile-real-site-full.js`, `perf-projection-lab.js`, `diag-first-frame.js`) — none exported a structured report, none was reachable from the lab UI, and the math (self-time aggregation, percentiles) was copy-pasted across three of them. Per Rodrigo's request to stop spending Cursor tokens re-running probes just to re-derive numbers already proven this session, the lab (`lab/index.ts` → `server.ts` → `session.ts`, a real HTTP+WS server, not throwaway) gained an official, UI-driven **Benchmark** panel + `runBenchmark` control message, backed by four new shared modules: `lab/cpuProfile.ts` (CDP `Profiler.*` capture + self-time/`OUR_FUNCTION_NAMES` aggregation — Virtual/producer side only, per the decision that client-side cost stays wall-clock `applyMs`, already in telemetry, not CDP self-time on a manually-opened tab), `lab/frameInvariantMonitor.ts` (decodes the wire frame stream itself — not the live browser's JS state — and checks sequence/generation monotonicity, dangling references, duplicate ids, topology consistency, producer/client table-size agreement; built so a future `CHECK`/`preTableHash` assertion is one more check function, not a rearchitecture), `lab/structuralDiff.ts` + `client/domTreeSnapshot.ts` (topology-only Virtual-vs-Client `TreeNode` diff — tags/attributes/text/tree shape, no pixel/visual layer yet, shaped as one diff "producer" so a visual-diff producer can sit alongside it later), and `lab/metricsAggregator.ts` + `lab/runReport.ts` (telemetry percentiles; `report.json` + raw `.cpuprofile` exported per run to `lab-runs/<timestamp>-<url-slug>/`, gitignored, meant to be pointed at for offline diagnosis instead of re-running). `client/decode.ts` (pure binary parsing, zero DOM dependency) moved to `models/decode.ts` as a prerequisite — it lived under `client/`, which `tsconfig.json` excludes from `tsc`, so the `tsc`-compiled lab server could not import it to decode frames for the invariant monitor. `domTreeSnapshot.ts`'s DOM-walking function stayed in the `esbuild`-only `client/` directory rather than pulling `"DOM"` into `tsconfig.json`'s `lib` (tried and reverted — collided with unrelated legacy `Node`-named types in `browser/patchright/mirror/`); a pure, DOM-free `TreeNode` type lives in `models/treeNode.ts` for `tsc`-checked consumers, and the server loads the prebuilt snapshot bundle as a string for `page.evaluate()`. The three CLI scripts were refactored to import these same modules instead of duplicating their math, and kept as CLI entry points specifically because they need `transport: 'discard'` against arbitrary real-site URLs — exactly the eneba.com/belezanaweb.com.br runs two entries above — which the UI's own `runBenchmark` (always `transport: 'loopback'` against the lab's own data plane) cannot reach, since a real site's CSP `connect-src` blocks that loopback WebSocket (flagged, not yet acted on, three entries above). |
| 2026-08-14 | **Found + fixed: `NODE_DROP` released only the swept root's `DomNodeTable` identity, not its descendants (subtree resurrection)** | Raised by Rodrigo asking whether the protocol would naturally survive a node being GC'd from `ReplicatedTable`/`DomNodeTable` (protocol-side) while V8 keeps the live JS reference alive, then re-inserted. Traced through `emitNodeDropSweep` (`tableFrameBuilder.ts`): `collectDroppableIds` only ever returns detached *roots* (§4.2 — descendants are never listed on the wire on their own, they ride along implicitly via `ReplicatedTable.dropSubtree`'s own recursive walk), but the sweep was releasing only that root id from the producer's `DomNodeTable` (`domNodes.release(node)` called once, on the root). A live page-JS reference to a *descendant* that outlives the drop and gets reinserted later would still resolve via `domNodes.keyOf()` to its old, by-then-already-dropped id — `ReplicatedTable` would treat it as "already indexed, just move" (`insertBatch`'s `linkAfter` fallback for an id it doesn't recognize as a fresh row) instead of a clean re-`NODE_NEW`, corrupting the table silently rather than failing loud. **Answering Rodrigo's actual question: no, this did not resolve itself naturally** — it was a real gap, not a self-healing property of the design. **Fix:** `ReplicatedTable.subtreeIds()` added (`models/replicatedTable.ts`) — a read-only twin of `dropSubtree`'s own discovery walk (root + every descendant, no mutation) — so `emitNodeDropSweep` can enumerate the *full* set before the table effect runs and release every descendant's `DomNodeTable` entry too, not just the root's. Covered by existing `ReplicatedTable`/`applyFrameToTableChecked` unit tests (no behavioral change at that layer — this is purely `DomNodeTable`-side bookkeeping) plus manual reasoning verified against the smoke suite (all gates green after the fix, unchanged). |
| 2026-08-14 | **Found + fixed: same-tick sibling race — a row could cross the GC age threshold and get reattached in the same tick** | Adjacent case to the entry above, caught while confirming the fix actually closes the resurrection question rather than half-closing it. `emitNodeDropSweep` ran (and queried `ReplicatedTable.collectDroppableIds`, which filters on `row.parent === NONE`) *before* `build()`'s single `applyOpsToTable` call folded this tick's own records-derived ops (including any `INSERT` reattaching a previously-detached row) into `this.table`. A row detached long enough to be GC-eligible that got reattached by a mutation processed earlier in the very same tick still looked detached to the sweep query, so it could be selected for `NODE_DROP` in the same frame that also `INSERT`s it — a self-contradictory frame. The client's own `applyFrameToTableChecked` (§4.2) already rejects this defensively (`NODE_DROP` of an attached row → `precondition`, not silent corruption), but the producer should never construct that frame in the first place. **Fix:** `build()` (`tableFrameBuilder.ts`) now applies this tick's records-derived ops to `this.table` *before* running `emitNodeDropSweep`, then applies the sweep's own `NODE_DROP` op (if any) in a second, separate `applyOpsToTable` call — same final table state, same wire-visible `ops` order, purely a producer-internal reordering so the sweep always sees this tick's already-settled topology. Regression test added directly against the shared `ReplicatedTable`/`applyOpsToTable` primitives (`unit.ts`, `testCollectDroppableIdsExcludesSameTickReattach`), independent of the DOM-coupled builder, proving the ordering both reproduces the bug pre-fix and excludes it post-fix. |
| 2026-08-14 | `NODE_DROP_AGE_SEQUENCES` retuned 120→20, closing the `smokeNodeDropGcBounded` peak-bound gate | The two fixes above didn't move this number — this is an independent tuning gap in the same GC, found while re-running the full smoke suite to confirm the fixes didn't regress anything. `NODE_DROP GC soak` failed on `peakTableSize` (6823, gate bound 5000) even though the steady-state average (`middleAvg`≈3597, `lastAvg`≈3350) was already flat, i.e. the sweep itself works — the failure was a one-time ramp-up backlog: for the first `NODE_DROP_AGE_SEQUENCES` ticks after `stress-churn.html`'s churn starts, nothing is old enough to sweep yet, so the backlog grows roughly `churnRate * ageThreshold` (empirically ~23 detached-rows/tick × 120 ticks) before the first sweep ever fires. The original 120-tick (~2-4s) value was picked in the abstract, 2026-08-13, before any measurement; its own stated purpose (frame-protocol.md §1.6 comment) was only ever to out-margin a same-tick/next-tick reuse race — a race the ordering fix directly above now closes structurally, not by margin — so the value had far more headroom than it needed. Retuned empirically, not guessed: 40 (~1s) still measured peak=5223 (over bound); 20 (~0.3-0.7s, still an order of magnitude past the same-tick/next-tick window it needs to cover) measured peak=4423, middleAvg=2716, lastAvg=2686 — comfortably under the bound, steady-state flat. `MAX_NODE_DROPS_PER_SWEEP` (500/tick) left unchanged — the backlog's cause is the *dead time before eligibility*, not insufficient per-tick drain throughput (empirical churn ~23 rows/tick is nowhere near the 500 cap), so raising it would not have moved the peak. All 9 `smoke-projection-lab.js` gates green after this change. |
| 2026-08-14 | **Stage 4 (frame-protocol-production-completeness) implemented: client-initiated resync recovery + double-buffer surface — lab tree only** | Confirmed decisions (Rodrigo): mid-session recovery uses **`emitResyncFrame` alone**, not `resyncVirtual` (§5.8's "the identity map is trustworthy" branch — lighter, ids preserved, at the accepted cost of not self-healing a producer map whose *shape* is corrupted); client surface is a **real double buffer** (second, invisible iframe, own `ReplicatedTable`/registry, atomic swap only after the resync frame's own closing `CHECK` verifies) rather than an in-place clear+rebuild, specifically because a recovery mechanism is the wrong place to bet the only remaining good surface on Phase 2's "cannot fail" claim (§6) holding for every op. Producer: `FrameEmitter.requestResync(build)` (`frameEmitter.ts`) folds the halt into the existing `pendingFrame`/`pendingParts`/`trySendPending` pipeline — no new pause primitive, "halt" is just "build via this instead of the ordinary buffer-drain path at the next boundary"; `bootstrap.ts` claims the previously-reserved `PlaneChannel.Control` inbound handler (unused since E-03) to dispatch a `{type:'requestResync'}` JSON payload to it. Transport for the request, in this tree: `lab/session.ts` relays the browser-UI client's control-WS `requestResync` message onto that same `PlaneChannel.Control` — no REST endpoint, no new WebSocket, matching §5.8's "existing control channel" for what this tree actually has (the hub/gRPC production equivalent remains the separately-deferred "Production Integration" milestone, this log, 2026-08-13-adjacent entries). Client (`client/surface.ts`, `client/labProjectionClient.ts`): `beginResyncBuild`/`commitSwap`/`discardBuild` on the surface; a resync-flagged frame is applied via a second, independent `DomFrameApplier` instance (own table by construction, own registry) rather than a mutated shared target — reuses the existing, already-tested phase-1/phase-2 apply path verbatim, the swap is `commitResyncSwap` re-labelling which target is "live", never a rebuild of the applier itself. Bounded retry/backoff (3 attempts, linear backoff, 5s per-attempt response timeout) closes OPEN-5's residual follow-up (5) **for this tree**: exhaustion emits a terminal `resyncFailed{exhausted:true}` telemetry kind and the client permanently stops requesting further resyncs, never a silent indefinite loop. **Found + fixed during implementation:** the client's first cut routed *every* `resync`-flagged frame through the standby-build-then-swap path — including the session's own cold-start frame, since §5.1/§5.8 already establish that `resyncVirtual` (bootstrap) sets the same `resync` flag as `emitResyncFrame` (mid-session) for the same reason (no prior state to check a hash against either way). Building the very first frame into a "standby" that then swaps in over an *empty* live surface is harmless but wrong and wasteful, and briefly produced a spurious duplicate `resyncCompleted` in the new smoke gate below during development. Fixed by gating the standby-build path on a new `everArmed` flag (`labProjectionClient.ts`) — true only once the live target has actually shown a first frame — so cold start still applies directly to the live target (unchanged from pre-Stage-4 behavior) and only a genuine mid-session resync engages the double buffer. New smoke gate `smokeResyncRecovery` (`scripts/smoke-projection-lab.js`) forces a deterministic client-side desync against a **live, still-ticking** producer (a hand-crafted `injectRawFrame` sequence a million past current — unlike the Stage 2/3 corrupted/hostile-frame gates, this one cannot freeze Virtual via `#stop` first, since `emitResyncFrame` only ever runs from Virtual's own control-channel handler) against `static-dom.html` (no live mutation, so the structural-diff proof below can't be flaky against a fixture still changing underneath the two separate snapshot round-trips it takes), then asserts the full chain: `resyncRequested` telemetry fires, the live producer answers and the client applies+swaps (`resyncCompleted`, `status` back to "armed"), zero `resyncFailed`, and — the actual proof of healing, not just a flag arriving — a fresh virtual-vs-client structural diff is byte-identical. That last step reuses `lab/structuralDiff.ts` exactly as `runBenchmark` already does, exposed standalone via a new test-only `requestStructuralDiff`/`structuralDiffResult` control-message pair (`lab/session.ts`) so a targeted smoke test can ask for one diff without spinning up a whole benchmark run. All 10 `smoke-projection-lab.js` gates green, full `unit.js` suite green. **Explicitly still open, out of scope for this pass** (OPEN-5's remaining residual follow-ups, unaffected by the above): (1) `contracts/07-recovery.md`'s full rewrite to match §5.8 instead of Node-mirror/HTML; (3) the synchronous-walk latency budget at `MAX_ROWS` scale — `resyncVirtual`-specific, not exercised by an `emitResyncFrame`-only mid-session path; (4) `test-matrix.md`'s `PP-REC-*`/`PP-EST-*` rows re-authored against opcodes. (2) — `contracts/08-surface.md`'s swap-trigger wording — is done alongside this entry. |
| 2026-08-14 | **`insertBatch` `nextSiblingOf` gap (RECONCILIATION.md) confirmed present, filed as OPEN-7 — not fixed this pass** | A same-day external reconciliation review (`RECONCILIATION.md` §5, "one concrete bug in the new engine") flagged that `ReplicatedTable.insertBatch`'s insert-before-existing path never repairs the reverse `nextSiblingOf` link, only the forward `prevSibling` field. Re-derived independently from the code itself (not taken on faith) while answering Rodrigo's roadmap question: confirmed still present, root-caused to `relinkPrevSibling` doing half of what `linkAfter` does. Filed as **OPEN-7** (§10) rather than silently patched, both because it is a live P0 violation already running under the Stage 1-4 gates (worth a named, trackable entry, not a footnote) and because `work-order.md`'s roadmap now gates production cutover on it explicitly — fixing it belongs to that work item, not to a documentation pass. |
| 2026-08-14 | **OPEN-7 CLOSED** — `insertBatch` reverse link | `insertBatch` now writes `nextSiblingOf.set(prev, before)` on insert-before-existing, matching `linkAfter`. Unit falsifier `testReplicatedTableInsertBeforeNextSiblingRepair`: `INSERT(P, before=X, [A,L]); REMOVE(P,[L])` leaves `X.prevSibling === A`; batch-size-1 prepend then REMOVE restores first-child `prevSibling = 0`. Not a redesign — the derived index was half-maintained. Resync is not the cure. |
| 2026-08-14 | **O2 local oracle (table × live DOM)** | Lab-only, on-demand, not per-tick. Pure `compareTableToLiveOrder` plus Virtual walk `compareTableToLiveDom` on `__speculumProjection`. Control `requestTableLiveOracle` (same WS as `requestStructuralDiff`). `FrameInvariantMonitor` not extended — it only sees wire bytes. Smoke: `insert-before-remove.html` (mutations after load so they hit incremental `insertBatch`, not cold `resyncVirtual`). |
| 2026-08-14 | **Coherent snapshot + telemetry vs assert** | Not a wire opcode change. Halt/flush/O2/tree MUST be one JS turn (`flushAndSnapshot`) — same atomicity rule as §5.8 resync walk. Event `tableSize` is `ReplicatedTable.size` (diagnostic). State asserts are probes (`ReplicatedTableDigest` at sequence S), never telemetry equality. Lab is a `BrowserSession` caller. Full rules: [observability.md](observability.md). |
| 2026-08-14 | **OPEN-8 CLOSED** — last-child `unlink` must clear `nextSiblingOf[prev]` | O2 on `prepend-stress.html` (seq 695, `#19` walk `[118]` vs hundreds live) after OPEN-7. Table-only falsifier: prepend batches + tail REMOVE; `lastChildOf` left on a detached id (`parent=0, prev=0`). Wire hash green — derived links not in `tableHash`. Not a reopen of OPEN-7 (`insertBatch` before-existing). |
| 2026-08-14 | **`takeRecords` before every drain** | MutationObserver delivery is a microtask. Draining only callback-fed records left the table behind live DOM under churn; O2 could not tell lag from P0. `DomMutationObserver.takePendingIntoBuffer` at the top of `onBoundary`/`flushNow` and before bootstrap discard. One JS turn is not enough; one turn **with** `takeRecords` is. |
| 2026-08-14 | **Production cutover = full product** | Live switch only after CSSOM implemented, OPEN-6 nested/multidocs, and **input redesigned** (not V1 `input.md` rename-only). Lab DOM-table / single-doc is not M1. [roadmap.md](roadmap.md). |
| 2026-08-14 | **PP-FR-1 in the V4 walk + phase-2 REMOVE honesty** | Drain: `!isConnected` addedNodes must not be allocated (§5.4/§5.5). `REMOVE` iff ended detached with a prior id — `visited` ≠ move (§5.6). Client `REMOVE` parent mismatch → desync (§6). Incident: [observability.md](observability.md) §8. |
| 2026-08-16 | **C3.1 grouping-rule carve-out** | `RULE_SET` remains in-place patch for `CSSStyleRule` only. Content change on a grouping rule (patch cannot work) is producer `RULE_DROP`+`RULE_NEW` (new id). Client must not implement hidden replace inside `RULE_SET`. |
| 2026-08-17 | **OPEN-1 CLOSED** — `NODE_DROP` of an absent id is `malformed` | Rodrigo. DROP is GC of a row the producer table already holds (after this tick’s INSERT/REMOVE). Site removal is `REMOVE`. Absent id means the encoder claimed a row the in-sync client does not have — not a race to tolerate. Unit already fail-closed. |
| 2026-08-17 | **SEAL-DOM-P1-SVG** — `NODE_NEW` Element `ns` enum; URI StrRef only for `custom`; wire version 1→2; client `createElementNS`. Namespaced attributes (`xlink:href`) out of scope. Units: `testNodeNewElementNsWire`, `testStructuralDiffNsMismatch`. Lab `svg-ns`. |
| 2026-08-18 | **PROP_SET form slice** — index at resync/MO; sample every frame; emit on change; `VALUE`/`CHECKED`/`SELECTED` only. Not CSSOM idle. DOM 1:1. |
| 2026-08-18 | **PROP_SET dirty is phase 2 only** — table/`CHECK`/`preTableHash` always take the op. Live `.value` may lag while the user types. Not a desync. Caret (`PP-IN-2`) stays WP10. |
| 2026-08-18 | **SEAL-DOM-P1-PROP closed** — units `testPropSetWire`, `testPropSetTableAndCheck`, `testFormPropDirtyDoesNotBlockTable`; lab `forms-state` (`iso.formProps`). |
| 2026-08-18 | **C5 = in-page poll** — write-path hooks rejected as detector (antibot). Relocks cssom.md C5. Nested inners stay in grouping `cssText`; own-row walk is a future opt, not a protocol hole. |
| 2026-08-18 | **OPEN-6 designed** — N algorithm instances; one `DataPlane`; `documentId` on plane envelope v2; client slot map O(1); `DOC_ATTACH`/`DOC_DETACH`. Not pierce. [multi-document.md](multi-document.md). |
| 2026-08-18 | **OPEN-6 correction** — DataPlane does **not** track documents. `documentId` is PP header v3. Both sides keep a document table → host/root node. Envelope unchanged. |
| 2026-08-18 | **OPEN-6 machine** — no session document table. Root `documentId=1`. Parent mints nested `D` onto host `hostedDocumentId`. Child queries. Nav remints. `DOC_ATTACH` stays unimplemented. |
| 2026-08-18 | **OPEN-6 context** — id names the projection context (one tree), not a Document. Parent `hosts: Map<nodeId, contextId>` (not the page, not a row column). Nav / blank `load` = reinstall, same id. Header field `contextId`. |
| 2026-08-18 | **Shadow `SHADOW_ROOT` kind 7** — designed, then shipped same day. Real `attachShadow`; not light child; INSERT parent may be the root; `NODE_META` shadow flags superseded. Version stays 2. [shadow.md](shadow.md). |
| 2026-08-18 | **Shadow initFlags** — `delegatesFocus` / `clonable` / `serializable` on `NODE_NEW SHADOW_ROOT`. Manual slot NIT. |
| 2026-08-18 | **Shadow design complete for impl plan** — no INSERT/REMOVE of the root row; per-root MO same buffer; O2 enters shadow; CSSOM poll extends to admitted roots. |
| 2026-08-18 | **SEAL-DOM-P1-SHADOW closed** — kind 7 on version 2; open named; real `attachShadow`; lab `shadow-open`. Closed/manual NIT. [shadow.md](shadow.md). |
| 2026-08-19 | **OPEN-6 runtime ≠ algorithm** — runtime once at root tab; algorithm per `window`; nested no own WS; root `contextId=1` without RPC; nested `getScopeId` (`event.source === iframe.contentWindow`); timeout-as-root forbidden; RPC request/response/heartbeat; `hosts` not in `CHECK`. [multi-document.md](multi-document.md). |
| 2026-08-19 | **OPEN-6 header = mine** (`u32`, not GUID). Child-scope indexer per instance. Extra `NODE_NEW` arg only for host nodes (`ns` bit 7 + `childScopeId` u32; omit otherwise). Mint = root-runtime RPC. Indexer drops with host row. |
| 2026-08-19 | **OPEN-6 classify / Projected host / bus** — `contentWindow != null`; Projected blank same-origin iframe + parent install; bus events all layers, `emitFrame` = root runtime, postMessage. [multi-document.md](multi-document.md). |
| 2026-08-19 | **OPEN-6 resync request** — loose bus event stamped with desynced `contextId`; matching Virtual `emitResyncFrame`. Not in the PP body. |
| 2026-08-19 | **OPEN-6 lab same-origin iframe** — producer nested host + Projected blank iframe; lab `iframe-open` `iso.nested` / `iso.nested.blank`. Not a protocol version bump. Production not cutover. |
