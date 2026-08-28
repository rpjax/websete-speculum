# Implementation — F map (structural publish)

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/fmap.ts` **and** in-page fragment `inpage/fmap.frag.ts` |
| **LOC ceiling** | 500 |
| **Contracts implemented** | [02-f-map.md](../../contracts/02-f-map.md); redesign §5.2, §5.2.1; D-SPEC-1 (`documentState`); D-SPEC-3 (pierce flatten via pierce module) |
| **Invariants** | Published tree `F(Virtual)` is structurally 1:1 with Virtual after placeholder rewrite and pierce flatten. Nodes never omitted. Adjacent text 1:1 (no collapse). Placeholders never execute on Projected. Deny-listed attrs stripped. Document-level state published via opcode 12. State without attributes rides as stamped attrs in snapshots. |
| **Ban list** | Omitting placeholder hosts. Publishing light+shadow side-by-side instead of flattened slots. Collapsing adjacent text. Including computed style / layout / canvas pixels / caret in F. Publishing `<style>`/`<link>` rule bodies on Dom plane (Cssom owns them). Writing live `speculum-anchor` into Virtual. |

---

## Purpose

Define every pure function that answers: “given a Virtual node, what does Projected publish?” Observation and flush call these; they do not allocate wire buffers.

---

## Types / signatures

```ts
type AttrPair = { name: string; value: string };

type PublishedKind = 'element' | 'text' | 'comment' | 'omit-subtree';

interface ElementSnapshot {
  kind: 'element';
  id: NodeId;
  tag: string;           // after placeholder rewrite: often 'div'
  attrs: AttrPair[];     // published only; includes stamps + pierce host attrs
}

interface TextSnapshot {
  kind: 'text';
  id: NodeId;
  value: string;
}

interface CommentSnapshot {
  kind: 'comment';
  id: NodeId;
  value: string;
}

type NodeSnapshot = ElementSnapshot | TextSnapshot | CommentSnapshot;

interface FMap {
  /** True if this node (or its host) is in the published Dom plane. */
  isPublished(node: Node): boolean;
  /** True if MO/sensor work for this target must be discarded before identity (PP-FR-5). */
  discardBeforeIdentity(node: Node): boolean;
  /** F-visible children of a published parent, document order, pierce-flattened. */
  visibleChildren(parent: Node): Node[];
  /** Full flush-time snapshot without children (patch payload). Allocates id if first publish. */
  snapshot(node: Node, identity: IdentitySpace): NodeSnapshot;
  /** Document-level state for opcode documentState = 12. */
  documentState(doc: Document): {
    title: string;
    lang: string;
    dir: string;
    viewportContent: string;
  };
  /** Whether tag is a placeholder host. */
  isPlaceholderTag(tag: string): boolean;
}
```

### Placeholder set (normative)

`script`, `noscript`, `template`, `iframe`, `base`, `object`, `embed`, `applet`.

Published as element with `tag = 'div'` plus attribute `speculum-projected-tag=<originalLowercaseTag>`.

| Original | Interior |
|----------|----------|
| `iframe` | Pierced document tree as F-visible children of the host |
| others | Empty — no published children |

### Pierce host stamps (on the published host element)

| Condition | Attr |
|-----------|------|
| Open shadow host | `speculum-shadow-root=""` |
| Closed shadow host | `speculum-shadow-root=""` + `speculum-shadow-closed=""` |
| iframe host | `speculum-iframe=""` |

### Attribute deny-list

Remove before publish:

1. Any attribute whose name matches `/^on/i` (event handlers).
2. `integrity`.
3. Any URL-valued attr whose value, after trim, starts with `javascript:` (case-insensitive).
4. `<meta http-equiv="Content-Security-Policy">` and CSP `meta` variants — omit the node’s CSP content (strip attr or omit meta from F as deny-listed subtree — prefer strip content + omit if only CSP).
5. Resolve away `<base href>`: never publish `base` as navigable; placeholder empty; absolute URLs in F are already resolved against Document base before Node rewrite hop.

### URL-bearing fields (string values that Node rewrite will finalize)

`src`, `href`, `xlink:href`, `data-src`, `poster`, `srcset`, `imagesrcset`, inline `style`, and Cssom-plane `url()` / `@import` / `image-set()` (handled in [cssom.md](cssom.md) + [node-rewrite.md](node-rewrite.md)).

In-page F MAY leave absolute/resolvable URLs; Node rewrite is the session hop that produces `/w7s/virtual-*` (D-SPEC-7). F MUST NOT invent `/w7s/` forms in-page as a second algorithm.

### State stamps (§5.2.1)

| State | Attr | Value |
|-------|------|-------|
| input/textarea `.value` | `speculum-input-value` | string value |
| checkbox/radio `.checked` | `speculum-input-checked` | `"true"` / omit if false |
| option `.selected` | `speculum-option-selected` | `"true"` / omit if false |
| dialog `showModal()` | `speculum-dialog-modal` | `"true"` when modal |
| popover shown | `speculum-popover-open` | `"true"` when open |
| media paused | `speculum-media-paused` | `"true"` / `"false"` |
| media currentTime | `speculum-media-current-time` | decimal string seconds |
| media muted | `speculum-media-muted` | `"true"` / `"false"` |
| media volume | `speculum-media-volume` | `0`..`1` decimal string |
| setCustomValidity | `speculum-custom-validity` | message string (empty clears) |

Sensors mark `stateDirty` only; `snapshot` reads live state at flush.

### Out of F

Computed style, layout geometry, canvas/WebGL pixels, caret/selection.

### Canvas accepted gap

Publish box as placeholder element with `speculum-canvas-placeholder=""` (redesign §11). No pixel ferry.

---

## Step-by-step algorithm

### `discardBeforeIdentity(node)` — call at top of MO callback

Return **true** (discard record) if any:

1. Node is inside a placeholder interior **except** when walking iframe pierce children from the iframe host itself.
2. Node is a child of `<style>` or is a text node whose only parent path is stylesheet construction destined for Cssom (rule bodies → Cssom plane).
3. Node is deny-listed meta CSP-only content already excluded from F.
4. Node is in a non-published pierce failure stub (XO frame not yet adopted — wait for pierce; until then do not allocate Dom ids for inaccessible interiors).

Otherwise return **false**.

### `isPublished(node)`

1. If text or comment: published iff parent is published and parent is not a non-iframe placeholder.
2. If element: published unless it is a non-published interior (above). Document, DocumentFragment (shadow) roots are not themselves wire nodes; their children publish under the pierce host.

### `visibleChildren(parent)`

1. Resolve F-parent: if `parent` is a pierce host with open/closed shadow, children are the **flattened assigned** result for slots (rendered tree), not light+shadow side by side (PP-F-3).
2. If `parent` is iframe placeholder host: children = pierced browsing context documentElement’s published descendants under a synthetic attachment (see [pierce.md](pierce.md)).
3. If `parent` is non-iframe placeholder: return `[]`.
4. Else: iterate `parent.childNodes` in order; include each node where `isPublished`; for shadow hosts, replace light children with flattened composition per HTML shadow DOM flattening (assigned nodes appear where slots render).
5. Do **not** collapse adjacent text nodes (PP-F-2).

### `snapshot(node, identity)`

1. If `!isPublished(node)` → throw (caller bug).
2. `id = identity.allocate(node)`.
3. **Text:** return `{ kind:'text', id, value: node.data }`.
4. **Comment:** return `{ kind:'comment', id, value: node.data }`.
5. **Element:**
   a. Determine `rawTag = node.localName` (lowercase HTML).
   b. If placeholder: `tag = 'div'`; else `tag = rawTag` (SVG: keep appropriate casing policy — lowercase for HTML, preserve SVG localName as published tag string matching Virtual’s `localName`).
   c. Build `attrs` from `node.attributes` after deny-list filter.
   d. If placeholder: push `{ name:'speculum-projected-tag', value: rawTag }`.
   e. If pierce host: push shadow/iframe stamps.
   f. Apply §5.2.1 state stamps by reading live IDL properties.
   g. Return `{ kind:'element', id, tag, attrs }` — **no children**.

### `documentState(doc)` (D-SPEC-1)

1. `title = doc.title` (string).
2. `lang = doc.documentElement?.getAttribute('lang') ?? ''`.
3. `dir = doc.documentElement?.getAttribute('dir') ?? ''`.
4. Find `meta[name="viewport" i]`; `viewportContent = content attr or ''`.
5. Return the four fields for opcode `documentState = 12`.

Emit timing: live frames after `patch`, before Cssom list/patch; establish: after scroll restore data known, before arm (contract 04 / D-SPEC-1).

---

## Fresh Node for `childList`

When flush emits `fresh` ChildRef, encode uses preorder: element snapshot + recursive `visibleChildren` snapshots (each allocating as needed). Text/comment are leaves.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-F-1` | Projected isomorphic to F(Virtual) after settle (O2) |
| `PP-F-2` | Adjacent text 1:1; client never `normalize()` |
| `PP-F-3` | Slotted shadow = flattened rendered result |
| `PP-F-4` | Closed shadow + XO iframes pierced and published |
| `PP-F-5` | title/lang/dir/viewport projected; RTL renders RTL |
| `PP-D16-1..4` | dialog/popover/media/validity stamps applied |
| `PP-FR-5` | Non-published records discarded before identity |
| `PP-WIRE-3` | F itself never JSON.stringifies the tree |
