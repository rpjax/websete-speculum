# PageProjection — Dom plane redesign (sealed)

> Legacy filename `dom-projection-diff-streams.md` until T12 rename to
> `page-projection-*.md`. Vocabulary: **PageProjection** mode/pipe;
> this file = **Dom plane** contract. CSSOM plane =
> [dom-projection-cssom.md](dom-projection-cssom.md).

**Status:** **SEALED** — Dom plane behaviour. Together with
[dom-projection-cssom.md](dom-projection-cssom.md): **PageProjection behaviour
design complete** (Dom + Cssom planes).  
**Cutover only (not behaviour gaps):** T11 code rename/implement · T12 doc
filenames. Legacy filename retained until T12.  
**Not yet** the sealed V1 *implemented* producer —
[dom-projection-diff-pipeline.md](dom-projection-diff-pipeline.md) until cutover.

**Purpose of this file**

1. **Sealed Dom-plane contract** for PageProjection (ops, selectors, chronology).  
2. Historical notepad / decision log for how we got here.  
3. Pointers to CSSOM plane + cutover (T11/T12).

**Related:** [dom-projection-cssom.md](dom-projection-cssom.md) (CSSOM plane) ·
[dom-projection-diff-pipeline.md](dom-projection-diff-pipeline.md) ·
[dom-projection-input.md](dom-projection-input.md) ·
[dom-projection-virtual-assets.md](dom-projection-virtual-assets.md) ·
[naming.md](naming.md)

**How to use**

- Sections marked **LOCKED** are the Dom-plane contract.  
- **OPEN** remaining here = T11 (code cutover) and T12 (doc filenames).  
- Do not implement cutover from stale pipeline docs — use this + CSSOM sealed
  docs; pipeline file is legacy until superseded.

---

## 0. Topic queue (work top → bottom)

| # | Topic | State |
|---|--------|--------|
| T0 | CSS vs CSSOM vs animation (facts) | NOTE (read first) |
| T1 | CSSOM plane (moved out) | **SEALED** → [dom-projection-cssom.md](dom-projection-cssom.md) |
| T2 | Diff package: exclusive payload per op | **LOCKED** for DOM |
| T3 | `document` establish + generation bump policy | **LOCKED** — minimize document; bump only on Document object swap |
| T4 | Dirty / observe → emit (D2) | **LOCKED** — 1 MO record = 1 atomic ACID diff |
| T5 | Immediate emit + backpressure | **LOCKED** — emit ASAP; overflow→desync |
| T6 | Operation vocabulary + payloads | **LOCKED** — document\|childList\|patch\|scrollViewport\|scrollElement |
| T7 | Anchor stamp vs wire `selector` | **LOCKED** — always op target; DomSelector; qSA===1 else desync |
| T8 | Selector miss / resync | **LOCKED** flow + Resync DTO + input disarm |
| T9 | Text nodes / characterData / stamp vs address | **LOCKED** — text stays a real node; addressed by `DomSelector.childAt` |
| T10 | Emitter boot: init on every install | **LOCKED** — simple `init()`; no V1 createElement wrap |
| T11 | Wire / proto / API / client apply cutover | OPEN — behaviour sealed; E2E `PageProjection` rename + ops |
| T12 | Docs migration (filenames + pipeline/coalesce) | OPEN — after/with T11 |
| T13 | `F` structural 1:1 + placeholders + shared `F(DOM)`/`F(querystring)` | **LOCKED** — placeholder set + naming |

**Next conversation:** T11 cutover (`PageProjection` rename + planes). DOM plane contract below remains valid under the new mode/pipe name.

### LOCKED (2026-08-06) — D16 internal props (plain)

**Problem:** Some element truth lives in **JS properties**, not in HTML attrs
MutationObserver sees. If `F`/`patch` omit that, Virtual and Projected can
diverge with **no sequence gap** (“ghost desync”) — e.g. lost keystroke →
Virtual `.value` ≠ projected field, and nothing heals it.

**Rule of thumb (LOCKED):** Be **rigorous** about state that can cause
**ghost desync** (must ride in `F`/`patch` + sensors). Do **not** mirror
things that can stay fully **offloaded to the client** (e.g. caret/selection).
Expand the allow-list when a real ghost-desync case appears — same criterion,
no philosophy reopening.

**V1 in `F`/`patch` (LOCKED)**

| Prop | Why |
|------|-----|
| `input`/`textarea` `.value` → `speculum-input-value` | Typing round-trip + heal |
| checkbox/radio `.checked` → `speculum-input-checked` | Same |
| `option` `.selected` / select value → existing Speculum attrs | Same |

**Observe (LOCKED):** MO alone is **not** enough for these. Extra sensors
(e.g. `input` / `change`) must be able to emit a `patch` with the `F`
snapshot of that node when the property changes.

**Apply (not D16 invent):** Client may coalesce/timeout **only** for the
“user is editing this control” conflict class — **not** a global delay on
every patch. Patch payload must still carry the value.

**Out of `F` DOM for V1 (LOCKED)**

- Computed style / layout geometry  
- Canvas / WebGL pixels  
- Caret / text selection (local OK; jump on force overwrite accepted)

### LOCKED (2026-08-06) — Scroll (not F props)

- **Resolution Virtual ↔ Projected:** exact match (motor invariant). Never
  treat layout/resolution drift as acceptable.  
- **Same `sequence` timeline** as all other Dom Diff ops (one chronology).  
- **`generation++` → `sequence` restarts** for that epoch (first diff of the
  new generation uses the restarted counter).  
- **Client → Session:** `DomProjectionIntent` scroll, **all** scrollers,
  position **absolute**; coalesce = last sample. Mirror the two wire ops below
  (viewport vs element) — no nullable mega-payload.  
- **Virtual → Client:** two dedicated ops (no nullable union envelope):

| Op | Address | Payload |
|----|---------|---------|
| `scrollViewport` | none (viewport) | `{ scrollX, scrollY }` absolute |
| `scrollElement` | `selector` (scroll container) | `{ scrollTop, scrollLeft }` absolute |

- **Echo filter (LOCKED approach):** per scroller (viewport or element) the
  Virtual side records the **last position it applied from a client intent**.
  On a `scroll` event, if the observed absolute position **equals** that stored
  value, the event is our own echo → **do not emit**, clear the mark. Any other
  position → page-initiated → emit `scrollViewport` / `scrollElement`.
  No timers, no heuristics; a coincidental page scroll to the identical
  position is a no-op for the client anyway (it is already there).  
- Do **not** put scroll offsets in `F` tree snapshots.  
- **Content effects** (load more, etc.): normal DOM ops (`childList` / `patch`).

---

### 0.2 Seal audit (2026-08-06)

All three gaps are now **LOCKED**: G-A (`DomSelector` object — spec in T7),
G-B (pierced-root swap, T3) and G-C (`sequence` allocation, T4). **DOM has no
open contract gap.** Kept here as the record of what was closed and why.

**G-A (LOCKED 2026-08-06) — `selector` becomes an object (`DomSelector`)**

Text nodes are **real DOM nodes** (`p.childNodes` contains them; MO
`characterData.target` *is* the `#text`). We keep them as nodes — we do **not**
fold text into a parent property. What changes is the **address**: a bare CSS
string can only ever resolve an `Element`, so the wire address is promoted from
a `string` to a small **tagged object**. Full spec in **T7**.

```text
DomSelector = element { query }          // locus = the resolved element
            | childAt { query, index }   // locus = F-visible child #index of it
```

`querySelectorAll(query)` + `length === 1` stays the **canonical** resolve rule —
it is what both variants use to reach an element. `childAt` then steps to one
child inside the F-visible child space (same space as `added[].index`).

---

### 0.1 DOM closure checklist (before CSSOM)

Ignore T0/T1 CSSOM shape until this table is clear. “Must debate” = blocks a
honest DOM contract; “Can defer” = wire/DTO polish after behaviour is locked.

| Id | Item | Status | Must debate before CSSOM? |
|----|------|--------|---------------------------|
| D1 | Op set + payload shapes | **LOCKED** — `document` \| `childList` \| `patch` \| `scrollViewport` \| `scrollElement` | Done |
| D2 | Observe→emit | **LOCKED** — 1 record = 1 ACID diff; stamps/ignore locked | Done |
| D3 | Immediate emit; no time coalesce; `sequence++` | **LOCKED** | Done |
| D4 | Generation bump only on real Virtual document swap | **LOCKED** — token and/or CDP non-same-document; not framenavigated alone | Impl wiring |
| D5 | Emitter boot + first `document` | **LOCKED** — `init()` per install; sequence restarts with generation | Done |
| D6 | Selector writer + pierce | **LOCKED** — Speculum+positional; qSA===1; pierce V1 mandatory | Done |
| D7 | Stamps + LMS | **LOCKED** — LMS in diff from Virtual; client never stamps | Done |
| D8 | Placeholder vs pass-through + naming | **LOCKED** — set + interior + concrete attr/host names | Done |
| D9 | characterData | **LOCKED** — `patch` of the text node via `DomSelector.childAt` | Done |
| D10 | Kill `replace` / solo insert-remove | **LOCKED** — structure = MO `childList` only | Done |
| D11 | Resync route/DTO | **LOCKED** naming below (T8); telemetry catalog soft | Soft: telemetry ids |
| D12 | Input arm during desync | **LOCKED** — disarm until resync `document` applied | Done |
| D13 | Backpressure → desync | **LOCKED** — overflow/degraded → desync (never silent drop) | Done |
| D14 | Sequence shared with CSSOM | **LOCKED** in [dom-projection-cssom.md](dom-projection-cssom.md) C1 — shared seq+gen | Done |
| D15 | Docs cutover | T12 | After DOM sealed |
| D16 | Internal element state in `F` / patch | **LOCKED** form controls; scroll = separate op (above) | Done |
| G-A | Non-element (text/comment) addressing | **LOCKED** — `DomSelector` object: `element` \| `childAt` | Done |
| G-B | Pierced document swap vs generation | **LOCKED** — iframe swap never bumps generation | Done |
| G-C | Ignored records vs `sequence` allocation | **LOCKED** — allocate only when a diff is emitted | Done |

---

## T0 — NOTE: CSS vs CSSOM vs “what animates the site”

### Short answers

| Question | Answer |
|----------|--------|
| Does the **CSSOM tree** “control animations”? | **Sometimes, not usually as the main driver.** |
| Is it true that “CSS doesn’t change, CSSOM does”? | **Mostly yes** for *stylesheets in memory*: the authored CSS text is parsed into the **CSS Object Model** (rules, declarations). Runtime often mutates CSSOM *or* DOM attrs that change **computed style**. |
| Do we want a **dedicated CSSOM plane**? | **Yes** — same PageProjection pipe, `plane: cssom` (sealed in cssom doc). |

### Accurate mental model

```
Author CSS text  →  parse  →  CSSOM (StyleSheet / CSSRule tree in the engine)
                              ↓
DOM + CSSOM + cascade  →  computed style per element  →  layout / paint / composite
                              ↑
                     class/style attrs, WAAPI, etc.
```

- **CSS (source text)** — what authors wrote in files / `<style>` blocks. Often
  immutable on disk; the engine’s live view is CSSOM.
- **CSSOM** — live object tree of stylesheets and rules (`CSSStyleSheet`,
  `CSSStyleRule`, `insertRule`, `deleteRule`, `cssText`, …). Script can mutate
  rules **without** changing a DOM node’s attributes.
- **What usually “animates” a marketing / storefront page (e.g. Eneba)**  
  1. **DOM attribute / class changes** → computed style changes → CSS
     transitions / keyframe animations already described in stylesheets.  
  2. **Web Animations API** / JS-driven style on elements.  
  3. **Less often:** mutating CSSOM rules or `@keyframes` in place.

So: the **DOM plane** catches (1) well. The **CSSOM plane** catches (3) and
stylesheet rule edits that **never** show up as DOM mutations. Dropping CSSOM
entirely would miss a real class of updates; treating CSSOM as “the thing that
animates the site” overstates it.

### Implications for Speculum

- Projected DOM has **no page JS**. Animations that depend on site JS / WAAPI
  will not run locally; we only see **effects** if they land as DOM and/or CSSOM
  mutations we project.
- Stylesheets on the projected side are mostly **materialized CSS text** in
  `<style>` placeholders (today). Rule-op mapping lives on the **CSSOM track**
  — [dom-projection-cssom.md](dom-projection-cssom.md).

---

## T1 — CSSOM plane (sealed elsewhere)

Dom plane is **sealed in this file**. CSSOM plane + PageProjection naming are
**sealed** in [dom-projection-cssom.md](dom-projection-cssom.md).

One PageProjection pipe; envelopes use `plane: dom | cssom` (not two streams).
Do **not** expand CSSOM gaps here.

---

## T2 — LOCKED: Diff package shape (Dom plane)

PageProjection pipe envelope (Dom-plane ops below; Cssom-plane ops in CSSOM
doc C3):

```text
PageProjectionDiff {
  plane: "dom"             // or "cssom" — see cssom doc
  sequence: number         // shared; restarts on generation++
  generation: number
  operation: enum          // T6 (dom) or CSSOM C3 — exactly one payload
  // exclusive Dom-plane payloads (no nullable mega-union across ops):
  document?:       { root }                         // html after F
  childList?:      { selector: DomSelector, removed, added }
  patch?:          { selector: DomSelector, node }  // F snapshot, no children
  scrollViewport?: { scrollX, scrollY }
  scrollElement?:  { selector: DomSelector, scrollTop, scrollLeft }
}
```

`selector` is always a **`DomSelector`** object (T7) — never a bare string.

**Rules (LOCKED)**

1. One envelope = one atomic apply unit (`sequence++` on the timeline).  
2. Payload object matches `operation` only — **no** shared nullable bag.  
3. Emitter does **not** climb to parent to “find a clean root”.  
4. Client validates full applicability before mutate; else desync.  
5. Multi-root pierce observers **push** into one emitter; **emitter alone**
   assigns `sequence` order.  
6. `selector` = op target; resolve deterministic → one node or desync (T7).

---

## T3 — LOCKED direction: `document` establish + generation

### DOM `document` op (aligned with T6)

- Root of payload **must** be mapped `<html>` (após `F`).  
- **No `selector`** — implicit projected document root.  
- Emit ASAP when emitter becomes live (tree may still be loading).  
- Live progressive updates continue via `childList` / `patch` /
  `scrollViewport` / `scrollElement`.

### Generation bump (LOCKED — D4)

**Goal:** minimize `document` diffs (flicker, asset reload, cost). Default path
is incremental `childList` / `patch`.

**When `document` + `generation++` are allowed**

| Case | `document`? | `generation++`? |
|------|-------------|-----------------|
| Emitter boot / first establish | Yes | Yes (epoch start) |
| **Top-level** Virtual Document object actually replaced | Yes | Yes |
| Client OOB resync fetch | Yes | **Only if** producer generation already changed — resync alone must not invent a bump |
| SPA re-render / soft wipe / same-document nav | **No** | **No** |
| **Pierced** (iframe/shadow) document swap | No (subtree `childList`) | **No** |

**Detection (LOCKED policy — not `location`)**

- Do **not** bump on URL / router / Playwright `framenavigated` **alone**
  (today’s false-positive source for SPAs).  
- `framenavigated` may **wake** a check; it is not sufficient evidence.  
- **Same-document / within-document** navigation (CDP
  `navigatedWithinDocument` or equivalent) → **never** bump / never live
  `document` for that reason (location sync stays elsewhere).  
- **Evidence of Document replacement** (either is enough to bump):  
  1. **In-page document token** — on install, mark the current `document`;
     if the live `document` no longer carries that token (new Document /
     init re-ran on a new document) → bump + `document`.  
  2. **CDP non-same-document** frame navigation → bump + `document`
     (corroborate with token when both available).  
- MO alone never bumps generation (large `childList` wipes stay incremental).

**Ground truth:** same **top-level** Document object → incremental stream; new
top-level Document object → establish `document`.

### Pierced root swap (LOCKED — G-B)

An **iframe** (or other pierced document) navigating is a new Document object
for **that root only**. It **never** bumps the global `generation` and **never**
emits a global `document`:

1. Tear down the observer on the old pierced document; re-`init()` on the new
   one (stamp its tree first — same invariant).  
2. Re-establish only that host’s subtree with normal ops on the **same**
   generation: one `childList` on the host (remove previous mapped children,
   add the new pierced tree).  
3. Global `generation` / `sequence` timeline continue untouched.

`generation` is therefore a **top-level document epoch**, not a per-root epoch.

### Impl note (not a product gap)

- CDP / Patchright event wiring for D4 detection.  
- Client atomic apply of `document` (ACID same as other ops).
---

## T6 — LOCKED: DOM operation vocabulary + payloads

Wire op names (DOM stream):
**`document` | `childList` | `patch` | `scrollViewport` | `scrollElement`**.

**Supersedes:** solo `insert` / `remove` / `replace`; single nullable `scroll`.
Structure mirrors MO for tree ops (`childList`). Scroll is Virtual→client
position sync (not an MO tree record) — **two** ops, no nullable union.

Envelope rules:

- Exactly one payload object for `operation` (see T2).  
- Live tree: **one MO `MutationRecord` → one diff → one `sequence`.**  
- Scroll / `document`: also take a `sequence` on the **same** timeline.  
- `sequence` **restarts** when `generation` bumps.  
- `node` payloads are pós-`F` (placeholders, stamps, virtual URLs, D16 props).
  **`speculum-last-mutation-sequence` is written on Virtual before emit** and
  **rides inside `F`** — client applies it from the payload; **client never
  stamps**.

Every `selector` below is a **`DomSelector` object** (`element` \| `childAt`) —
see T7.

| Op | Source | Selector = **op target** | Payload |
|----|--------|--------------------------|---------|
| `document` | boot / real document swap / OOB resync body | omitted (implicit root) | `{ root }` (`root.tag === "html"`) |
| `childList` | MO `childList` | parent of the mutation (`element`) | `{ removed, added }` |
| `patch` | MO `attributes` / `characterData` / form sensors | mutated node (`element`, or `childAt` for text) | `{ node }` F snapshot, no `children` |
| `scrollViewport` | Virtual scroll sensor (viewport) | omitted (viewport, not a node) | `{ scrollX, scrollY }` absolute |
| `scrollElement` | Virtual scroll sensor (element) | scroll container (`element`) | `{ scrollTop, scrollLeft }` absolute |

### `childList` payload (LOCKED)

```text
removed: [ { selector } … ]   // identity of each removedNodes entry
added:   [ { index, node } … ] // each addedNodes entry
```

- `removed[].selector` — `DomSelector`. Elements: `element` built from the
  **detached** node object in the record (stamp still on it). Text / comments:
  `childAt` with the parent `query` + the child’s index. Both resolved on the
  **projected pre-op** tree.  
- `added[].index` — F-visible siblings **strictly before** that node under the
  parent on **Virtual at emit** (already post-mutation). Same rule as the old
  solo-insert index (e.g. insert `x` before `c` in `[a,b,c]` → final
  `[a,b,x,c]` → `index = 2`).  
- One-sided records are normal: only removes, or only adds — still `childList`,
  empty array on the other side. **Not** different wire ops.

### `childList` apply — ACID (LOCKED)

Client **validates** the whole diff can apply **before** mutating. If not →
**desync** (no partial apply).

Apply (single transaction):

1. **Resolve every address in the diff to a concrete node reference first**
   (validate phase, all against the same **pre-op** tree). This is what keeps
   multiple `removed[]` indices valid — nothing is detached while indices are
   still being read.  
2. Remove every resolved `removed[]` node from the projected parent.  
3. Insert every `added[]` at its `index`, in **ascending index order**.  
4. Commit. Projected nodes carry `speculum-last-mutation-sequence` **from the
   `F` payload** (Virtual SoT) — client does not invent LMS.

### Patch snapshot (LOCKED)

- Same `F(DOM)` path as elsewhere (no special delta schema).  
- No `children` in patch snapshot (apply must ignore/not require them).  
- Must carry whatever “internal element state” `F` maps (D16).  
- Also **ACID**: validate then apply, else desync.

### Replace (LOCKED — killed)

MO has no `replace` type. `replaceChild` / etc. arrive as `childList` with
`removedNodes` and/or `addedNodes`. Wire: one `childList` diff — never a
`replace` op, never split across sequences.

### Naming (LOCKED)

| Concept | Wire / attr name |
|---------|------------------|
| Node address | `selector` (type `DomSelector`, variants `element` \| `childAt`) |
| Anchor | `speculum-anchor` |
| LMS | `speculum-last-mutation-sequence` (numeric string) |
| Placeholder host tag | `div` |
| Original tag | `speculum-projected-tag` |
| Shadow / iframe markers | `speculum-shadow-root`, `speculum-shadow-closed`, `speculum-iframe` |
| Form extras | `speculum-input-value`, `speculum-input-checked`, `speculum-option-selected` |

### OPEN under T6

- None for Dom-plane vocabulary (Cssom-plane ops sealed in CSSOM C3).
---

## T4 — LOCKED: Observe → emit (D2) — MO atom = diff atom

### LOCKED (2026-08-06)

**Atom**

- One `MutationRecord` → one diff → one `sequence++`.  
- Diff is the MO atom — do not invent finer wire ops than the record type.  
- Callback with N records → N diffs, **callback order**.  
- Do not call a rich `childList` payload a “batch”; it is **one** atomic diff.

**MO type → wire op**

| MO `type` | Wire op |
|-----------|---------|
| `childList` | `childList` (`removed` + `added`; either side may be empty) |
| `attributes` | `patch` |
| `characterData` | `patch` of the **text node** (`DomSelector.childAt`) |

**ACID apply (all diffs)**

- Client **validates** full applicability **before** mutating.  
- Impossible to apply → **desync** (no half-apply).  
- `childList` validate+apply: all removes, then all adds by ascending final
  `index` (T6).

**Virtual ahead**

- At emit, Virtual is already post-mutation.  
- `added[].index` from Virtual final; `removed[]` identity from record node
  objects; resolve removes on projected **pre-op**.

**Chronology**

- Emit order = MO record order. No ad-hoc reordering / coalesce across records.

**Selector (LOCKED — same invariant as T7)**

- `selector` always resolves to the **op target node** (deterministic, else
  desync). Complexity for non-element loci lives in `DomSelector`, not in
  per-op hacks.  
- Op semantics choose *which* node is the target (`childList` → parent;
  `patch` → mutated node; `removed[]` → that removed node). Selector does not
  reinterpret.

### LOCKED (2026-08-06) — Stamps + ignore-list + LMS SoT

**Invariant (one-liner, LOCKED):** In the MO callback path, **stamp anchors
immediately and always, before any other logic.** No attr-capable node is
treated as part of the tree for emit / `F` / selectors without an anchor
(nodes that cannot carry the attr are the only exception — addressed by
selector writer only).

Also under each added root: stamp every attr-capable descendant that `F` will
publish.

**Virtual is source of truth for LMS.** Client **never** stamps
`speculum-anchor` or `speculum-last-mutation-sequence`. LMS arrives **inside
`F` payloads** (and thus on projected nodes after apply).

**Vocabulary (Virtual only)**

- `StampAnchors()` — `speculum-anchor`.  
- `StampLastMutationSequence()` — `speculum-last-mutation-sequence` = this
  diff’s `sequence` on nodes touched by the atom **before** `F`/emit.

**Callback shape (LOCKED)**

```text
StampAnchors()                          // delivery addedNodes (+ F descendants)
foreach mutationRecord in records:      // multi-root: queued into this emitter
    if IsIgnored(record): continue      // stamp attrs -> NO sequence consumed
    sequence++                          // emitter owns global chronology
    StampLastMutationSequence(touched)  // so F carries LMS
    EmitDiff(record)                    // build payload on stamped DOM
```

**`sequence` allocation (LOCKED — G-C):** a `sequence` is allocated **only** for
records that actually emit a diff. Ignored records (stamp-attr mutations, or
anything the ignore-list drops) consume **nothing** — otherwise the client would
observe a phantom gap and desync for no reason. Same rule for scroll ops: they
allocate when they emit.

Scroll ops use the same emitter `sequence++` (no MO record).

**Multi-root pierce:** observers on main / shadow / iframe documents **push**
records into **one** emitter; the emitter alone serializes and assigns
`sequence`.

**Ignore-list = reflection of stamps**

MO `attributes` for `speculum-anchor` / `speculum-last-mutation-sequence` (and
any other stamp-writer attrs) are **not** emitted as `patch`.

**Consequences**

1. Stamp writes → later MO deliveries → ignore-list (no loop).  
2. LMS is on Virtual **before** emit → present in `F` → client applies from
   diff only.  
3. Boot: `StampAnchors` (+ LMS as needed) before first `document` emit.

---

## T5 — LOCKED: Emit timing + backpressure

### LOCKED (2026-08-06)

- After allocate `sequence` → stamp LMS → build diff: **emit immediately**.  
- **No intentional time coalesce** for correctness.  
- Ordering is `sequence` (+ `generation`); `sequence` restarts on generation bump.  
- Volume may be high; correctness ≠ capacity (perf track separate).  
- **Backpressure / overflow / degraded emit path → desync** (never silently
  drop a live diff). Thresholds are config/impl detail.

---

## T7 — LOCKED: Anchor vs `selector` + writer policy (D6)

### LOCKED

- **Wire address field:** every op that needs a locus carries **`selector`**
  (`document` / `scrollViewport` omit — no node locus). Its value is a
  **`DomSelector` object**, not a bare string (see below).  
- **Selector invariant (LOCKED — stone):** `selector` **always** addresses the
  **operation target node**. Resolve is deterministic: exactly one node, or
  **desync**. There is **no** per-op / edge-case resolve logic outside
  `DomSelector`. Edge cases that CSS strings cannot express (text / comment)
  are absorbed by expanding the **selector object** (`childAt`), not by
  special-casing ops.  
- **Target vs “parent”:** some ops’ target *is* a parent because the op mutates
  children through that node (e.g. `childList` target = MO parent). That is
  **op semantics**, not ad-hoc selector behaviour. Selector still just
  resolves “the target”. Same for `removed[]` entries: each entry’s selector
  targets **that** removed node.  
- **Resolve API:** `querySelectorAll(query)` on the apply root; require
  **`length === 1`**. `0` or `>1` → **desync** (T8). `childAt` then steps to
  F-visible child `index` (missing → desync). No custom query language.  
- **Writer vocabulary (LOCKED):** only **Speculum-controlled** addressing +
  **positional** steps in `F`-space — e.g. `[speculum-anchor="…"]`,
  `:nth-child(n)` / equivalent among F-visible siblings. **Do not** use page
  `id` / `class` / `data-*` (or other site attrs) in selectors — they churn and
  break addresses.  
- **Writer preference (LOCKED):** unique `[speculum-anchor]` when it alone
  yields one match; else nearest ancestral stamp + relative positional path
  (e.g. `[speculum-anchor="x"] > :nth-child(2)`). Best-effort localize;
  deterministic for tree state at sequence N. **Note:** `:nth-child` counts
  **elements only** — it can never reach a text node; that is what
  `DomSelector.childAt` is for.  
- **Stamp:** every attr-capable node stamped before emit (D7).  
- `F(querystring)` shares structural rules with `F(DOM)` (T13) so Virtual write
  and Projected resolve stay isomorphic.

### `DomSelector` object (LOCKED 2026-08-06 — closes G-A)

CSS can only resolve **Elements**, but `#text` / comments are real nodes and
real loci (`characterData` → `patch` of the text node; `removed[]` may contain
text). So the address is a **tagged object with exactly two variants** — never
one struct with an optional index:

| Variant | Fields | Locus |
|---------|--------|-------|
| `element` | `query` | the **single** element resolved by `query` |
| `childAt` | `query`, `index` | the **F-visible child node** at `index` of the single element resolved by `query` |

**Resolve (both variants):** `querySelectorAll(query)`, require
`length === 1` → else **desync**. `childAt` additionally requires that the
element’s F-visible child list **has** an entry at `index` → else **desync**.
`query` itself follows the writer vocabulary above (Speculum + positional only).

**Index space:** F-visible **child nodes** of the resolved element — elements
*and* text runs, in document order. Exactly the same space as `added[].index`
(T6); there is not a second counting rule.

**Which variant each locus uses**

| Locus | Variant |
|-------|---------|
| `childList.selector` (the parent) | `element` |
| `patch.selector` — attributes / form state | `element` |
| `patch.selector` — `characterData` (text / comment) | `childAt` (parent `query` + child `index`) |
| `removed[]` entry — element | `element` (its own `speculum-anchor`) |
| `removed[]` entry — text / comment | `childAt`, resolved on the **projected pre-op** tree |
| `scrollElement.selector` | `element` |

**Text-run invariants (LOCKED — make the index space identical on both sides)**

1. **`F` collapses adjacent text nodes** into a single F-visible text run.
   Virtual can hold two neighbouring `#text` by parser / `insertBefore`
   accident; `F` normalizes so that quirk never reaches the index space. A
   `characterData` record on any of them emits the **whole collapsed run**.  
2. **Client materializes exactly one text node per declared run** and never
   calls `normalize()` / merges / splits text on its own. Without this the
   client could silently fuse two runs on apply and shift every later index in
   that parent — precisely the ghost-desync class D16 exists to prevent.

**Transport shape:** a discriminated union (proto `oneof`, and a tagged concrete
hub DTO) — **not** `{ query, index? }`.

### Pierce (LOCKED — V1 mandatory)

**Pierce is required in V1.** Without it Dom Projection is incomplete.

**Contract**

- `F` maps main document + pierced **shadow roots** + pierced **iframe**
  documents into **one** structurally 1:1 tree (boundary hosts keep marker
  attrs `speculum-shadow-root` / `speculum-shadow-closed` / `speculum-iframe`).  
- Live stream (`childList` / `patch` / stamps / MO) covers those same roots:
  `init` / observe / stamp per pierced document or shadow root as needed.  
- **Selectors** address that **F-flattened** tree only — Speculum + positional
  + `querySelectorAll` / `length === 1`. No special pierce combinator on the
  wire. Projected side has no real iframe/shadow JS; flatten makes qSA enough.  
- Cross-origin iframes: pierce via Chromium control (same doctrine as current
  F pipeline docs).

**Not a gap for this lock:** phased *implementation* order (main → shadow →
iframe) may ship incrementally **only if** product accepts temporary holes;
**contract** still says V1 complete = pierce all. Prefer treat pierce as
non-optional for “DOM sealed”.

### Multi-root (LOCKED)

Pierced observers push into one emitter; emitter assigns `sequence` (see T4).

---

## T8 — LOCKED: Sync / resync flow + DTO + input arm

### Separate concerns (LOCKED)

| Mechanism | Role |
|-----------|------|
| `sequence` | Chronology + gap detection + “am I contiguous?” |
| Selector match (`0` or `>1` nodes) | Apply-time address failure — **not** mixed into sequence semantics |

Ambiguous selector = resolve → not exactly one target → desync. Do not overload
`sequence` for that.

### Client-initiated resync flow (LOCKED)

Emit path / live stream **unchanged** (producer keeps pushing with normal
`sequence++`).

On desync (gap **or** selector failure):

1. Client marks itself **desynced**.  
2. Client **buffers** inbound live diffs (does not apply).  
3. Client calls **`PageProjection.Resync`** (OOB) for a joint snapshot.  
4. That fetch must **not** allocate or advance the official live `sequence`.  
5. Response carries watermark (`generation` + `coversThroughSequence`).
   Client may send `currentSequence` / `currentGeneration` as hints.  
6. Client applies **both** Dom `document` root and CSSOM `install`, then
   rebuilds maps (CSSOM C8).  
7. Client drains buffer: **drop** obsolete envelopes (old generation,
   `sequence` ≤ watermark, etc.); **apply** still-valid newer live envelopes in
   order; then return to live apply.

Live `sequence` stays monotonic on the PageProjection pipe; resync is a side
channel. Watermark is required because Virtual “now” may already be ahead.

### LOCKED — Resync route / DTO naming + input arm

**Route (hub or HTTP equivalent):** `PageProjection.Resync`  
(renames legacy `DomProjection.Resync` at cutover)

Request:

```text
{ generation: number, sequence: number }   // client’s last contiguous apply
```

Response (OOB — does **not** advance live `sequence`):

```text
{
  generation: number,
  coversThroughSequence: number,   // watermark
  root: <F(html)>,                 // Dom plane — same shape as `document` op
  sheets: <CSSOM install>          // Cssom plane — ids + scope (CSSOM C4/C8)
}
```

- **Input during desync:** **disarmed** until joint resync is applied and live
  drain resumes.  
- Telemetry catalog event ids: soft (impl); catalog prefix
  `Telemetry.Sessions.PageProjection.*` after rename.

---

## T9 — LOCKED: Stamp vs address for non-element nodes

### LOCKED

- Stamp mandatory on attr-capable nodes before emit.  
- `#text` / comments **stay real nodes** in `F` and in the projected tree. They
  cannot hold an anchor attr, so they are addressed by
  **`DomSelector.childAt`** — stamped parent `query` + F-visible child `index`
  (spec: T7). This closes G-A.  
- characterData → **`patch`** of the text node (not a separate op type).  
- **Rejected:** wrapper elements around text (P3) — adding elements that do not
  exist in Virtual breaks structural 1:1 and shifts author CSS
  (`:nth-child`, `> *`).  
- **Rejected:** folding text into a parent property — a single `text` prop is
  lossy for mixed content (`<p>Hello <b>x</b> !</p>` loses where `<b>` sits).  
- `F` collapses adjacent text nodes into one run; client keeps one text node per
  run and never `normalize()`s (T7 invariants).

### Soft

- Illustrative `F(querystring)` examples (engineering; policy locked in T7).

---

## T10 — LOCKED: Emitter boot = `init()` on every install

### LOCKED (2026-08-06)

**No special protocol.** Each **installation** runs the same `init()`:

1. Install observer + hooks on the current Virtual Document.  
2. `StampAnchors()` on the existing tree (parser may already have
   `html`/`head`/`body` — init script alone is not enough; stamp on activate).  
3. Emit first `document` (ASAP; tree may still be incomplete — T3).  
4. Then only the live MO path (`StampAnchors` → EmitDiff → StampLMS).

**When `init()` runs**

- Sidecar starts Dom Projection on a Document.  
- D4 detects a **new** Document object → re-`init()` (after tearing down the
  previous observer on the old document).

Same-document soft nav does **not** re-`init()` (D4).

**Not required for V1**

- Wrapping `createElement` / `appendChild` (optional defense in depth later).

### LOCKED adjacent

- On `generation++`, live `sequence` **restarts** for that epoch (client drops
  old-generation envelopes — T8).  

### Parked

- CSSOM `install` alongside first Dom `document` on boot — same epoch; emitter
  may emit Dom `document` then Cssom `install` (two envelopes, shared
  sequence) — CSSOM C4.

---

## T13 — LOCKED: Structural `F`, placeholders, shared rules

### LOCKED (2026-08-06)

1. **Purpose of placeholders**  
   Keep a **structural slot** (1:1 sibling/index space) while preventing
   **native projected semantics** that are unsafe or incompatible with
   pierce/projection (page JS, nested browsing context, URL base hijack,
   plugin/embed execution). Placeholders are not decorative taste — they are
   the tags where “emit the real tag on the client” would break the model.

2. **Policy (B) — structural placeholders (not hard-delete)**  
   Those tags are emitted as a **safe host** (e.g. `div`) plus a Speculum attr
   recording the original role (illustrative: `speculum-projected-tag="script"`).
   **Do not** silently omit the node (`SKIP`/delete) — holes break positional
   addressing.

3. **Placeholder membership (LOCKED — criterion + V1 set)**  
   Placeholder iff native tag on the projected client would be unsafe or
   incompatible with pierce/1:1. V1 set:

   `script`, `noscript`, `template`, `iframe`, `base`, `object`, `embed`, `applet`

   Security review may **add** tags by the same criterion only (explicit list
   update — no ad-hoc per-site). **Pass-through** = every other element tag
   (after attr deny-list + virtual URL rewrite).

4. **Interior (LOCKED)**  

   | Kind | Interior |
   |------|----------|
   | `iframe` placeholder | Pierced document tree flattened as normal children (1:1) |
   | Other placeholders above | **Empty** for publish (no executable / template payload) — slot matters, not payload |

5. **Not the same mechanism**  
   `canvas`: may keep tag + `speculum-canvas-placeholder` (no pixels) — box
   semantics OK; not a tag→host rewrite unless later required.  
   Shadow host: pass-through element + boundary marker; children from shadow
   flattened (not an iframe-style tag rewrite).

6. **`F(DOM)` emits a structurally 1:1 tree**  
   Element slots and sibling order match Virtual after placeholder rewrite
   (main + pierced forest). Not byte-identical HTML / same tag names everywhere.

7. **`F(DOM)` and `F(querystring)` share one rule module**  
   Same pass-through vs placeholder, pierce, F-visible children, attr rules
   relevant to addressing.

### Naming (LOCKED — see T6 table)

Host `div`; `speculum-projected-tag`; shadow/iframe markers as T6.

### Soft

- Formal `F(querystring)` string examples (engineering).

---

## T11 — OPEN: Implementation cutover

**Behaviour** for Dom plane + Cssom plane is sealed. Cutover **must** include
the **PageProjection** semantic rename end-to-end (see CSSOM C9 table): config
wire, `ILiveSession` stream names, API folders/namespaces, proto/gRPC, sidecar
producer, web client, telemetry catalog — **no** `DomProjection` as mode/pipe
name left behind; **no** V1 aliases.

Also land: Dom ops + `DomSelector`, Cssom ops + `CssomSelector`, shared
sequence/`plane`, joint `PageProjection.Resync`, owned CSSOM apply, pierce
scope lifecycle.

T12: docs migration (`dom-projection-*.md` → `page-projection-*.md` or banners;
pipeline/coalesce supersession).

---

## T12 — OPEN: Docs migration

Behaviour sealed; with or after T11:

- Rename `dom-projection-*.md` → `page-projection-*.md` (or permanent banners).  
- Rewrite/supersede [dom-projection-diff-pipeline.md](dom-projection-diff-pipeline.md)
  (dirty-climb / URL-reload cssom).  
- Revisit [dom-projection-coalesce.md](dom-projection-coalesce.md) (correctness:
  no intentional time coalesce — T5).  
- Update input + virtual-assets docs to `MirrorMode.PageProjection` vocabulary.  
- Cssom plane stays specified in the CSSOM doc (renamed under PageProjection).

---

## Decision log (append-only)

| Date | Topic | Decision |
|------|-------|----------|
| 2026-08-06 | Meta | This notepad/contract file created; debate topic-by-topic. |
| 2026-08-06 | T0 | CSSOM ≠ “the animator”; dedicated CSSOM stream still desired. |
| 2026-08-06 | T1 | Direction: DOM + CSSOM streams, same behavioural model. |
| 2026-08-06 | T3 | `document` (DOM) + early CSSOM install; emit ASAP incomplete OK; then live diffs. |
| 2026-08-06 | T7/T8 | Selector on wire; anchor facilitates; miss/ambiguous → resync (details OPEN). *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T9 | Text/anchor premise needs dedicated debate. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T7 | Querystring OK only if projected-isomorphic + sequence-contiguous; anchors stay primary. |
| 2026-08-06 | T8 | Client desync → buffer → OOB document fetch (no live sequence++) → watermark drain. |
| 2026-08-06 | T8 | sequence ≠ selector validation (keep separate). |
| 2026-08-06 | T9 | Best-effort stamp + nearest ancestral anchor + relative path; text not attr-stamped. |
| 2026-08-06 | T8 | **LOCKED** resync flow (2); route/DTO still OPEN. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T8 | **LOCKED** sequence vs selector concerns stay separate (3). |
| 2026-08-06 | T7/T9 | **LOCKED** stamp mandatory before emit on attr-capable nodes; “best effort” = nearest ancestral address only (4). |
| 2026-08-06 | T13 | **LOCKED** placeholder policy (B); structural 1:1 `F(DOM)`; shared rules for `F(DOM)` + `F(querystring)`. |
| 2026-08-06 | T6/D1 | **LOCKED** DOM ops: document(html, no selector); insert(parent+index); remove; patch(F snapshot, no children); replace TBD. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T3/D4 | Generation bump only on real Virtual document swap — not SPA location/soft nav. |
| 2026-08-06 | T3/D4 | **LOCKED** minimize document; bump on Document token and/or CDP non-same-document; framenavigated alone insufficient; resync ≠ invent bump. |
| 2026-08-06 | T10/D5 | **LOCKED** boot = init() per install (stamp tree → first document → live MO); no V1 createElement wrap. |
| 2026-08-06 | T7/D6 | **LOCKED** selector = Speculum attrs + positional only; querySelectorAll length===1 else desync; shadow/iframe pierce parked. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T7/D6 | **LOCKED** pierce mandatory V1; selectors address F-flattened one-tree; no pierce combinator on wire. |
| 2026-08-06 | T13/D8 | **LOCKED** placeholder = unsafe/incompatible native tags; V1 set script/noscript/template/iframe/base/object/embed/applet; iframe interior=pierce tree; others empty; no hard-delete. |
| 2026-08-06 | D16 | **LOCKED** F carries form value/checked/selected; extra sensor beyond MO; no caret/selection/computed/pixels; scroll deferred. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | Scroll | **LOCKED** intent client→session all scrollers absolute; Virtual→client op `scroll`; no scroll in F; echo filter. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | Gaps | **LOCKED** scrollViewport/scrollElement; shared sequence; sequence restart on generation; LMS in F from Virtual only; resync DTO DomProjection.Resync; input disarm; overflow→desync; multi-root→one emitter; naming table T6; D16 ghost-desync rigor. |
| 2026-08-06 | T6/D10 | **LOCKED** kill wire `replace`; invariant: MO never has type replace — only childList remove/add. |
| 2026-08-06 | T4/D2 | **LOCKED** A–D: attr→patch; characterData→patch via general selector; childList→remove then insert; order = Virtual chronology. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T7 | Selector ≠ find-by-anchor-only; anchor localizes best-effort; every non-document op has selector pointing at op locus. |
| 2026-08-06 | T6/D2 | **LOCKED** `insert.index` = F-visible siblings before node on mutated Virtual (e.g. insert x before c → 2). |
| 2026-08-06 | T6/D1 | **SUPERSEDE** solo insert/remove; wire = document \| childList \| patch. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T4/D2 | **LOCKED** 1 MutationRecord = 1 ACID diff; childList removed+added; validate-before-apply else desync. (Supersedes split remove+insert sequences.) |
| 2026-08-06 | T4/D7 | OPEN ignore-list + lastMutationSequence write rules (anti-loop). *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T4/D7 | **LOCKED** StampAnchors → foreach (EmitDiff → StampLMS); ignore-list = stamp attr names only. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | T4/D7 | **LOCKED** StampAnchors at delivery start MUST cover that callback’s addedNodes (post-mutation Virtual) before any EmitDiff. |
| 2026-08-06 | T4/D7 | **LOCKED** one-liner: stamp anchors immediately/always before other logic; no attr-capable node in tree-for-logic without anchor. |
| 2026-08-06 | T5/D3 | **LOCKED** immediate emit; no time coalesce; sequence++ per diff. Backpressure defer. *(later refined — see LOCKED sections above)* |
| 2026-08-06 | G-B | **LOCKED** pierced (iframe/shadow) document swap never bumps generation; re-init that root + host `childList` on same generation. |
| 2026-08-06 | G-C | **LOCKED** `sequence` allocated only when a diff is actually emitted (ignored records consume nothing). |
| 2026-08-06 | Scroll | **LOCKED** echo filter = compare observed position with last intent-applied position per scroller. |
| 2026-08-06 | G-A | **LOCKED** text stays a real node; `selector` becomes object `DomSelector` = `element{query}` \| `childAt{query,index}`; qSA+length===1 unchanged; F collapses adjacent text runs, client never normalizes; validate resolves all addresses before mutating. |
| 2026-08-06 | T7 | **LOCKED (stone)** selector always = op target; resolve deterministic → one node or desync; no per-op ad-hoc resolve — edge cases absorbed by `DomSelector`; “parent” for `childList` is op semantics. |
| 2026-08-06 | DOM | **SEALED** — Dom plane; CSSOM + PageProjection naming sealed in cssom doc; remaining OPEN = T11 cutover + T12 docs. |
| 2026-08-06 | Meta | CSSOM track split to [dom-projection-cssom.md](dom-projection-cssom.md); this file = sealed DOM contract. T2 marked LOCKED for DOM; T1 becomes pointer. |
| 2026-08-06 | PageProjection | **LOCKED** (CSSOM C9) Mirror=technique; mode/pipe=`PageProjection` replaces `DomProjection`; envelope `plane: dom\|cssom`; E2E rename at cutover. |
| 2026-08-06 | Meta | **SEALED** PageProjection behaviour (Dom plane this file + Cssom plane cssom doc). Remaining OPEN = T11 implementation cutover + T12 docs only. |

---

## Parking lot (do not expand until queued)

- Virtual assets rewrite interaction with per-op emit volume.  
- Shadow / iframe pierce under selector grammar — **done** (V1 mandatory;
  flat-tree selectors).  
- Perf SLOs / frame rate (explicitly non-correctness).  
- Whether Lab vs Live affects testing (product surface = Live / catch-all).  
- **Per-node `lastMutationSequence` (2026-08-06, clarified):** means “this node’s
  state last changed at live sequence X”. **Emitter use when building a
  structural querystring for op at `currentSequence`:** only use landmark nodes
  with `lastMutationSequence < currentSequence` (already known to a contiguous
  client). Still filter these attrs out of MutationObserver. Not a substitute
  for mandatory `speculum-anchor` happy path.  
- **Querystring / missing nodes:** superseded by **T13 LOCKED** (placeholders +
  shared `F`).
