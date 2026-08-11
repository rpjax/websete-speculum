# PageProjection — CSSOM plane redesign

> **Amended by** [page-projection-engine-redesign.md](page-projection-engine-redesign.md) rev 4
> (§5.10 / Q4 / Q19): encoding follows the binary frame (§5.5); Cssom ids are `uint32` in the same
> numeric space as Dom ids (opcode disambiguates); chronology follows the **frame** model (shared
> `sequence`); `cssomInstall` precedes `establishChunk` (D-FLASH); within-frame coalescing applies
> (repeated rule writes → one `cssomPatch`; add+remove same frame → never sent). C1–C9 and C3.1
> anti-flicker / owned CSSOM / scope C7 otherwise stand. Where encoding/chronology conflict,
> **the redesign wins**.

**Status:** **SEALED** — CSSOM plane + PageProjection naming. Behaviour design
complete (C0–C9, C3.1).  
**Cutover only:** T11 rename `DomProjection`→`PageProjection` + implement ops
(front/API/sidecar). No V1 shims.  
**Dom plane (sealed):** [page-projection-diff-streams.md](page-projection-diff-streams.md)

**Purpose of this file**

1. Own the **CSSOM plane** contract inside **PageProjection** (one pipe).  
2. Inherit the **behavioural model** already locked for the DOM plane.  
3. Record sealed decisions; do not reopen DOM-plane behaviour here.

**Related:** [page-projection-diff-streams.md](page-projection-diff-streams.md)
(DOM plane) · [page-projection-diff-pipeline.md](page-projection-diff-pipeline.md)
(legacy implemented) · [naming.md](naming.md)

**How to use**

- Sections marked **LOCKED** are the sealed CSSOM / naming contract.  
- Behaviour is **design complete** — next step is T11 cutover (code rename +
  ops), not further CSSOM topic debate.  
- If a change would alter sealed DOM-plane behaviour, reopen that doc
  explicitly.

---

## 0. Inherited from sealed Dom plane (do not re-debate)

These are **already stone** in the DOM doc. CSSOM reuses the same ideas unless
an explicit exception is locked here:

| Principle | DOM lock (source) |
|-----------|-------------------|
| Autonomous packages: address + operation + exclusive payload | T2 / T6 |
| ACID apply: validate full applicability before mutate; else desync | T4 / T6 |
| Immediate emit; no intentional time coalesce for correctness | T5 |
| Overflow / degraded emit → desync (never silent drop) | T5 / D13 |
| `generation` = top-level document epoch; sequence restarts on bump | T3 / scroll |
| Pierced iframe/shadow document swap does **not** bump generation | G-B |
| Resync is OOB; does not invent live sequence advance | T8 |
| Input disarmed while desynced | D12 |
| **Shared `sequence` + `generation` with CSSOM** | **C1 LOCKED** (this file) |

**Facts (T0 in DOM doc — not decisions):** CSSOM ≠ “the animator”. The CSSOM
**plane** catches stylesheet / rule mutations that never appear as DOM
attribute changes. The DOM plane already catches class/attr-driven style
effects.

---

## 0.1 Topic queue

| # | Topic | State |
|---|--------|--------|
| C0 | Why a CSSOM **plane** (vs folding into DOM ops) | NOTE — direction yes |
| C1 | Shared vs separate `sequence` with DOM | **LOCKED** — shared `sequence` + `generation` |
| C2 | Address model (sheet / rule / declaration) | **LOCKED** — WeakMap ids; `CssomSelector` by id |
| C3 | Operation vocabulary + exclusive payloads | **LOCKED** — install \| sheetList \| ruleList \| patch |
| C3.1 | Granularity / anti-flicker | **LOCKED** — smallest op; full reload only install/resync/host-kill |
| C4 | Install / establish snapshot (all sheets vs per sheet) | **LOCKED** — rare install + sheetList mid-epoch |
| C5 | Observe → emit (what sensors; atom size) | **LOCKED** — write-path hooks; list-op atoms; DOM/CSSOM boundary |
| C6 | Projected apply | **LOCKED** — Speculum-owned CSSOM + id Map; no live URL reload |
| C7 | Pierce (CSSOM inside iframe / shadow) | **LOCKED** — scoped sheets; host kill ⇒ CSSOM kill; auto init |
| C8 | Resync / desync interaction with DOM resync | **LOCKED** — one desync; joint OOB install |
| C9 | Wire / proto / cutover + naming | **LOCKED** — one PageProjection pipe; plane dom\|cssom; E2E rename |

**Next conversation:** implementation cutover (T11) — behaviour sealed.

---

## C0 — NOTE: Direction already agreed

- **DOM plane** — structural tree + element patches + scroll (sealed).  
- **CSSOM plane** — dedicated ops, **same behavioural model**, same
  PageProjection pipe / sequence (C1, C9).  
- Apply owns projected CSSOM (C6); old URL-reload path is dead.

---

## C1 — LOCKED: Shared chronology with DOM

**LOCKED (2026-08-06)**

- DOM and CSSOM share **one** `sequence` timeline and **one** `generation`
  (top-level document epoch).  
- One emitter serializes both; `sequence++` only when an envelope is actually
  emitted (same G-C rule as DOM).  
- Envelopes ride **one** PageProjection pipe and carry `plane: "dom" | "cssom"`
  so apply can dispatch; chronology is the shared `sequence`.  
- On `generation++`, `sequence` **restarts** for the epoch — both planes.  
- No separate CSSOM generation / sequence space. No per-plane merge key.

Planes stay separate (ops / address / payload). Only chronology + pipe are
shared. Naming: see C9 (Mirror ≠ PageProjection).

---

## C2 — LOCKED: Address = Speculum CSSOM id (WeakMap mirror)

**LOCKED (2026-08-06)**

CSSOM objects cannot carry HTML attrs. Identity is a **parallel stamp**:

| Side | Mechanism |
|------|-----------|
| Virtual | `WeakMap` (sheet/rule object → opaque Speculum id); assign **before** any emit that cites the object |
| Wire | id rides in address + install/resync snapshots |
| Client | `Map<id, projected handle>` — mirror only; **never** invents ids |

**`CssomSelector` (tagged; no nullable bag)**

```text
CssomSelector = sheet { id }
              | rule  { id }
```

**Invariant (same as DOM):** `selector` always = **op target**. Resolve =
lookup id in the client map → exactly one handle, else **desync**. No per-op
adhoc resolve; no index-as-identity.

**Index vs identity**

- **Identity** of sheet/rule → Speculum id (`CssomSelector`).  
- **Position** (where a rule sits among siblings) → payload field on structural
  ops (analogue of `childList.added[].index`) — debated under C3.  
- Rejected for identity: bare `cssRules` index path; owner DomSelector+path as
  primary address (may still appear as *metadata* later, not as SoT identity).

**Lifecycle**

- First seen / install: stamp id, include in snapshot.  
- Delete: apply removes handle from client map.  
- `generation++`: maps restart with the new install (ids not reused across
  epochs).  
- Constructed / `adoptedStyleSheets`: same id model (no special address type).

**Declarations** (`color`, etc.): not a third address kind — they are payload
on a `rule` target (C3).

---

## C3 — LOCKED: Ops = `install` | `sheetList` | `ruleList` | `patch`

**LOCKED (2026-08-06)** — amended same day: added `sheetList` (C4).

Exclusive payload per op (no nullable mega-union). ACID apply. `selector` =
op target (`CssomSelector`) or omitted for `install` / `sheetList` root.

| Op | Target (`selector`) | Payload |
|----|---------------------|---------|
| `install` | omitted (CSSOM root for the epoch) | `{ sheets }` full snapshot with Speculum ids |
| `sheetList` | omitted (document CSSOM sheet list) | `{ removed, added }` |
| `ruleList` | **sheet** | `{ removed, added }` |
| `patch` | **rule** | `{ rule }` snapshot — no nested child rules |

### `sheetList` payload (LOCKED shape)

```text
removed: [ { selector: sheet { id } } … ]
added:   [ { index, sheet } … ]   // sheet carries Speculum id + rules tree
```

- Atomic add/remove of sheets mid-epoch (constructed, `<style>`/`.sheet`
  ready, adopted list changes, etc.).  
- Keeps `install` rare.  
- `added[].index` = position in the document’s projected sheet list after
  mutation on Virtual.  
- ACID: resolve all ids pre-op, then mutate; else desync.

### `ruleList` payload (LOCKED shape)

```text
removed: [ { selector: rule { id } } … ]
added:   [ { index, rule } … ]   // rule carries Speculum id + body
```

- Same idea as DOM `childList` on a sheet’s rule list.  
- `added[].index` = sibling position after Virtual mutation.  
- No solo wire `insertRule` / `deleteRule` ops.

### `patch` payload (LOCKED)

- Snapshot of **that** rule only (enough to apply the new authored effect).  
- Not a separate wire op per CSS property — one `patch` per mutated rule
  atom (same idea as Dom `patch`).  
- **Apply in place** on the existing projected rule (C3.1) — field encoding
  (`cssText` vs selectorText+declarations map) is impl, as long as it does
  not delete+reinsert the rule.  
- Nested structural edits: `ruleList` on the owning sheet (or grouping
  rule’s child list if sensors require — still list-op, not parent `patch`).

### Rejected

- Separate `setProperty` wire op (use `patch` on the rule).  
- Wire `replace` op.  
- Mid-epoch `install` for content churn.  
- Lowering a rule-body change to `sheetList` remove+add of the whole sheet.

---

## C3.1 — LOCKED: Granularity / anti-flicker (atom = what changed)

**LOCKED (2026-08-06)** — same spirit as Dom plane (minimize `document`).

**Goal:** projected style updates are as small as the Virtual mutation. Avoid
ops that tear down more CSSOM than necessary — that is what causes flicker.

### Prefer (smallest sufficient op)

| Virtual mutation | Emit |
|------------------|------|
| One declaration / `selectorText` on an existing rule | **`patch`** that rule only |
| `insertRule` / `deleteRule` (one or a coherent batch on **one** sheet) | **`ruleList`** with only those removes/adds |
| Sheet appears / disappears / adopted list membership | **`sheetList`** with only those sheets |
| Epoch boot / `generation++` | **`install`** once |
| Desync recovery | OOB `install` (with Dom `document`) — C8 |
| Pierce host dies | `sheetList` remove for that **scope** only — C7 |

### Forbid on the live path (flicker / over-widen)

1. **No mid-epoch `install`** for ordinary writes.  
2. **No URL reload** / full stylesheet refetch as a live update (C6 / C9).  
3. **No rewriting entire `style` textContent** (or equivalent full-sheet
   serialize) to apply a `patch` / `ruleList` — apply must use owned CSSOM
   mutators (`insertRule` / `deleteRule` / in-place rule style setters).  
4. **`replaceSync` / bulk replace:** emit **`ruleList` only** (never
   `sheetList` remove+add of the same sheet just to refresh rules; never
   `install`). Prefer preserving Speculum ids for rules that still exist
   after the replace when the engine keeps object identity; if the engine
   allocates all-new rule objects, new ids + ruleList remove+add of **those
   rules** is unavoidable — still must not drop/recreate the **sheet** id.  
5. **`patch` apply** updates the **existing** projected rule in place — do
   **not** implement patch as deleteRule+insertRule of the same locus (that
   widens the paint).  
6. **`sheetList.added`** may carry the new sheet’s rule tree (first paint of
   that sheet only) — that is establish of a **new** sheet, not a live patch
   of an existing one.

### Full reload / establish reserved for

| Case | Mechanism |
|------|-----------|
| Top-level document epoch | `install` (+ Dom `document`) |
| Client desync | OOB `PageProjection.Resync` install |
| Pierce **host** gone | scoped `sheetList` removes (not global install) |

---

## C4 — LOCKED: Install is rare; mid-epoch uses `sheetList`

**LOCKED (2026-08-06)**

1. **`install` once per `generation` epoch** — emitter boot and after top-level
   `generation++`. Payload = **all** reachable sheets for that document
   (pierce coverage → C7), every sheet/rule already Speculum-id stamped.  
2. **Live path** = `sheetList` / `ruleList` / `patch` — never “install per
   sheet touch”.  
3. **Mid-epoch sheet appear/disappear** → **`sheetList`** (not a second full
   `install`, not DOM-only). DOM `childList` on `<style>`/`<link>` may *wake*
   registration; the CSSOM envelope still owns id-map updates.  
4. **Resync** OOB body is `install`-shaped + shared sequence watermark (C8).  
5. Minimize installs for the same reason DOM minimizes `document` (flicker /
   reload / cost).

---

## C5 — LOCKED: Observe → emit

**LOCKED (2026-08-06)**

1. **Primary sensor:** write-path hooks on Virtual CSSOM mutators
   (`insertRule`, `deleteRule`, `replace` / `replaceSync`, rule style /
   `selectorText` writes, `adoptedStyleSheets` changes, and equivalents).
   Not length-only polling / full-sheet hash as the correctness path.  
2. **Atom:** one hooked coherent mutation → **one** envelope
   (`sheetList` | `ruleList` | `patch`). Multi-step structural change in one
   turn is absorbed into list ops (DOM `childList` precedent) — not N solo
   envelopes.  
3. **Stamp before emit:** WeakMap ids for any new sheet/rule **before**
   payload build / `sequence++`.  
4. **`sequence++`:** only when an envelope is actually emitted (G-C).  
5. **`replaceSync` / big replace:** lower to **`ruleList` only**
   (C3.1) — **never** mid-epoch `install`, **never** sheet remove+add just
   to refresh rules.  
6. **DOM × CSSOM boundary (no double-emit):**
   - Element structure (`<style>` / `<link>` / host nodes) → **DOM** stream.  
   - Stylesheet rule tree / `.sheet` body → **CSSOM plane** only.  
   DOM may *wake* sheet registration; CSSOM envelope owns id-map + rule body.

---

## C6 — LOCKED: Projected apply = owned CSSOM (not old URL reload)

**LOCKED (2026-08-06)**

This is not a product fork — the old pipeline’s “CSSOM = list virtual URLs →
**full reload**” is **superseded** by this redesign. Live apply follows the
same op model as emit:

1. Client keeps `Map<id, handle>` (C2) as identity SoT for apply.  
2. Projected stylesheets are **Speculum-owned** (`<style>.sheet` and/or
   `CSSStyleSheet` + adopt — impl detail).  
3. `install` / resync **build** owned sheets + Map from the snapshot.  
4. `sheetList` / `ruleList` / `patch` **mutate** Map + owned CSSOM with ACID
   validate-then-apply (missing id → desync).  
5. Virtual-asset fetch of author CSS may **seed** once into an owned sheet;
   it is **not** the live update channel.  
6. **Live apply granularity (C3.1):** mutate owned CSSOM in place
   (`insertRule` / `deleteRule` / rule style setters). Serializing /
   replacing whole sheet text is **not** an allowed live apply path — if a
   sheet truly cannot be owned, that is a product bug to fix, not a silent
   full-text fallback that flickers.  

---

## C7 — LOCKED: Pierce + style scope + host lifecycle

**LOCKED (2026-08-06)**

Flattened projected DOM would otherwise let iframe/shadow CSS leak into the
parent. Sheets are **scoped**; host DOM lifecycle **owns** CSSOM teardown /
bootstrap so new iframes work without a special snowflake path.

### Identity & chronology

1. One WeakMap / client Map id space per `generation` (main + all pierced).  
2. Shared `sequence` / `generation` with DOM (C1).  
3. Cross-origin pierce: same Chromium-control doctrine as DOM F.

### Style scope (no leak)

Every sheet carries **`scope`**:

| `scope` | Rules may match |
|---------|-----------------|
| `main` | top-level projected document |
| `pierceHost` + host Speculum identity | **only** under that host’s projected subtree |

Apply (C6) **must** enforce scope (`@scope` / selector rewrite / adopt under
host-owned boundary — impl). Unscoped pierce sheet apply = contract bug.

Shadow sheets use the shadow host as `pierceHost` the same way.

### Host lifecycle ↔ CSSOM (automatic)

Pierce CSSOM is not a parallel manual feature — it is **bound to pierce DOM
init/teardown**:

| DOM / pierce event | CSSOM effect |
|--------------------|--------------|
| Pierce `init()` on a root (new iframe doc, new shadow, boot) | Discover sheets; stamp ids with that host `scope`; emit `sheetList` **added** (or include in epoch `install` if boot) |
| Host **removed** / replaced / killed (DOM `childList` removes iframe/shadow host, or pierce tears down the root) | Emit `sheetList` **removed** for **every** sheet with that `scope`; drop ids from Virtual WeakMap + client Map; unhook sensors |
| Pierced document **swap** (iframe nav — DOM G-B, no generation bump) | Teardown old root CSSOM (removes above) + `init()` on new doc (adds above) — still no global `install` |
| New `<style>` / constructed sheet inside an already-pierced root | Normal live `sheetList` / `ruleList` / `patch` with that root’s `scope` |

**Invariant:** there is no live sheet whose `scope` host no longer exists in the
projected tree. DOM host kill **implies** CSSOM kill for that scope — same
emitter chronology so the client never paints orphan pierce CSS on the parent.

**Natural path for new iframes:** DOM admits the host → pierce `init` → CSSOM
register/stamp/emit. No separate “remember to wire CSSOM” checklist beyond
pierce install.

---

## C8 — LOCKED: One desync; joint DOM+CSSOM resync

**LOCKED (2026-08-06)**

1. **One** PageProjection desync state — failure/gap on DOM **or** CSSOM
   plane desyncs the whole PageProjection client (shared chronology).  
2. Input stays **disarmed** until resync snapshots are applied and live drain
   resumes (DOM D12).  
3. OOB resync returns **one** body (preferred) with:
   - DOM `document` root (após `F`)  
   - CSSOM `install` (`sheets` + ids + `scope`)  
   - shared watermark: `generation` + `coversThroughSequence`  
   Route family: `PageProjection.Resync` (renames today’s DomProjection
   resync); exact field names = impl/DTO polish.  
4. Client applies both snapshots, rebuilds Dom anchors tree + CSSOM id Map
   (scopes included), then drains the shared live buffer per DOM T8 rules.  
5. Two parallel fetches only if transport forces it — **same** watermark
   required; do not apply one side alone.

---

## C9 — LOCKED: One PageProjection pipe + end-to-end rename

**LOCKED (2026-08-06)**

### Vocabulary (do not steal Mirror)

| Term | Meaning |
|------|---------|
| **Mirror** | Product technique / config root (`MirrorMode`). Covers **VideoStreaming** and **PageProjection**. |
| **`MirrorMode`** | Which mirror surface the session runs. Client opens named streams allowed by the mode; backend validates. `ILiveSession` keeps **named streams** — no extra “MirrorStream” abstraction layer. |
| **`MirrorMode.PageProjection`** | Structural page mirror (DOM + CSSOM). **Replaces** `MirrorMode.DomProjection`. Wire: `pageProjection`. |
| **PageProjection pipe** | The **one** chronological diff pipe for that mode. |
| **`plane: dom \| cssom`** | Discriminator **inside** a PageProjection envelope (not a second stream). |
| **Dom / Cssom** | Planes: own ops, address, apply; share sequence/generation/resync. |

**Rejected:** naming the structural pipe “Mirror” (collides with the parent technique that also includes video).

### Wire

1. **One pipe** — today’s Dom Diff transport becomes the PageProjection diff
   pipe; envelope = `{ generation, sequence, plane, operation, payload… }`.  
2. No second hub/WebSocket for CSSOM in V1.  
3. Tagged unions for plane ops + `DomSelector` / `CssomSelector` (MessagePack-
   safe concrete DTOs).  
4. Old `kind=cssom` URL-list reload: **deleted** at cutover (no dual-live, no
   shim).  
5. Telemetry catalog ids: soft, but must live under `Sessions.PageProjection.*`
   after rename.

### End-to-end semantic rename (cutover requirement)

Cutover is **not** behaviour-only. Every `DomProjection` product/wire/type name
that means “the structural mirror mode / pipe” becomes **PageProjection**.
Partial rename = inconsistency — **front + API + sidecar + proto + docs +
tests + telemetry** in the same structural move (V1: no aliases).

| Area | Today (examples) | Target |
|------|------------------|--------|
| Config / enum | `MirrorMode.DomProjection`, wire `domProjection` | `MirrorMode.PageProjection`, `pageProjection` |
| `ILiveSession` streams / APIs | Dom diff open, `AdmitDomProjectionInput`, … | PageProjection diff stream; **`AdmitPageProjectionInput` / `PageProjectionIntent`** (full input rename — not left as DomProjection*) |
| Namespaces / folders | `Sessions.Mirror.DomProjection`, `Telemetry…DomProjection` | `Sessions.Mirror.PageProjection` (+ `Dom` / `Cssom` subfolders for planes); `Telemetry.Sessions.PageProjection.*` |
| Hub / DTOs / opcodes | DomProjection* message types, client `domProjection` | PageProjection*; client `pageProjection` |
| Proto / gRPC | `WatchDomProjection*`, `DomProjection*Event`, launch mirrorMode | `WatchPageProjection*` / plane-specific watches as needed; `pageProjection` |
| Sidecar | `DomProjection.ts`, bridges, mirrorMode checks | PageProjection producer (DOM+CSSOM emitters into one pipe) |
| Web | `MirrorMode`, surfaces, lab toggles, observation planes | `pageProjection`; UI copy must not say “DOM-only mirror” |
| Docs | `page-projection-*.md` filenames | Migrate to `page-projection-*.md` (or keep files temporarily with banners) under T12 — content vocabulary = PageProjection |
| Resync | `DomProjection.Resync` | `PageProjection.Resync` (DOM root + CSSOM install) |

**Naming rule for leftovers:** `Dom*` remains valid for **DOM-plane** types
(`DomSelector`, `DomNode`, DOM ops, DOM-plane input intents). It must **not**
name the Mirror **mode** or the shared **pipe**.

### Status after C9

CSSOM behaviour + PageProjection naming = **design complete**. Implement via
T11 cutover (rename + new ops/planes together preferred).

---

## Decision log (append-only)

| Date | Topic | Decision |
|------|-------|----------|
| 2026-08-06 | Meta | CSSOM notepad created; DOM sealed elsewhere. |
| 2026-08-06 | C0 | Direction: CSSOM **plane** (same behavioural model as Dom plane; one PageProjection pipe). |
| 2026-08-06 | C1 | **LOCKED** shared `sequence` + `generation` with DOM; one emitter; `plane` tag on envelope (refined C9). |
| 2026-08-06 | C2 | **LOCKED** identity = Speculum id via Virtual WeakMap + client Map mirror; `CssomSelector` = `sheet{id}` \| `rule{id}`; index = position only; declarations = patch payload. |
| 2026-08-06 | C3 | **LOCKED** CSSOM ops = install \| sheetList \| ruleList \| patch (sheetList added with C4). |
| 2026-08-06 | C4 | **LOCKED** install once per generation; mid-epoch sheet add/remove via sheetList; live = sheetList/ruleList/patch; resync body = install-shaped. |
| 2026-08-06 | C5 | **LOCKED** write-path hooks; one coherent mutation → one sheetList\|ruleList\|patch; stamp before emit; replaceSync→list ops; DOM=element structure, CSSOM=rule tree only. |
| 2026-08-06 | C6 | **LOCKED** projected apply = Speculum-owned CSSOM + id Map; old URL-reload live path superseded; asset fetch seed-only. |
| 2026-08-06 | C7 | **LOCKED** sheet scope main\|pierceHost; host DOM kill ⇒ sheetList remove + id purge; pierce init auto-registers CSSOM; iframe swap = teardown+init without generation bump. |
| 2026-08-06 | C8 | **LOCKED** one desync for whole mirror; OOB resync = DOM document + CSSOM install + shared watermark; rebuild both maps then drain. |
| 2026-08-06 | C9 | **LOCKED** one PageProjection pipe; plane dom\|cssom; Mirror stays parent technique; DomProjection→PageProjection E2E rename (front/API/sidecar/proto/telemetry/docs); no shims; old URL cssom deleted. |
| 2026-08-06 | C3.1 | **LOCKED** anti-flicker granularity: smallest sufficient op; live=patch/ruleList/sheetList only; install/resync/host-kill only for full establish/teardown; replaceSync→ruleList only; patch apply in-place; no live full-text sheet rewrite. |
| 2026-08-06 | Meta | **SEALED** CSSOM plane behaviour + PageProjection naming. No open CSSOM contract gaps; cutover = T11/T12 only. |
| 2026-08-06 | Input | **LOCKED** E2E rename includes input (`PageProjectionIntent`); desync disarm is client-only — Virtual gets no desync signal; no input `resync` type. |

---

## Parking lot

- Interaction with virtual-assets rewrite volume.  
- `@keyframes` / font-face / import rules as first-class vs opaque text.  
- Computed style is **out** of PageProjection Dom-plane F (DOM D16) — stays out unless
  this track explicitly reopens with evidence of ghost desync.
