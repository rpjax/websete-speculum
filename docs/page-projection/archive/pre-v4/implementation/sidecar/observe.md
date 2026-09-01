# Implementation — Observe (sensors)

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/observe.ts` **and** in-page fragment `inpage/observe.frag.ts` |
| **LOC ceiling** | 400 |
| **Contracts implemented** | [02-f-map.md](../../contracts/02-f-map.md), [03-frame.md](../../contracts/03-frame.md); redesign §5.2.1 sensors, §5.3.2; pierce lifecycle hooks |
| **Invariants** | MutationObserver + state sensors record **dirtiness only** — zero string/payload work in handlers. Non-published records discarded at callback top before identity (PP-FR-5). Pierce attach/detach updates observation roots. Scroll sensors update `scrollDirty` with last-sample wins; viewport uses sentinel id `0` (D-SPEC-5). |
| **Ban list** | Building wire payloads or HTML inside MO/event handlers. One envelope per MutationRecord. Filtering by “visual relevance”. Using `requestAnimationFrame` as the observation batch boundary (clock owns boundary). Writing identity attrs when observing. |

---

## Types / signatures

```ts
interface ObserveTarget {
  /** Install MO + sensors on document + known pierce roots. */
  start(args: {
    document: Document;
    fmap: FMap;
    identity: IdentitySpace;
    accum: FrameAccum;       // from frame.ts
    pierce: PierceRegistry;  // from pierce.ts
  }): void;
  stop(): void;
  /** Called when pierce adopts a new root (closed shadow / XO iframe). */
  observeRoot(root: Node): void;
  unobserveRoot(root: Node): void;
}

interface FrameAccum {
  newIds: Set<NodeId>;
  dirtyParents: Set<NodeId>;
  attrDirty: Set<NodeId>;
  textDirty: Set<NodeId>;
  stateDirty: Set<NodeId>;
  scrollDirty: Map<NodeId, { x: number; y: number }>; // 0 = viewport
  detached: Set<NodeId>;
  documentStateDirty: boolean;
  markConnectedPublish(node: Node): NodeId | 0;
}
```

MutationObserver options (per observed root):

```ts
const MO_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
  attributeOldValue: false,
  characterDataOldValue: false,
};
```

---

## Step-by-step algorithm

### `start`

1. Create one `MutationObserver` bound to `onMutations`.
2. `observeRoot(document)` — observe `document` (covers documentElement subtree).
3. For each already-known pierce root from `pierce.listRoots()`, `observeRoot(root)`.
4. Install document-level sensors (below).
5. Install scroll listeners on `document` / `window` for viewport; use capture on scrollable elements via a single capturing `scroll` listener on document (filter targets).
6. Set `documentStateDirty = true` once so first live frame after establish can emit if needed (establish also emits documentState per D-SPEC-1).

### `onMutations(records: MutationRecord[])`

For each record, **in order received**:

1. Let `t = record.target`.
2. If `fmap.discardBeforeIdentity(t)` → **continue** (no allocate, no sets) — PP-FR-5.
3. Switch on `record.type`:

#### `childList`

1. For each `removedNode` in `record.removedNodes`:
   - If discard → skip.
   - Let `id = identity.idOf(removedNode)`. If `id > 0`, add to `detached`; mark parent dirty if parent published.
2. For each `addedNode` in `record.addedNodes`:
   - If discard → skip.
   - Recurse subtree with a walk that for each published node calls `accum.markConnectedPublish(node)` which: if unpublished, will be allocated at flush when included in a fresh snapshot — during observe, only mark `dirtyParents` for the published parent. Prefer: mark parent’s id in `dirtyParents`; if node already has id and reconnects, remove from `detached`.
3. Always: if `record.target` is published (or is Document → use documentElement’s parent semantics: dirty the documentElement as parent of html children — actually childList on Document targets document; F parent for html/body is documentElement / body per F rules). Resolve F-parent id: if target is Document, dirty a synthetic “document element parent” — **normative:** treat `document.documentElement` as the root published element; childList on `document` marks dirtyParents for a sentinel handled as establishing children of an implicit root. Simpler rule used by establish HTML: the published tree root is `html`; MO on document still marks `dirtyParents` with `identity.idOf(document.documentElement)` when html’s children change, and when documentElement itself is replaced marks establish-level hard-nav detection outside observe.

**Normative parent marking:**

- If `target` is an Element and `fmap.isPublished(target)` → `dirtyParents.add(identity.idOf(target) || scheduleParentAllocate)`.
- If parent has no id yet but will be published this frame, frame flush allocates when emitting ancestor fresh nodes; observe may stash WeakSet of dirty parent Nodes and resolve ids at flush. **Implementation MUST use `Set<Node>` for dirtyParentsNodes internally and map to ids at flush** to avoid allocating ids for never-published parents — then convert:

Revised accum (normative for observe/frame):

```ts
dirtyParentNodes: Set<Node>;
attrDirtyNodes: Set<Node>;
// ... convert to ids at flush after prune
```

Contract’s `Set<u32>` is the flush-facing view; observe MAY keep `Set<Node>` and materialize ids at flush start after prune rules.

4. For added subtrees, do **not** walk allocating every descendant in the handler — only mark dirty parent. Allocation happens in flush when building `childList` / fresh snapshots (E3).

#### `attributes`

1. If discard → skip.
2. If attribute name is deny-listed only noise — still mark attr dirty if node published (deny happens at snapshot).
3. Add node to `attrDirtyNodes`.
4. If attribute is `lang`/`dir` on `documentElement` or title-ish — set `documentStateDirty` when `title` changes via other sensors; for `lang`/`dir` on root set `documentStateDirty = true`.

#### `characterData`

1. If discard → skip.
2. Add text/comment node to `textDirtyNodes`.

### State sensors (mark `stateDirty` only)

Install once on `document` (capture where needed):

| Event / hook | Targets | Action |
|--------------|---------|--------|
| `input`, `change` | input, textarea, select, option | `stateDirtyNodes.add(target)` (option: also parent select) |
| `toggle` | popover elements | stateDirty |
| `close` | dialog | stateDirty |
| media `play`, `pause`, `seeked`, `volumechange` | video/audio | stateDirty |
| Explicit hook | `HTMLDialogElement.showModal` / `close` via wrapping only if needed — prefer events; if no event for validity, expose `notifyValidity(node)` called from Cssom/page hooks | stateDirty |

**MUST NOT** read `.value` into strings in the handler beyond touching the Set.

### Scroll sensors (D-SPEC-5)

1. Capturing `scroll` on document:
   - If `target === document` or `target === document.documentElement` or `target === document.body` (viewport scroll): `scrollDirty.set(0, { x: window.scrollX, y: window.scrollY })`.
   - Else if target is Element with id or will publish: store Node key; at flush resolve id; `scrollDirty.set(id, { x: scrollLeft, y: scrollTop })`.
2. Last sample wins for the same key within the frame.
3. Echo suppression: if position equals last applied client intent position for that scroller, skip emit at flush ([contract 10](../../contracts/10-interaction.md)) — observe still records; flush filters.

### Document title

`document` mutation or `MutationObserver` on `<title>` characterData / childList → `documentStateDirty = true`.

### Pierce lifecycle

When `pierce` adopts a closed root or XO document:

1. `observeRoot(root)`.
2. Mark pierce host’s parent/`dirtyParentNodes` so `childList` republishes flattened children.

When pierce detaches:

1. `unobserveRoot(root)`.
2. Mark host dirty; mark previously published interior ids `detached`.

### `stop`

Disconnect MO; remove all listeners; clear references.

---

## Coupling

- Does not call encode/channel.
- Does not call `identity.allocate` in the hot path except optionally for already-required host marks — prefer Node-set deferral.
- Hard-nav detection is **not** observe’s job (D-SPEC-9): document token / CDP non-same-document owned by orchestration.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-FR-1` | Create+destroy within frame never sent (observe marks; flush prunes) |
| `PP-FR-3` | N attr writes → one patch (dirty set coalesces) |
| `PP-FR-5` | Non-published discarded before identity |
| `PP-D16-1..4` | Sensors mark stateDirty; flush snapshots stamps |
| `PP-F-4` | Pierce roots become observed and published |
| `PP-LOAD-2` | Observation never drops records as load control |
