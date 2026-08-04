# Dom Projection — F (Virtual DOM → Projected DOM)

**Status:** design complete (V1 contract).

**Scope:** only the producer function **F** —

```
Virtual DOM  →  observe → anchor → coalesce → map → asset rewrite → emit  →  DomDiff
```

Not this document:

- **Input remoting & bindings** —
  [dom-projection-input.md](dom-projection-input.md)
- How bytes are **served** after rewrite —
  [dom-projection-virtual-assets.md](dom-projection-virtual-assets.md)
- Coalesce **knobs / admin config** —
  [dom-projection-coalesce.md](dom-projection-coalesce.md)
- Session viewport / video mirror

**Related:** [architecture.md](architecture.md) · [naming.md](naming.md) ·
Sessions `MirrorMode.DomProjection`

---

## 1. Purpose

Map the live Chromium DOM reachable from the session (main frame, pierced
shadow roots, pierced iframe documents including cross-origin via Chromium
control) into wire diffs for **one** isomorphic Projected DOM tree — no page
JavaScript; every fetchable URL rewritten to a Speculum virtual prefix.

One mapper for full tree and any subtree. Shadow/iframe are **mapping**
concerns (dedicated attrs on hosts), not client runtimes.

---

## 2. Vocabulary

| Term | Meaning |
|------|---------|
| **Virtual DOM** | Live DOM in Chromium. F reads it (page script and/or CDP pierce). |
| **Projected DOM** | Single tree from F’s diffs. No page JS in the payload. |
| **Anchor** | `speculum-anchor` on every mapped element. |
| **Speculum attr** | Dedicated attrs F adds (`speculum-*`); each attr has one exclusive meaning. |
| **Anchorer** | Ensures every observed element has an anchor. |
| **DiffProducer** | Dirty climb / CSSOM notices → map → emit. |
| **Mapper** | `mapNode(virtualNode) → projectedNode`. |
| **Diff** | Emit with `treeType` `dom` \| `cssom`. |
| **Generation** | Top-level document epoch (§4.3). |
| **Sequence** | Monotonic emit counter. |

---

## 3. Hard invariants

1. **Isomorphism** — Allowed content: same tags, attrs (after rewrite + Speculum
   attrs), text, child order; pierced shadow/iframe content flattened into one tree.
2. **One mapper** — Snapshot and patch use the same `mapNode`.
3. **Always-anchored** — Every observed element has `speculum-anchor`.
4. **No page JS in output** — Never map `script` / `noscript` / `template`,
   event-handler attrs, or `javascript:` URLs.
5. **Speculum-hosted fetches only** — Every fetchable URL in the mapped tree is
   one of:
   - `/w7s/virtual-assets/{host}{path}?query`
   - `/w7s/virtual-blob/{id}`
   - `/w7s/virtual-data/{id}`  
   **Strictly forbidden** to leave remote/`blob:`/`data:`/relative-off-Speculum
   refs in the wire tree.
6. **One projected tree** — Pierce shadows and iframes; consumer only renders
   nodes (+ dedicated attrs). Execution stays on the Virtual Session.

### Exclusions

| Excluded | Reason |
|----------|--------|
| `script` / `noscript` / `template` | No executable / inert template payload |
| Event-handler attributes | No executable attrs |
| Inline `javascript:` URLs | No executable navigation |
| Canvas **pixels** | Box + placeholder attr only (§5.3) |

Attr policy: **deny-list** (map everything else needed for paint/structure, then
sanitize).

---

## 4. Observe → Anchor → Diff

Prefer **one** MutationObserver (anchor phase, then dirty/coalesce). Install the
same F observation on every pierced document handle Chromium exposes.

```
mutations → Anchorer → Coalesce → DiffProducer → map / cssom → kick fetches → emit
```

Coalesce **behavior** is part of F; **numeric knobs / admin config** are
[dom-projection-coalesce.md](dom-projection-coalesce.md).

### 4.1 Anchorer

| Case | Action |
|------|--------|
| No anchor | Mint random `speculum-anchor` |
| Has anchor | Leave |
| Lost attribute | V1: mint **new** (WeakMap restore = later) |

Text nodes are not anchored.

### 4.2 DiffProducer (DOM)

**Dirty:** attrs / characterData / `childList` (as parent/target), including
pierced subtrees.

**Climb / merge:** from each dirty node, climb to the **highest dirty ancestor**
— that node is an emit root. Drop roots nested under another emit root.

**DOM patch body** — a **list of mapped nodes** (not a single parent envelope):

```
{
  nodes: [
    mapNode(emitRootA),
    mapNode(emitRootB),
    ...
  ]
}
```

Each mapped node carries its **`speculum-anchor`** (wire key = that id only).
Do **not** use `{ rootAnchor, children }`.

**DOM snapshot:** one tree — `mapNode(sessionRoot)` (with pierce). Not a list.

**Consumer:** for each entry in `nodes`, find by `speculum-anchor` and
**replace that element** with the mapped node (replacement keeps the same
anchor). Apply order: stable document order (or deepest-first — pick one in
implementation and keep it).

### 4.3 Lifecycle + `generation`


- Top-level navigation: reinstall F, `generation++`, DOM snapshot.
- Iframe navigation: reinstall on that document; patch/snapshot affected
  subtree (same `generation` unless top-level nav).

`generation` drops late patches from a previous top-level document.

---

## 5. Mapper

```
mapNode(virtualNode) → projectedNode
```

- Element: `{ anchor, tag, attrs?, children? }`
- Text: `{ tag: '#text', text }` — **all** text nodes (faithful whitespace)

### 5.1 Speculum attrs — rule

Each `speculum-*` attribute has **one dedicated, exclusive meaning**. No enum
“bucket” attrs that overload values for different concepts. Prefer
`speculum-foo="true"` (or a single scalar purpose like input value text).

### 5.2 Control attrs

| Attr | Source | Meaning |
|------|--------|---------|
| `speculum-input-value` | `input` / `textarea` `.value` | Current text |
| `speculum-input-checked` | checkbox/radio `.checked` | `"true"` / `"false"` |
| `speculum-option-selected` | `option` `.selected` | `"true"` / `"false"` |

Do **not** overwrite the site’s own `value=""`.

**Consumer contract:** upstream is source of truth; while the user edits that
control, debounce (~1s): on fire, if local ≠ last upstream, overwrite with
upstream.

### 5.3 Pierce + dedicated boundary attrs

Pierce open/closed shadow and same-/cross-origin iframes (Chromium control /
CDP). Same dirty/climb/map. On the **host** element set only what applies:

| Attr | When present (`"true"`) |
|------|-------------------------|
| `speculum-shadow-root` | Mapped children came from this element’s shadow root |
| `speculum-shadow-closed` | That shadow is **closed** (omit when open) |
| `speculum-iframe` | Mapped children came from a nested browsing document |

Consumer renders nodes; uses attrs only for fidelity. No client iframe/shadow
JS runtime.

### 5.4 Canvas

- Map `<canvas>` (box, attrs, anchor).
- Set `speculum-canvas-placeholder="true"` on the element.
- Do **not** invent placeholder children. No pixels / WebGL buffers.

### 5.5 Media (F)

- Rewrite `src` / `poster` / `<source>` / tracks like any URL (§7).
- If best-effort detection says MSE-backed: `speculum-media-mse="true"`.
- If DRM detected / not handlable: `speculum-drm-unsupported="true"`.

Absent those attrs ⇒ treat as normal URL-backed media (file / HLS / DASH via
serve plane). V1 does **not** implement MSE/DRM playback; attrs reserve wiring
and honest UX (poster/placeholder).

Serve: [dom-projection-virtual-assets.md](dom-projection-virtual-assets.md).

---

## 6. Diff tree types

| `treeType` | Body | Consumer |
|------------|------|----------|
| `dom` | **snapshot:** full mapped tree; **patch:** `{ nodes: mappedNode[] }` (§4.2) | Snapshot remount / patch: find each `speculum-anchor`, replace element |
| `cssom` | List of Speculum virtual URLs that changed | **Full reload** those resources |

Every emit: `generation`, `sequence`, `timestamp`, `treeType`; `dom` also has
`kind` = `snapshot` \| `patch`.

### 6.1 CSSOM detection (deterministic, cheap)

**Do not** poll with `cssRules.length` alone (blind to same-length edits).

**V1 — write-path instrumentation** (installed with F, before/with site JS as
far as injection allows):

1. Wrap authoring mutators on `CSSStyleSheet.prototype` (at least
   `insertRule`, `deleteRule`, `replaceSync` / `replace` where present) and
   equivalent paths that change `document.adoptedStyleSheets`.
2. On each wrapped write: mark that sheet’s **Speculum URL** (or owning
   `<style>` / `<link>` anchor) dirty for a **`cssom`** emit listing the
   virtual URL(s) to reload.
3. `<style>` text / DOM structure changes: normal MutationObserver → **`dom`**
   and/or `cssom` as appropriate when the mapped style payload’s virtual URL
   changes.
4. Cross-origin sheets that throw on `cssRules`: cannot fingerprint content;
   rely on `link` DOM attr changes / reload of that virtual-asset URL when the
   link node is dirty.

Cost is **event-driven** (pay on CSSOM writes), not a heavy per-flush hash of
all rules. Correct when writers go through wrapped APIs; exotic bypasses are
accepted residual risk for V1 (document if seen in the wild).

---

## 7. URL rewrite (part of F)

### Remote http(s)

```
https://cdn.betano.com/api/fonts/font.woff2?v=3
  →  /w7s/virtual-assets/cdn.betano.com/api/fonts/font.woff2?v=3
```

Host in path; **preserve query string**.

### `blob:` / `data:`

Ingest bytes into session store; rewrite to dedicated prefixes (not under
`virtual-assets`):

```
blob:...   →  /w7s/virtual-blob/{id}
data:...   →  /w7s/virtual-data/{id}
```

`{id}` stable for that payload within the session/generation (implementation:
content hash or allocator — must be deterministic for the same bytes).

Cover `src`, `href`, `srcset`, poster, CSS `url()`, `@import`, and any other
URL-bearing field F maps (including pierced trees).

### Emit

F emits without waiting for bodies; may kick off cache/pass-through work.
Serving: virtual-assets doc.

### Hygiene / sanitize

| Adjustment | Why |
|------------|-----|
| Strip / ignore `integrity` (adjust `crossorigin` if needed) | SRI vs proxied bytes |
| Strip / relax site CSP `meta` | May block Speculum URLs |
| Resolve or rewrite `<base href>` | No off-Speculum resolution |
| Preserve `media` on `<link>` | Stylesheet selection |
| Map `meta viewport` | Head structure |

Sanitize: exclusions §3; neutralize `javascript:` URLs; small deny set for
executable SVG vectors as tests require.

---

## 8. Coalesce (algorithm only)

F buffers dirty signals between Anchorer and DiffProducer flush. Strategies and
caps exist; **defaults, admin surface, and which knobs are runtime-configurable**
are specified only in
[dom-projection-coalesce.md](dom-projection-coalesce.md).

Forced immediate flush: snapshots, configured caps, shutdown best-effort.

---

## 9. Closed V1 decisions

| Topic | Decision |
|-------|----------|
| Tree types | `dom` \| `cssom`; DOM patch = **list of mapped nodes** by `speculum-anchor`; CSSOM → full reload of listed URLs |
| CSSOM detect | Write-path instrumentation (§6.1), not length-only poll |
| Attrs | Deny-list |
| Speculum attrs | One meaning per attr; booleans as `"true"` where applicable |
| Control attrs | `speculum-input-value` / `checked` / `option-selected` + consumer debounce |
| Boundary | `speculum-shadow-root`, `speculum-shadow-closed`, `speculum-iframe` |
| Canvas | `speculum-canvas-placeholder="true"`; no pixel children |
| Media stubs | `speculum-media-mse`, `speculum-drm-unsupported` |
| URLs | `virtual-assets` + `virtual-blob` + `virtual-data` only |
| Emit vs body | Emit free; serve plane awaits/streams |
| Lifecycle | Reinstall; `generation` for top-level nav |
| Shadow / iframe | Pierce all (Chromium control); one tree |
| Whitespace | Faithful (all text) |
| Anchor name | `speculum-anchor` |
| WeakMap restore | **Later** |
| MSE/DRM impl | **Stub attrs only**; bridges later (serve doc) |
| Coalesce numbers | **Not in this doc** — coalesce doc + admin config |

---

## 10. Explicitly later (not open questions)

| Item | Meaning |
|------|---------|
| **WeakMap restore** | If site strips `speculum-anchor`, V1 mints a new id. Later: remember prior id on the node and restore to reduce identity churn. |
| **MSE / DRM bridges** | Real implementations behind stub attrs — serve/session work. |

**Not later — already V1:** dirty climb to outermost dirty node + patch as `{ nodes: mapNode[] }` keyed only by `speculum-anchor` (§4.2). That *is* the simple climb/apply model; there is no separate “finer climb” deferral.

---

## 11. Spike vs this design

Spike: numeric ids, fine-grained ops, hash asset URLs, limited tree.

Target F: pierced one-tree map, `speculum-anchor` + dedicated Speculum attrs,
`dom`/`cssom`, dirty-climb → **patch as node list**, Speculum URL prefixes,
write-path CSSOM hooks, `generation`/`sequence`.

Implementation follows this contract. Changes to F update §§3–7 first.
